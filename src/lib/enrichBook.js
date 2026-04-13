import { supabase } from './supabase'
import { fetchUsedPrices } from './fetchUsedPrices'

function isLikelyEnglish(text) {
  if (!text || text.length < 10) return false
  const nonLatin = (text.match(/[^\x00-\x7F]/g) || []).length
  return (nonLatin / text.length) < 0.2
}

// ── Open Library cover ────────────────────────────────────────────────────
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
    const res = await fetch(`https://openlibrary.org/search.json?q=${q}&fields=cover_i&limit=3`)
    if (res.ok) {
      const data = await res.json()
      for (const doc of data?.docs || []) {
        if (doc.cover_i) return `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      }
    }
  } catch {}
  return null
}

// ── Combined cover fetch via Open Library ────────────────────────────────
async function fetchBestCover(isbn, title, author) {
  return fetchOLCover(isbn, title, author)
}

// ── Upload cover to Supabase Storage (our own CDN cache) ─────────────────
// Falls back to the original URL on CORS errors or upload failures.
export async function uploadCoverToStorage(coverUrl, bookId) {
  if (!coverUrl || !bookId) return coverUrl
  try {
    const res = await fetch(coverUrl)
    if (!res.ok) return coverUrl
    const blob = await res.blob()
    // Reject empty, tiny (likely placeholder), or non-image responses
    if (!blob.size || blob.size < 1000) return coverUrl
    if (!blob.type.startsWith('image/')) return coverUrl
    const ext = blob.type === 'image/png' ? 'png' : 'jpg'
    const path = `${bookId}.${ext}`
    const { error } = await supabase.storage
      .from('book-covers')
      .upload(path, blob, { contentType: blob.type, upsert: true })
    if (error) return coverUrl
    const { data } = supabase.storage.from('book-covers').getPublicUrl(path)
    return data.publicUrl
  } catch {
    return coverUrl
  }
}

// ── Open Library description ──────────────────────────────────────────────
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

// Whether a stored URL is a low-quality placeholder we should upgrade
function isLowQualityCover(url) {
  if (!url) return true
  if (url.includes('-S.jpg') || url.includes('-M.jpg')) return true
  if (url.includes('zoom=1')) return true   // small thumbnail
  return false
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

  // Fetch cover if missing or only a low-quality placeholder
  const needsCover = isLowQualityCover(cover_image_url)
  const needsDesc  = !description

  const [cover, desc, valResult, usedResult] = await Promise.all([
    needsCover ? fetchBestCover(isbn, title, author) : Promise.resolve(null),
    needsDesc  ? fetchOLDescription(isbn, title, author) : Promise.resolve(null),
    supabase.functions.invoke('get-book-valuation', { body: { isbn, title, author } }),
    fetchUsedPrices(isbn, title, author),
  ])

  // Upload cover to our Storage bucket so it's cached on our CDN
  const storedCover = cover ? await uploadCoverToStorage(cover, bookId) : null

  // Update books table with whatever we found
  const updates = {}
  if (storedCover) updates.cover_image_url = storedCover
  if (desc)        updates.description      = desc
  if (Object.keys(updates).length > 0) {
    await supabase.from('books').update(updates).eq('id', bookId)
  }

  // Store valuation (retail from Edge Function + used from ThriftBooks)
  const valData = valResult?.data
  const used = usedResult
  if (valData?.found || used) {
    await supabase.from('valuations').upsert({
      book_id:             bookId,
      list_price:          valData?.list_price ?? used?.new_price ?? null,
      list_price_currency: valData?.list_price_currency ?? (used?.new_price ? 'USD' : null),
      avg_price:           used?.avg_price              ?? null,
      min_price:           used?.min_price              ?? null,
      max_price:           used?.max_price              ?? null,
      sample_count:        used?.sample_count           ?? null,
      paperback_avg:       used?.paperback_avg          ?? null,
      hardcover_avg:       used?.hardcover_avg          ?? null,
      currency:            valData?.currency            || 'USD',
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

/**
 * Backfills covers for a list of books that are missing them.
 * Pass the raw book rows from the collection query.
 * Processes up to `limit` books at a time to avoid hammering the APIs.
 */
export async function backfillMissingCovers(books, limit = 8) {
  const missing = books.filter(b => isLowQualityCover(b.cover_image_url))
  if (missing.length === 0) return

  const batch = missing.slice(0, limit)
  await Promise.allSettled(
    batch.map(b =>
      fetchBestCover(b.isbn_13 || b.isbn_10 || null, b.title, b.author)
        .then(cover => cover ? uploadCoverToStorage(cover, b.id) : null)
        .then(coverUrl => {
          if (coverUrl) {
            return supabase.from('books').update({ cover_image_url: coverUrl }).eq('id', b.id)
          }
        })
    )
  )
}
