import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { preflight, requireUser, serviceClient, rateLimit, jsonResponse, jsonError, handleError } from '../_shared/auth.ts'

// 8 MB raw cap on the base64 image (≈6 MB binary).
const MAX_IMAGE_LEN = 8 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const RATE_LIMIT_PER_HOUR = 8

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre

  try {
    const { user } = await requireUser(req)
    await rateLimit(serviceClient(), user.id, 'analyze-shelf', RATE_LIMIT_PER_HOUR)

    const { imageBase64, mimeType = 'image/jpeg' } = await req.json()

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return jsonError('GEMINI_API_KEY not configured', 500)
    if (!imageBase64) return jsonError('No image provided', 400)
    if (typeof imageBase64 !== 'string' || imageBase64.length > MAX_IMAGE_LEN) {
      return jsonError('Image too large', 413)
    }
    if (!ALLOWED_MIME.has(mimeType)) {
      return jsonError('Unsupported image type', 415)
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
      return jsonError('Gemini API error', 502)
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
      return jsonError('Could not parse shelf analysis', 502)
    }

    let result
    try {
      result = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr)
      return jsonError('Could not parse shelf analysis', 502)
    }
    return jsonResponse({ success: true, ...result })
  } catch (err) {
    return handleError(err)
  }
})
