import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { preflight, requireUser, serviceClient, rateLimit, jsonResponse, handleError } from '../_shared/auth.ts'

const MAX_QUERY_LEN = 200
const RATE_LIMIT_PER_HOUR = 60

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre

  try {
    const { user } = await requireUser(req)
    const admin = serviceClient()
    await rateLimit(admin, user.id, 'get-book-metadata', RATE_LIMIT_PER_HOUR)

    // book_id: if provided, save findings back to DB. Caller must have a
    // collection_entry for that book — prevents arbitrary book_id overwrite.
    const body = await req.json()
    const isbn   = body.isbn   ? String(body.isbn).slice(0, 20)        : null
    const title  = body.title  ? String(body.title).slice(0, MAX_QUERY_LEN)  : null
    const author = body.author ? String(body.author).slice(0, MAX_QUERY_LEN) : null
    const book_id = body.book_id ? String(body.book_id) : null
    const apiKey = Deno.env.get('GOOGLE_BOOKS_API_KEY') || ''

    if (book_id) {
      const { count } = await admin
        .from('collection_entries')
        .select('id', { head: true, count: 'exact' })
        .eq('user_id', user.id)
        .eq('book_id', book_id)
      if (!count || count === 0) {
        return jsonResponse({ found: false, error: 'You do not have this book in your library' }, 403)
      }
    }

    // Build query: prefer ISBN, fall back to title+author
    let q = ''
    if (isbn) {
      q = `isbn:${isbn}`
    } else if (title) {
      q = `${title}${author ? ` ${author.split(',')[0].trim()}` : ''}`
    }

    if (!q) {
      return jsonResponse({ found: false, error: 'No search terms provided' })
    }

    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3${apiKey ? `&key=${apiKey}` : ''}`
    const res = await fetch(url)
    const data = await res.json()

    if (!res.ok) {
      console.error('Google Books API error:', res.status)
      return jsonResponse({ found: false, error: `Google Books API error ${res.status}` })
    }

    const items = data.items || []
    if (!items.length) {
      return jsonResponse({ found: false })
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

    // Optionally save back to books table (requires book_id + ownership, checked above)
    if (book_id) {
      try {
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
          await admin.from('books').update(updates).eq('id', book_id)
        }
      } catch (saveErr) {
        console.error('Error saving to DB:', saveErr)
      }
    }

    return jsonResponse({
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
    })
  } catch (err) {
    return handleError(err)
  }
})
