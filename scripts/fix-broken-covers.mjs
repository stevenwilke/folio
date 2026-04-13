#!/usr/bin/env node
/**
 * One-time script: find books with broken cover images, clear them,
 * then re-fetch fresh covers from Open Library.
 *
 * Run: node scripts/fix-broken-covers.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://wdafggpiyqahkktrmtem.supabase.co'
const SUPABASE_KEY = 'sb_publishable_Sj71IStue1xjaBcc8Q-QmQ_B6XOYCHu'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Helpers ──────────────────────────────────────────────────────────────

async function isImageBroken(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    if (!res.ok) return true
    const ct = res.headers.get('content-type') || ''
    if (!ct.startsWith('image/')) return true
    const cl = parseInt(res.headers.get('content-length') || '0', 10)
    if (cl > 0 && cl < 1000) return true  // tiny placeholder
    return false
  } catch {
    return true
  }
}

async function fetchOLCover(isbn, title, author) {
  try {
    if (isbn) {
      const r = await fetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=cover_i&limit=1`)
      if (r.ok) {
        const d = await r.json()
        const coverId = d.docs?.[0]?.cover_i
        if (coverId) return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
      }
    }
    if (title) {
      const q = encodeURIComponent(`${title} ${author || ''}`.trim())
      const r = await fetch(`https://openlibrary.org/search.json?q=${q}&fields=cover_i&limit=3`)
      if (r.ok) {
        const d = await r.json()
        for (const doc of d.docs || []) {
          if (doc.cover_i) return `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
        }
      }
    }
  } catch {}
  return null
}

async function uploadToStorage(coverUrl, bookId) {
  try {
    const res = await fetch(coverUrl)
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.size || blob.size < 1000) return null
    if (!blob.type.startsWith('image/')) return null
    const ext = blob.type === 'image/png' ? 'png' : 'jpg'
    const path = `${bookId}.${ext}`
    const buf = Buffer.from(await blob.arrayBuffer())
    const { error } = await supabase.storage
      .from('book-covers')
      .upload(path, buf, { contentType: blob.type, upsert: true })
    if (error) return null
    const { data } = supabase.storage.from('book-covers').getPublicUrl(path)
    return data.publicUrl
  } catch {
    return null
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching all books with cover URLs...')

  const { data: books, error } = await supabase
    .from('books')
    .select('id, title, author, isbn_13, isbn_10, cover_image_url')
    .not('cover_image_url', 'is', null)
    .limit(5000)

  if (error) { console.error('Failed to fetch books:', error.message); return }
  console.log(`Found ${books.length} books with cover URLs. Checking each...\n`)

  const broken = []
  const BATCH = 10

  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH)
    const results = await Promise.all(batch.map(async b => {
      const bad = await isImageBroken(b.cover_image_url)
      return { book: b, bad }
    }))
    for (const { book, bad } of results) {
      if (bad) {
        broken.push(book)
        console.log(`  BROKEN: "${book.title}" — ${book.cover_image_url}`)
      }
    }
    process.stdout.write(`  Checked ${Math.min(i + BATCH, books.length)}/${books.length}\r`)
  }

  console.log(`\n\nFound ${broken.length} broken covers out of ${books.length} total.`)
  if (broken.length === 0) {
    console.log('Nothing to fix!')
    return
  }

  console.log('\nClearing broken URLs and re-fetching covers...\n')

  let fixed = 0
  let cleared = 0

  for (const book of broken) {
    // Clear the broken URL first
    await supabase.from('books').update({ cover_image_url: null }).eq('id', book.id)
    cleared++

    // Try to fetch a fresh cover
    const isbn = book.isbn_13 || book.isbn_10 || null
    const freshUrl = await fetchOLCover(isbn, book.title, book.author)

    if (freshUrl) {
      // Upload to our storage
      const storedUrl = await uploadToStorage(freshUrl, book.id)
      if (storedUrl) {
        await supabase.from('books').update({ cover_image_url: storedUrl }).eq('id', book.id)
        console.log(`  ✓ FIXED: "${book.title}" — new cover stored`)
        fixed++
      } else {
        // Use the direct OL URL as fallback
        await supabase.from('books').update({ cover_image_url: freshUrl }).eq('id', book.id)
        console.log(`  ~ FIXED (OL direct): "${book.title}"`)
        fixed++
      }
    } else {
      console.log(`  ✗ NO COVER FOUND: "${book.title}" — URL cleared, will use fallback`)
    }

    // Be nice to Open Library
    await new Promise(r => setTimeout(r, 400))
  }

  console.log(`\nDone! Cleared ${cleared} broken covers, re-fetched ${fixed}.`)
}

main().catch(console.error)
