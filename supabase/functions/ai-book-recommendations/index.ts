import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { preflight, requireUser, serviceClient, rateLimit, jsonResponse, handleError } from '../_shared/auth.ts'

interface BookInput {
  title: string
  author: string | null
  genre: string | null
  user_rating: number | null
  read_status: string
  has_read?: boolean
}

// Cost guards: AI is expensive. Cap input size and per-user call rate.
const MAX_BOOKS_INPUT = 200
const MAX_TITLE_LEN   = 200
const MAX_AUTHOR_LEN  = 120
const RATE_LIMIT_PER_HOUR = 10

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre

  try {
    const { user } = await requireUser(req)
    await rateLimit(serviceClient(), user.id, 'ai-book-recommendations', RATE_LIMIT_PER_HOUR)

    const { books }: { books: BookInput[] } = await req.json()

    if (!Array.isArray(books) || books.length < 3) {
      return jsonResponse({ recommendations: [], reason: 'not_enough_data' })
    }

    // Truncate input to bounded size before it touches the prompt.
    const trimmed = books.slice(0, MAX_BOOKS_INPUT).map(b => ({
      ...b,
      title:  String(b.title  ?? '').slice(0, MAX_TITLE_LEN),
      author: b.author ? String(b.author).slice(0, MAX_AUTHOR_LEN) : null,
    }))

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      return jsonResponse({ recommendations: [], reason: 'no_api_key' })
    }

    // Build reading profile — prioritise read + rated books, cap at 40
    const readBooks = trimmed
      .filter(b => b.has_read === true || b.read_status === 'read' || (b.user_rating ?? 0) > 0)
      .sort((a, b) => (b.user_rating ?? 0) - (a.user_rating ?? 0))
      .slice(0, 40)

    const profileBooks = readBooks.length >= 3 ? readBooks : trimmed.slice(0, 40)

    const lines = profileBooks.map(b => {
      let line = `"${b.title}"${b.author ? ` by ${b.author}` : ''}`
      if (b.genre) line += ` [${b.genre}]`
      if (b.user_rating) line += ` — rated ${b.user_rating}/5`
      return line
    })

    const ownedTitles = trimmed.map(b => b.title.toLowerCase())

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
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
        }),
      }
    )

    if (!response.ok) {
      const err = await response.text()
      console.error('Gemini API error:', err)
      return jsonResponse({ recommendations: [], reason: 'api_error' })
    }

    const data = await response.json()

    // Gemini 2.5 thinking models mark thought parts with `thought: true` — skip those
    const parts: any[] = data.candidates?.[0]?.content?.parts ?? []
    const nonThoughtParts = parts.filter((p: any) => !p.thought && p.text)
    const text: string = nonThoughtParts.length > 0
      ? nonThoughtParts.map((p: any) => p.text as string).join('')
      : parts.map((p: any) => p.text ?? '').join('')

    // Strip markdown code fences if present (```json ... ```)
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    // Extract JSON array from the response
    const jsonMatch = stripped.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.error('No JSON array found in Gemini response')
      return jsonResponse({ recommendations: [], reason: 'parse_error' })
    }

    let recommendations: { title: string; author: string; reason: string }[]
    try {
      recommendations = JSON.parse(jsonMatch[0])
    } catch (e) {
      console.error('JSON parse failed:', String(e))
      return jsonResponse({ recommendations: [], reason: 'parse_error' })
    }

    const filtered = recommendations.filter(
      r => !ownedTitles.includes(r.title.toLowerCase())
    ).slice(0, 8)

    return jsonResponse({ recommendations: filtered })
  } catch (err) {
    return handleError(err)
  }
})
