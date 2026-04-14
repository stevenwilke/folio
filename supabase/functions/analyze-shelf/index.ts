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

    const prompt = `Analyze this photo of a bookshelf or bookcase. Many bookcases have vertical dividers creating multiple columns. Each individual cubby/section (row × column) counts as its own shelf.

Please respond with ONLY a valid JSON object (no markdown, no explanation) with these fields:

{
  "rows": <number of horizontal rows>,
  "columns": <number of vertical columns/sections>,
  "shelf_count": <total number of individual cubbies/sections, i.e. rows × columns>,
  "current_books_per_shelf": [<actual count of books currently visible in cubby 1>, <cubby 2>, ...],
  "books_per_shelf": [<estimated MAX capacity if cubby were fully packed with books>, ...],
  "total_capacity": <total estimated max book capacity across all cubbies>,
  "notes": "<brief observation about the shelves, e.g. size, style, any notable features>",
  "recognized_books": [
    {"title": "...", "author": "...", "shelf": <shelf number 1-based>},
    ...
  ]
}

For shelf numbering: count left-to-right, top-to-bottom. E.g. a 3-row × 3-column bookcase has 9 shelves: top-left is 1, top-middle is 2, top-right is 3, middle-left is 4, etc.
For current_books_per_shelf: count the actual number of books currently visible in each cubby. Include an entry for every cubby (use 0 if no books).
For books_per_shelf: estimate the MAX capacity — how many books each cubby could hold if fully packed with average-sized books. Use the current book count as a minimum (capacity should be >= current count). Consider the remaining empty space in each cubby.
For recognized_books: only include books you are highly confident about. List up to 10.`

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
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
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
