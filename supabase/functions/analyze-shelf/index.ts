import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { imageBase64, mimeType = 'image/jpeg' } = await req.json()

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: 'No image provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const prompt = `Analyze this photo of a bookshelf or bookcase. Please respond with ONLY a valid JSON object (no markdown, no explanation) with these fields:

{
  "shelf_count": <number of visible shelves>,
  "books_per_shelf": [<estimated books on shelf 1>, <shelf 2>, ...],
  "total_capacity": <total estimated book capacity>,
  "notes": "<brief observation about the shelves, e.g. size, style, any notable features>",
  "recognized_books": [
    {"title": "...", "author": "...", "shelf": <shelf number 1-based>},
    ...
  ]
}

For recognized_books: only include books you are highly confident about. List up to 10.
For books_per_shelf: estimate how many books each shelf could hold if fully packed.
Count from top shelf as shelf 1.`

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageBase64,
                }
              },
              { text: prompt }
            ]
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
      }
    )

    if (!response.ok) {
      const err = await response.text()
      console.error('Gemini API error:', err)
      return new Response(
        JSON.stringify({ error: 'Gemini API error', detail: err.slice(0, 200) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()
    const parts: any[] = data.candidates?.[0]?.content?.parts ?? []
    const nonThoughtParts = parts.filter((p: any) => !p.thought && p.text)
    const text: string = (nonThoughtParts.length > 0 ? nonThoughtParts : parts)
      .map((p: any) => p.text ?? '').join('')

    // Strip markdown fences and extract JSON
    const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
    const jsonMatch = stripped.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      console.error('Could not find JSON in response:', text.slice(0, 500))
      return new Response(
        JSON.stringify({ error: 'Could not parse shelf analysis', raw: text.slice(0, 300) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let result
    try {
      result = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr, 'Raw:', jsonMatch[0].slice(0, 300))
      return new Response(
        JSON.stringify({ error: 'Could not parse shelf analysis', raw: text.slice(0, 300) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
