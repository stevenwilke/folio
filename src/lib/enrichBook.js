import { supabase } from './supabase'

function isLikelyEnglish(text) {
  if (!text || text.length < 10) return false
  const nonLatin = (text.match(/[^\x00-\x7F]/g) || []).length
  return (nonLatin / text.length) < 0.2
}

async function fetchOLCover(isbn, title, author) {
  try {
    if (isbn) {
      const res = await fetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=cover_i&limit=1`)
      if (res.ok) {
        const data = await res.json()
        const coverId = data?.docs?.[0]?.cover_i
        if (coverId) return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
      }
    }
    const q = encodeURIComponent(`${title || ''} ${author || ''}`.trim())
    const res = await fetch(`https://openlibrary.org/search.json?q=${q}&fields=cover_i&limit=1`)
    if (res.ok) {
      const data = await res.json()
      const coverId = data?.docs?.[0]?.cover_i
      if (coverId) return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
    }
  } catch {}
  return null
}

async function fetchOLDescription(isbn, title, author) {
  try {
    if (isbn) {
      const res = await fetch(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`)
      if (res.ok) {
        const data = await res.json()
        const workKey = data.works?.[0]?.key
        if (workKey) {
          const workRes = await fetch(`https://openlibrary.org${workKey}.json`)
          if (workRes.ok) {
            const workData = await workRes.json()
            const desc = workData.description
            if (desc) {
              const text = typeof desc === 'object' ? desc.value : desc
              if (isLikelyEnglish(text)) return text
            }
          }
        }
      }
    }
    const q = encodeURIComponent(`${title || ''} ${author || ''}`.trim())
    const searchRes = await fetch(`https://openlibrary.org/search.json?q=${q}&fields=key&limit=3`)
    if (!searchRes.ok) return null
    const searchData = await searchRes.json()
    for (const doc of searchData.docs || []) {
      const workRes = await fetch(`https://openlibrary.org${doc.key}.json`)
      if (!workRes.ok) continue
      const workData = await workRes.json()
      const desc = workData.description
      if (desc) {
        const text = typeof desc === 'object' ? desc.value : desc
        if (isLikelyEnglish(text)) return text
      }
    }
  } catch {}
  return null
}

/**
 * Enriches a book record with cover, description, and pricing.
 * Call this AFTER inserting a book — do NOT await it (runs in background).
 *
 * @param {string} bookId - the Supabase UUID of the inserted book
 * @param {object} bookData - { isbn_13, isbn_10, title, author, cover_image_url, description }
 */
export async function enrichBook(bookId, { isbn_13, isbn_10, title, author, cover_image_url, description } = {}) {
  if (!bookId) return
  const isbn = isbn_13 || isbn_10 || null

  // Only fetch what's missing
  const needsCover = !cover_image_url
  const needsDesc  = !description

  const [cover, desc, valResult] = await Promise.all([
    needsCover ? fetchOLCover(isbn, title, author) : Promise.resolve(null),
    needsDesc  ? fetchOLDescription(isbn, title, author) : Promise.resolve(null),
    supabase.functions.invoke('get-book-valuation', { body: { isbn, title, author } }),
  ])

  // Update books table with whatever we found
  const updates = {}
  if (cover) updates.cover_image_url = cover
  if (desc)  updates.description      = desc
  if (Object.keys(updates).length > 0) {
    await supabase.from('books').update(updates).eq('id', bookId)
  }

  // Store valuation
  const valData = valResult?.data
  if (valData?.found) {
    await supabase.from('valuations').upsert({
      book_id:             bookId,
      list_price:          valData.list_price          ?? null,
      list_price_currency: valData.list_price_currency ?? null,
      avg_price:           valData.avg_price           ?? null,
      min_price:           valData.min_price           ?? null,
      max_price:           valData.max_price           ?? null,
      sample_count:        valData.sample_count        ?? null,
      currency:            valData.currency            || 'USD',
      fetched_at:          new Date().toISOString(),
    }, { onConflict: 'book_id' })
  } else {
    // Cache the miss so BookDetail doesn't retry immediately
    await supabase.from('valuations').upsert({
      book_id:    bookId,
      avg_price:  null,
      list_price: null,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'book_id' })
  }
}
