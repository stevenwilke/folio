import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BookInput {
  title: string
  author: string | null
  genre: string | null
  user_rating: number | null
  read_status: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { books }: { books: BookInput[] } = await req.json()

    if (!books || books.length < 3) {
      return new Response(
        JSON.stringify({ recommendations: [], reason: 'not_enough_data' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ recommendations: [], reason: 'no_api_key' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build reading profile — prioritise read + rated books, cap at 40
    const readBooks = books
      .filter(b => b.read_status === 'read' || (b.user_rating ?? 0) > 0)
      .sort((a, b) => (b.user_rating ?? 0) - (a.user_rating ?? 0))
      .slice(0, 40)

    const profileBooks = readBooks.length >= 3 ? readBooks : books.slice(0, 40)

    const lines = profileBooks.map(b => {
      let line = `"${b.title}"${b.author ? ` by ${b.author}` : ''}`
      if (b.genre) line += ` [${b.genre}]`
      if (b.user_rating) line += ` — rated ${b.user_rating}/5`
      return line
    })

    const ownedTitles = books.map(b => b.title.toLowerCase())

    const prompt = `You are a passionate book recommendation expert with deep knowledge of literature across all genres.

Here is a reader's personal library (books they own, have read, or rated):
${lines.join('\n')}

Based on their taste, suggest exactly 8 books they are very likely to enjoy and have NOT read yet.

Rules:
- Only recommend real, well-known published books
- Do not recommend any book already in their library (listed above)
- Vary the recommendations — include different authors and a mix of genres that fit their taste
- Each "reason" should be a short, specific phrase (max 8 words) explaining WHY this reader would like it

Respond with ONLY a valid JSON array — no markdown, no explanation, just the array:
[
  {"title": "...", "author": "...", "reason": "..."},
  ...
]`

    // Call Google Gemini API (free tier)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
        }),
      }
    )

    if (!response.ok) {
      const err = await response.text()
      console.error('Gemini API error:', err)
      return new Response(
        JSON.stringify({ recommendations: [], reason: 'api_error', detail: err }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    // Extract JSON array from the response
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.error('Could not find JSON array in response:', text)
      return new Response(
        JSON.stringify({ recommendations: [], reason: 'parse_error' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let recommendations: { title: string; author: string; reason: string }[]
    try {
      recommendations = JSON.parse(jsonMatch[0])
    } catch {
      return new Response(
        JSON.stringify({ recommendations: [], reason: 'parse_error' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const filtered = recommendations.filter(
      r => !ownedTitles.includes(r.title.toLowerCase())
    ).slice(0, 8)

    return new Response(
      JSON.stringify({ recommendations: filtered }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Edge function error:', err)
    return new Response(
      JSON.stringify({ recommendations: [], reason: 'server_error', error: String(err) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
