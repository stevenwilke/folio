#!/usr/bin/env node
/**
 * Uploads all external cover image URLs (Open Library, Google Books CDN)
 * to Supabase Storage so they load from our own CDN instead.
 *
 * Uses the upload-book-cover edge function (server-side service role access).
 *
 * Usage:
 *   /usr/local/bin/node scripts/upload-covers-to-storage.mjs
 */

const SUPABASE_URL = 'https://wdafggpiyqahkktrmtem.supabase.co'
const SUPABASE_KEY = 'sb_publishable_Sj71IStue1xjaBcc8Q-QmQ_B6XOYCHu'
const BATCH        = 4    // parallel uploads per batch
const DELAY_MS     = 500  // ms between batches

const headers = {
  apikey:         SUPABASE_KEY,
  Authorization:  `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function isExternalCoverUrl(url) {
  if (!url) return false
  // Only migrate external URLs (not already on Supabase Storage)
  return !url.includes('supabase.co/storage') && !url.includes('supabase.in/storage')
}

async function getBooksWithExternalCovers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/books?select=id,title,cover_image_url&cover_image_url=not.is.null&limit=1000`,
    { headers }
  )
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`)
  const all = await res.json()
  return all.filter(b => isExternalCoverUrl(b.cover_image_url))
}

async function uploadCoverViaEdgeFn(book_id, cover_url) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-book-cover`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ book_id, cover_url }),
    signal:  AbortSignal.timeout(30000),
  })
  if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
  return res.json()
}

async function main() {
  console.log('Fetching books with external cover URLs…')
  const books = await getBooksWithExternalCovers()
  console.log(`Found ${books.length} books with external covers to migrate.\n`)
  if (!books.length) { console.log('All covers already self-hosted!'); return }

  let success = 0, failed = 0

  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH)
    await Promise.allSettled(batch.map(async (book, bi) => {
      const idx = i + bi + 1
      try {
        const result = await uploadCoverViaEdgeFn(book.id, book.cover_image_url)
        if (result.success) {
          console.log(`  ✓ [${idx}/${books.length}] ${book.title}`)
          success++
        } else {
          console.log(`  ✗ [${idx}/${books.length}] ${book.title}: ${result.error}`)
          failed++
        }
      } catch (err) {
        console.log(`  ! [${idx}/${books.length}] ${book.title}: ${err.message}`)
        failed++
      }
    }))

    const done = Math.min(i + BATCH, books.length)
    if (done % 40 === 0 || done === books.length) {
      console.log(`\n  → ${done}/${books.length} | ✓ ${success} uploaded | ✗ ${failed} failed\n`)
    }

    if (i + BATCH < books.length) await sleep(DELAY_MS)
  }

  console.log(`\n✅ Done! ${success}/${books.length} covers now self-hosted on Supabase Storage.`)
  if (failed > 0) {
    console.log(`   ${failed} covers couldn't be uploaded (likely the image CDN was unreachable).`)
    console.log(`   Re-run this script to retry them.`)
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
