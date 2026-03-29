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
    const { query } = await req.json()
    const apiKey = Deno.env.get('GEMINI_API_KEY')

    if (!query?.trim()) {
      return new Response(
        JSON.stringify({ books: [], interpretation: '' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let searchQuery = query.trim()
    let interpretation = ''

    // Use Gemini to interpret the natural language query into optimised search terms
    if (apiKey) {
      const prompt = `You are a book search assistant. A user typed this search query: "${query}"

Convert it into the best possible Google Books API search query string, and write a very short friendly interpretation (under 12 words) of what they're looking for.

Respond with ONLY valid JSON — no markdown, no explanation:
{"searchQuery":"the optimised Google Books search string","interpretation":"Short friendly description of the search..."}`

      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
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
          if (parsed.searchQuery) searchQuery = parsed.searchQuery
          if (parsed.interpretation) interpretation = parsed.interpretation
        }
      } catch {
        // Gemini failed — fall back to raw query, no interpretation
      }
    }

    // Search Google Books API
    const googleRes = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(searchQuery)}&maxResults=12&langRestrict=en&printType=books`
    )

    if (!googleRes.ok) {
      return new Response(
        JSON.stringify({ books: [], interpretation, error: 'google_books_error' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const googleData = await googleRes.json()
    const books = (googleData.items || []).map((item: any) => ({
      id:          item.id,
      title:       item.volumeInfo.title || 'Unknown Title',
      author:      item.volumeInfo.authors?.[0] || null,
      year:        item.volumeInfo.publishedDate?.slice(0, 4) || null,
      cover:       item.volumeInfo.imageLinks?.thumbnail?.replace('http:', 'https:') || null,
      description: item.volumeInfo.description?.slice(0, 280) || null,
      isbn13:      item.volumeInfo.industryIdentifiers?.find((i: any) => i.type === 'ISBN_13')?.identifier || null,
      isbn10:      item.volumeInfo.industryIdentifiers?.find((i: any) => i.type === 'ISBN_10')?.identifier || null,
      categories:  item.volumeInfo.categories || [],
      pageCount:   item.volumeInfo.pageCount || null,
      publisher:   item.volumeInfo.publisher || null,
      avgRating:   item.volumeInfo.averageRating || null,
      ratingsCount:item.volumeInfo.ratingsCount || null,
    }))

    return new Response(
      JSON.stringify({ books, interpretation }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('ai-book-search error:', err)
    return new Response(
      JSON.stringify({ books: [], interpretation: '', error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
