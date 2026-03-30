import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ISBNDBBook {
  title?: string
  title_long?: string
  isbn?: string
  isbn13?: string
  authors?: string[] | string
  publisher?: string
  date_published?: string
  image?: string
  synopsis?: string
  pages?: number
  subjects?: string[]
  language?: string
}

function normalizeBook(b: ISBNDBBook) {
  const author = Array.isArray(b.authors)
    ? b.authors[0] || null
    : (b.authors || null)

  return {
    title:       b.title || b.title_long || 'Unknown Title',
    author:      author,
    isbn13:      b.isbn13 || null,
    isbn10:      b.isbn   || null,
    cover:       b.image  || null,
    year:        b.date_published ? String(b.date_published).slice(0, 4) : null,
    description: b.synopsis ? b.synopsis.slice(0, 240) : null,
    categories:  b.subjects || [],
    pageCount:   b.pages    || null,
    publisher:   b.publisher || null,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('ISBNDB_API_KEY')
    if (!apiKey) throw new Error('ISBNDB_API_KEY not configured')

    const { q, isbn, pageSize = 12 } = await req.json()

    let books: ReturnType<typeof normalizeBook>[] = []

    if (isbn) {
      // Lookup by ISBN
      const res = await fetch(
        `https://api2.isbndb.com/book/${encodeURIComponent(isbn)}`,
        { headers: { Authorization: apiKey } }
      )
      if (res.ok) {
        const data = await res.json()
        if (data.book) books = [normalizeBook(data.book)]
      }
    } else if (q) {
      // Text search
      const res = await fetch(
        `https://api2.isbndb.com/books/${encodeURIComponent(q)}?page=1&pageSize=${pageSize}`,
        { headers: { Authorization: apiKey } }
      )
      if (res.ok) {
        const data = await res.json()
        books = (data.books || []).map(normalizeBook)
      }
    }

    return new Response(
      JSON.stringify({ books }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ books: [], error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
