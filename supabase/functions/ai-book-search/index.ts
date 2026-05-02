import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { preflight, requireUser, serviceClient, rateLimit, jsonResponse, handleError } from '../_shared/auth.ts'

const MAX_QUERY_LEN  = 500
const MAX_COLLECTION = 200
const RATE_LIMIT_PER_HOUR = 30

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre

  try {
    const { user } = await requireUser(req)
    await rateLimit(serviceClient(), user.id, 'ai-book-search', RATE_LIMIT_PER_HOUR)

    const body = await req.json()
    const queryRaw   = String(body?.query ?? '').slice(0, MAX_QUERY_LEN)
    const collection = Array.isArray(body?.collection) ? body.collection.slice(0, MAX_COLLECTION) : null
    const apiKey = Deno.env.get('GEMINI_API_KEY')

    if (!queryRaw.trim()) {
      return jsonResponse({ books: [], interpretation: '' })
    }
    const query = queryRaw

    // ── Build the Gemini prompt ──────────────────────────────────────────────
    // If the user's collection is provided, give Gemini context to answer
    // questions about it, or fall back to book discovery.
    let prompt: string
    const hasCollection = Array.isArray(collection) && collection.length > 0

    if (hasCollection) {
      const collectionText = collection
        .map((b: any) => {
          const parts = [`"${b.title}"`]
          if (b.author)      parts.push(`by ${b.author}`)
          if (b.genre)       parts.push(`(${b.genre})`)
          if (b.user_rating) parts.push(`— rated ${b.user_rating}/5`)
          if (b.read_status) parts.push(`[${b.read_status}]`)
          if (b.has_read && b.read_status !== 'read') parts.push(`[has read]`)
          return parts.join(' ')
        })
        .join('\n')

      prompt = `You are a warm, knowledgeable personal library assistant.

The user's book collection (${collection.length} books):
${collectionText}

The user asked: "${query}"

Decide which type of response is needed:

A) COLLECTION question — the user is asking about their own books (e.g. "best book", "what have I read", "recommend from my collection", "what should I read next", "my highest rated", etc.)
B) DISCOVERY request — the user wants to find NEW books to add (e.g. "thriller set in Japan", "books like Dune", "something by Stephen King")

If A: Answer conversationally in 2–4 sentences. Be specific — name actual books from their collection. If ratings are available, use them. Be warm and personal.
If B: Provide an optimised Google Books search query.

Respond with ONLY valid JSON — no markdown:
For A: {"type":"chat","answer":"Your helpful answer here...","interpretation":"One-line summary of what you found"}
For B: {"type":"search","searchQuery":"optimised search string","interpretation":"Short friendly description of the search"}`

    } else {
      prompt = `You are a book search assistant. A user typed this search query: "${query}"

Convert it into the best possible Google Books API search query string, and write a very short friendly interpretation (under 12 words) of what they're looking for.

Respond with ONLY valid JSON — no markdown, no explanation:
{"searchQuery":"the optimised Google Books search string","interpretation":"Short friendly description of the search..."}`
    }

    // ── Call Gemini ──────────────────────────────────────────────────────────
    let searchQuery  = query.trim()
    let interpretation = ''
    let chatAnswer: string | null = null
    let responseType = 'search'

    if (apiKey) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
            }),
          }
        )

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json()
          const parts: any[] = geminiData.candidates?.[0]?.content?.parts ?? []
          const text = parts
            .filter((p: any) => !p.thought && p.text)
            .map((p: any) => p.text as string)
            .join('')
          const stripped = text
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```\s*$/i, '')
            .trim()
          const parsed = JSON.parse(stripped)

          if (parsed.type === 'chat' && parsed.answer) {
            // Collection question — return the conversational answer directly
            responseType  = 'chat'
            chatAnswer    = parsed.answer
            interpretation = parsed.interpretation || ''
          } else {
            // Discovery search
            if (parsed.searchQuery) searchQuery  = parsed.searchQuery
            if (parsed.interpretation) interpretation = parsed.interpretation
          }
        }
      } catch {
        // Gemini failed — fall back to raw query
      }
    }

    // ── Chat response — no Google Books call needed ──────────────────────────
    if (responseType === 'chat') {
      return jsonResponse({ type: 'chat', answer: chatAnswer, interpretation })
    }

    // ── Discovery response — search Google Books ─────────────────────────────
    const googleRes = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(searchQuery)}&maxResults=12&langRestrict=en&printType=books`
    )

    if (!googleRes.ok) {
      return jsonResponse({ books: [], interpretation, error: 'google_books_error' })
    }

    const googleData = await googleRes.json()
    const books = (googleData.items || []).map((item: any) => ({
      id:           item.id,
      title:        item.volumeInfo.title || 'Unknown Title',
      author:       item.volumeInfo.authors?.[0] || null,
      year:         item.volumeInfo.publishedDate?.slice(0, 4) || null,
      cover:        item.volumeInfo.imageLinks?.thumbnail?.replace('http:', 'https:') || null,
      description:  item.volumeInfo.description?.slice(0, 280) || null,
      isbn13:       item.volumeInfo.industryIdentifiers?.find((i: any) => i.type === 'ISBN_13')?.identifier || null,
      isbn10:       item.volumeInfo.industryIdentifiers?.find((i: any) => i.type === 'ISBN_10')?.identifier || null,
      categories:   item.volumeInfo.categories || [],
      pageCount:    item.volumeInfo.pageCount || null,
      publisher:    item.volumeInfo.publisher || null,
      avgRating:    item.volumeInfo.averageRating || null,
      ratingsCount: item.volumeInfo.ratingsCount || null,
    }))

    return jsonResponse({ type: 'search', books, interpretation })
  } catch (err) {
    return handleError(err)
  }
})
