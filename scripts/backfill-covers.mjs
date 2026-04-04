#!/usr/bin/env node
/**
 * One-time cover backfill script.
 * Finds all books without a cover_image_url and fetches one from Open Library.
 *
 * Strategy:
 *   1. Books WITH an ISBN → use covers.openlibrary.org/b/isbn/{ISBN}-L.jpg directly
 *      (no search required — instant, no rate limits)
 *   2. Books WITHOUT an ISBN → search OL by title+author (slower, rate-limited)
 *
 * Usage:
 *   /usr/local/bin/node scripts/backfill-covers.mjs
 */

const SUPABASE_URL = 'https://wdafggpiyqahkktrmtem.supabase.co'
const SUPABASE_KEY = 'sb_publishable_Sj71IStue1xjaBcc8Q-QmQ_B6XOYCHu'
const OL_UA        = 'folio-app/1.0 (book collection manager)'

const headers = {
  apikey:         SUPABASE_KEY,
  Authorization:  `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function cleanTitle(title) {
  return title
    .replace(/\s*\[.*?\]/g, '')        // remove [Paperback] [2009] etc.
    .replace(/\s*\(.*?(edition|ed\.?|paperback|hardcover|\d{4}-\d{2}-\d{2}).*?\)/gi, '')
    .replace(/\s*:\s*$/, '')           // trailing colon
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Supabase helpers ─────────────────────────────────────────────────────────

async function getBooksMissingCovers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/books?select=id,isbn_13,isbn_10,title,author&cover_image_url=is.null&limit=1000`,
    { headers }
  )
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`)
  return res.json()
}

/**
 * Upload cover image to Supabase Storage via edge function (bypasses RLS).
 * The edge function downloads the image, uploads to Storage, and updates the DB.
 */
async function updateBookCover(id, coverUrl) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-book-cover`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ book_id: id, cover_url: coverUrl }),
    signal:  AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`upload-book-cover failed: ${res.status} ${txt.slice(0,100)}`)
  }
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'upload failed')
}

// ── Open Library helpers ─────────────────────────────────────────────────────

/**
 * Check if an OL cover URL actually has an image.
 * OL redirects valid covers to Internet Archive (image/jpeg).
 * Missing covers stay at the original URL with no Content-Type.
 */
async function coverExists(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': OL_UA },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })
    if (!res.ok) return false
    const ct = res.headers.get('content-type') || ''
    // Valid covers redirect to archive.org and return image/jpeg
    return ct.includes('image/jpeg') || ct.includes('image/png')
  } catch {
    return false
  }
}

/**
 * Google Books cover via our Supabase edge function (uses API key server-side).
 * This avoids exposing the key and uses the authenticated quota (10k/day).
 */
async function googleBooksCover(isbn, title, author) {
  try {
    const body = JSON.stringify({ isbn: isbn || null, title, author: author || null })
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/get-book-metadata`,
      {
        method:  'POST',
        headers: { ...headers, 'User-Agent': OL_UA },
        body,
        signal: AbortSignal.timeout(15000),
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data?.found && data.cover ? data.cover : null
  } catch {
    return null
  }
}

async function olSearchCover(title, author) {
  try {
    const params = new URLSearchParams({
      title:  cleanTitle(title),
      fields: 'cover_i',
      limit:  '5',
    })
    if (author) params.set('author', author.split(',')[0].trim())

    const res = await fetch(`https://openlibrary.org/search.json?${params}`, {
      headers: { 'User-Agent': OL_UA },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('json')) return null  // rate-limited → HTML page
    const d = await res.json()
    for (const doc of d.docs || []) {
      if (doc.cover_i) return `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
    }
  } catch { /* timeout or network error */ }
  return null
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching books with missing covers from Supabase…')
  const books = await getBooksMissingCovers()
  console.log(`Found ${books.length} books without a cover.\n`)
  if (!books.length) { console.log('Nothing to do!'); return }

  const withISBN    = books.filter(b => b.isbn_13 || b.isbn_10)
  const withoutISBN = books.filter(b => !b.isbn_13 && !b.isbn_10)
  console.log(`  ${withISBN.length} books have an ISBN (fast path)`)
  console.log(`  ${withoutISBN.length} books have no ISBN (search path)\n`)

  let found = 0, skipped = 0

  // ── Phase 1: ISBN direct cover URL (fast, no rate limits) ────────────────
  console.log('── Phase 1: ISBN direct covers ──────────────────────────────')
  const BATCH1 = 10
  for (let i = 0; i < withISBN.length; i += BATCH1) {
    const batch = withISBN.slice(i, i + BATCH1)
    await Promise.allSettled(batch.map(async (book, bi) => {
      const idx  = i + bi + 1
      const isbn = book.isbn_13 || book.isbn_10
      const url  = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`
      try {
        const ok = await coverExists(url)
        if (ok) {
          await updateBookCover(book.id, url)
          console.log(`  ✓ [${idx}/${withISBN.length}] ${book.title}`)
          found++
        } else {
          // OL doesn't have this ISBN — try Google Books
          const gbUrl = await googleBooksCover(isbn, book.title, book.author)
          if (gbUrl) {
            await updateBookCover(book.id, gbUrl)
            console.log(`  ✓ [${idx}/${withISBN.length}] (Google Books) ${book.title}`)
            found++
          } else {
            console.log(`  ✗ [${idx}/${withISBN.length}] No cover found: ${book.title}`)
            skipped++
          }
        }
      } catch (err) {
        console.log(`  ! [${idx}/${withISBN.length}] Error: ${err.message}`)
        skipped++
      }
    }))
    if (i + BATCH1 < withISBN.length) await sleep(200)
  }

  console.log(`\n  Phase 1 done: ${found} found, ${skipped} skipped\n`)

  // ── Phase 2: Search by title+author for no-ISBN books ────────────────────
  if (withoutISBN.length) {
    console.log('── Phase 2: Title+author search ─────────────────────────────')
    let p2found = 0, p2skipped = 0

    for (let i = 0; i < withoutISBN.length; i++) {
      const book = withoutISBN[i]
      const idx  = i + 1
      try {
        let url = await olSearchCover(book.title, book.author)
        if (!url) url = await googleBooksCover(null, book.title, book.author)
        if (url) {
          await updateBookCover(book.id, url)
          console.log(`  ✓ [${idx}/${withoutISBN.length}] ${book.title}`)
          p2found++; found++
        } else {
          console.log(`  ✗ [${idx}/${withoutISBN.length}] Not found: ${book.title}`)
          p2skipped++; skipped++
        }
      } catch (err) {
        console.log(`  ! [${idx}/${withoutISBN.length}] Error: ${err.message}`)
        p2skipped++; skipped++
      }
      await sleep(800)  // be respectful of OL's API limits
    }
    console.log(`\n  Phase 2 done: ${p2found} found, ${p2skipped} skipped\n`)
  }

  console.log(`\n✅ Done! ${found}/${books.length} books now have covers.`)
  if (skipped > 0) {
    console.log(`   ${skipped} books still need covers — use the book detail page to set them manually.`)
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
