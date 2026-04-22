import { supabase } from './supabase'

/**
 * Fetch a "default" rating for a book from third-party sources. We try
 * Google Books first (broad coverage), then Open Library as a fallback.
 *
 * Used as a placeholder so books that no Ex Libris user has rated still show
 * *some* signal. The display layer hides it the moment any community rating
 * exists for the book.
 *
 * Returns { rating, count, source } or null on miss.
 */
export async function fetchExternalRating({ isbn_13, isbn_10, title, author } = {}) {
  const isbn = isbn_13 || isbn_10 || null
  const gb = await fetchGoogleBooksRating(isbn, title, author)
  if (gb) return gb
  const ol = await fetchOpenLibraryRating(isbn, title, author)
  if (ol) return ol
  return null
}

async function fetchGoogleBooksRating(isbn, title, author) {
  try {
    const q = isbn
      ? `isbn:${isbn}`
      : `intitle:${title || ''}${author ? `+inauthor:${author}` : ''}`
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    for (const item of (data.items || [])) {
      const vi = item.volumeInfo
      if (vi?.averageRating != null && vi.ratingsCount > 0) {
        return {
          rating: Number(vi.averageRating),
          count:  Number(vi.ratingsCount),
          source: 'google_books',
        }
      }
    }
  } catch {}
  return null
}

async function fetchOpenLibraryRating(isbn, title, author) {
  try {
    // Step 1: find the work id
    let workKey = null
    if (isbn) {
      const r = await fetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=key&limit=1`)
      if (r.ok) {
        const d = await r.json()
        workKey = d?.docs?.[0]?.key || null
      }
    }
    if (!workKey && (title || author)) {
      const q = encodeURIComponent(`${title || ''} ${author || ''}`.trim())
      const r = await fetch(`https://openlibrary.org/search.json?q=${q}&fields=key&limit=1`)
      if (r.ok) {
        const d = await r.json()
        workKey = d?.docs?.[0]?.key || null
      }
    }
    if (!workKey) return null
    if (!workKey.startsWith('/works/')) return null

    // Step 2: pull the ratings summary for that work
    const r = await fetch(`https://openlibrary.org${workKey}/ratings.json`)
    if (!r.ok) return null
    const d = await r.json()
    const avg = d?.summary?.average
    const count = d?.summary?.count
    if (avg && count > 0) {
      return { rating: Number(avg), count: Number(count), source: 'open_library' }
    }
  } catch {}
  return null
}

/**
 * Fetch the rating and persist it to the books row. Safe to call multiple
 * times — overwrites with the latest snapshot. Background-friendly.
 */
export async function syncExternalRating(bookId, bookData) {
  if (!bookId) return
  const result = await fetchExternalRating(bookData || {})
  const update = result
    ? {
        external_rating: result.rating,
        external_rating_count: result.count,
        external_rating_source: result.source,
        external_rating_fetched_at: new Date().toISOString(),
      }
    : {
        // Cache the miss so we don't hammer the APIs every time the book is opened.
        external_rating_fetched_at: new Date().toISOString(),
      }
  await supabase.from('books').update(update).eq('id', bookId)
  return result
}

/**
 * Decide which rating to display for a book:
 *   - If any Ex Libris user has rated it → use the community rating.
 *   - Otherwise, if we have an external rating cached → use that.
 *
 * `community` is the row from the book_ratings view (or null).
 * `book` is the books row (must include external_rating fields).
 */
export function getDisplayRating(community, book) {
  if (community && community.rating_count > 0) {
    return {
      kind: 'community',
      avg: parseFloat(community.avg_rating),
      count: community.rating_count,
      source: 'Ex Libris',
    }
  }
  if (book?.external_rating != null && book?.external_rating_count > 0) {
    return {
      kind: 'external',
      avg: Number(book.external_rating),
      count: Number(book.external_rating_count),
      source: book.external_rating_source === 'open_library' ? 'Open Library' : 'Google Books',
    }
  }
  return null
}
