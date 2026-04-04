import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // book_id: if provided, save findings back to DB using service role key
    const { isbn, title, author, book_id } = await req.json()
    const apiKey = Deno.env.get('GOOGLE_BOOKS_API_KEY') || ''

    // Build query: prefer ISBN, fall back to title+author
    let q = ''
    if (isbn) {
      q = `isbn:${isbn}`
    } else if (title) {
      q = `${title}${author ? ` ${author.split(',')[0].trim()}` : ''}`
    }

    if (!q) {
      return new Response(
        JSON.stringify({ found: false, error: 'No search terms provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3${apiKey ? `&key=${apiKey}` : ''}`
    const res = await fetch(url)
    const data = await res.json()

    if (!res.ok) {
      console.error('Google Books API error:', res.status, JSON.stringify(data).slice(0, 200))
      return new Response(
        JSON.stringify({ found: false, error: `Google Books API error ${res.status}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const items = data.items || []
    if (!items.length) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Pick the best match — prefer exact title match if searching by title
    const item = items[0]
    const info = item.volumeInfo || {}

    // Extract description
    const description = info.description || null

    // Extract the best cover URL (largest available)
    const links = info.imageLinks || {}
    let cover = links.extraLarge || links.large || links.medium || links.small || links.thumbnail || null
    if (cover) {
      cover = cover
        .replace(/^http:/, 'https:')
        .replace(/&edge=curl/, '')
        .replace(/&zoom=\d/, '')
      // Request a large image from Google's image serving infrastructure
      if (!cover.includes('fife=')) cover += '&fife=w800'
    }

    // Extract ISBNs from industryIdentifiers
    const identifiers = info.industryIdentifiers || []
    const isbn_13 = identifiers.find((x: any) => x.type === 'ISBN_13')?.identifier || null
    const isbn_10 = identifiers.find((x: any) => x.type === 'ISBN_10')?.identifier || null

    // Extract other useful fields
    const published_year = info.publishedDate ? parseInt(info.publishedDate.slice(0, 4)) : null
    const categories     = info.categories || []
    const page_count     = info.pageCount || null
    const publisher      = info.publisher || null
    const subtitle       = info.subtitle || null

    // Optionally save back to books table (requires book_id in request)
    if (book_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase    = createClient(supabaseUrl, serviceKey)

        // Build genre from categories
        const genreKeywords: Record<string, string[]> = {
          'Young Adult':        ['young adult', 'teen fiction', 'juvenile fiction'],
          "Children's":         ["children's", 'juvenile literature', 'juvenile nonfiction'],
          'Science Fiction':    ['science fiction', 'sci-fi', 'dystopian', 'cyberpunk'],
          'Fantasy':            ['fantasy'],
          'Mystery':            ['mystery', 'detective', 'crime fiction'],
          'Thriller':           ['thriller', 'suspense'],
          'Horror':             ['horror'],
          'Romance':            ['romance'],
          'Historical Fiction': ['historical fiction'],
          'Biography':          ['biography', 'autobiography', 'memoir'],
          'Self-Help':          ['self-help', 'personal development', 'health & fitness'],
          'Graphic Novel':      ['graphic novel', 'comics', 'manga'],
          'Non-Fiction':        ['history', 'science', 'philosophy', 'psychology', 'economics', 'politics', 'religion', 'technology', 'social science', 'true crime', 'sports'],
          'Literary Fiction':   ['literary fiction', 'fiction'],
        }
        const directGenreMap: Record<string, string> = {
          'fiction': 'Literary Fiction', 'biography & autobiography': 'Biography',
          'history': 'Non-Fiction', 'science': 'Non-Fiction', 'technology & engineering': 'Non-Fiction',
          'social science': 'Non-Fiction', 'political science': 'Non-Fiction', 'philosophy': 'Non-Fiction',
          'psychology': 'Non-Fiction', 'religion': 'Non-Fiction', 'nature': 'Non-Fiction',
          'health & fitness': 'Self-Help', 'business & economics': 'Non-Fiction',
          'comics & graphic novels': 'Graphic Novel', 'juvenile fiction': "Children's",
          'young adult fiction': 'Young Adult',
        }
        let genre: string | null = null
        if (categories.length) {
          const combined = categories.map((c: string) => c.toLowerCase()).join(' ')
          for (const [g, kws] of Object.entries(genreKeywords)) {
            if (kws.some(k => combined.includes(k))) { genre = g; break }
          }
          if (!genre) {
            const primary = categories[0].split('/')[0].trim()
            genre = directGenreMap[primary.toLowerCase()] || (primary.length <= 30 ? primary : primary.slice(0, 28) + '…')
          }
        }

        const updates: Record<string, any> = {}
        if (description)    updates.description    = description
        if (genre)          updates.genre          = genre
        if (isbn_13)        updates.isbn_13        = isbn_13
        if (isbn_10)        updates.isbn_10        = isbn_10
        if (published_year) updates.published_year = published_year

        if (Object.keys(updates).length > 0) {
          await supabase.from('books').update(updates).eq('id', book_id)
        }
      } catch (saveErr) {
        console.error('Error saving to DB:', saveErr)
      }
    }

    return new Response(
      JSON.stringify({
        found:        true,
        description,
        cover,
        isbn_13,
        isbn_10,
        published_year,
        categories,
        page_count,
        publisher,
        subtitle,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Unhandled error:', err)
    return new Response(
      JSON.stringify({ found: false, error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
