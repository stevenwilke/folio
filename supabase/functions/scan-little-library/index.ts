import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { preflight, requireUser, serviceClient, rateLimit, jsonResponse, jsonError, handleError } from '../_shared/auth.ts'

const MAX_IMAGE_LEN = 8 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const RATE_LIMIT_PER_HOUR = 8

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre

  try {
    const { user } = await requireUser(req)
    await rateLimit(serviceClient(), user.id, 'scan-little-library', RATE_LIMIT_PER_HOUR)

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

    const prompt = `This is a photo of books inside a Free Little Library (a small community book-sharing box). Identify as many books as you can see from their spines or covers.

Please respond with ONLY a valid JSON object (no markdown, no explanation) with these fields:

{
  "books": [
    {"title": "...", "author": "..."},
    ...
  ],
  "total_visible": <total number of books visible, including ones you can't identify>,
  "notes": "<brief observation about the library contents, condition, etc.>"
}

For books: list every book you can identify with reasonable confidence. Include title and author if visible. If author is not visible, set it to null.
For total_visible: count ALL books you can see, even if you can't read the title.
Be thorough — look at every spine and cover carefully.`

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
      return jsonError('Could not identify books', 502)
    }

    let result
    try {
      result = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr)
      return jsonError('Could not identify books', 502)
    }

    return jsonResponse({ success: true, ...result })
  } catch (err) {
    return handleError(err)
  }
})
