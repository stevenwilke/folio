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

    const prompt = `Analyze this bookshelf photo. The photo may be at an angle. Only count actual enclosed cubbies/sections where books can stand upright — do NOT count the top surface, open areas above the bookcase, or decorative ledges as shelves.

Respond with a JSON object:

{
  "rows": <number of rows of cubbies>,
  "columns": <number of columns>,
  "shelf_count": <rows × columns>,
  "current_books_per_shelf": [<books visible in cubby 1>, ...],
  "books_per_shelf": [<max capacity per cubby>, ...],
  "shelf_bounds": [{"x":<left%>,"y":<top%>,"w":<width%>,"h":<height%>}, ...],
  "total_capacity": <sum of books_per_shelf>,
  "notes": "<brief observation>",
  "recognized_books": [{"title":"...","author":"...","shelf":<n>}, ...]
}

Shelf numbering: left-to-right, top-to-bottom.
shelf_bounds: bounding box of each cubby as percentages (0-100) of image size. Trace the actual wood dividers as they appear in the photo. Account for perspective — do NOT use a uniform grid. Keep values compact (integers, no decimals).
books_per_shelf: max capacity >= current count.
recognized_books: high confidence only, up to 10.`

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
          generationConfig: { temperature: 0.2, maxOutputTokens: 16384, responseMimeType: 'application/json' },
        }),
      }
    )

    if (!response.ok) {
      const err = await response.text()
      console.error('Gemini API error:', err)
      return new Response(
        JSON.stringify({ error: 'Gemini API error', detail: err.slice(0, 200) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
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
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    let result
    try {
      result = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr, 'Raw:', jsonMatch[0].slice(0, 300))
      return new Response(
        JSON.stringify({ error: 'Could not parse shelf analysis', raw: text.slice(0, 300) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
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
