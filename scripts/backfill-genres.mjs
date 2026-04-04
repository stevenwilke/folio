#!/usr/bin/env node
/**
 * One-time genre backfill script.
 * Finds all books without a genre and fetches one from Google Books via our edge function.
 *
 * Usage:
 *   /usr/local/bin/node scripts/backfill-genres.mjs
 */

const SUPABASE_URL = 'https://wdafggpiyqahkktrmtem.supabase.co'
const SUPABASE_KEY = 'sb_publishable_Sj71IStue1xjaBcc8Q-QmQ_B6XOYCHu'
const DELAY_MS     = 300  // ms between requests (edge fn has its own rate limit handling)
const BATCH        = 8    // parallel requests per batch

const headers = {
  apikey:         SUPABASE_KEY,
  Authorization:  `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── Genre extraction (mirrors src/lib/genres.js) ─────────────────────────────

const GENRE_MAP = [
  ['Young Adult',        ['young adult', 'ya fiction', 'teen fiction', 'juvenile fiction']],
  ["Children's",         ["children's", 'juvenile literature', 'picture book', 'middle grade', 'juvenile nonfiction']],
  ['Science Fiction',    ['science fiction', 'sci-fi', 'dystopian', 'space opera', 'cyberpunk', 'time travel fiction']],
  ['Fantasy',            ['fantasy fiction', 'fantasy', 'high fantasy', 'epic fantasy', 'fairy tale', 'magic realism']],
  ['Mystery',            ['mystery fiction', 'mystery', 'detective', 'whodunit', 'cozy mystery', 'crime fiction']],
  ['Thriller',           ['thriller', 'suspense fiction', 'psychological thriller']],
  ['Horror',             ['horror fiction', 'horror', 'ghost stories', 'supernatural fiction']],
  ['Romance',            ['romance fiction', 'romance', 'love stories', 'romantic fiction']],
  ['Historical Fiction', ['historical fiction', 'historical novel']],
  ['Biography',          ['biography', 'autobiography', 'memoirs', 'memoir']],
  ['Self-Help',          ['self-help', 'personal development', 'motivational', 'health & fitness']],
  ['Poetry',             ['poetry', 'poems', 'verse']],
  ['Graphic Novel',      ['graphic novel', 'comics', 'manga', 'comics & graphic novels']],
  ['Non-Fiction',        ['history', 'science', 'natural history', 'philosophy', 'psychology', 'economics', 'politics', 'religion', 'travel', 'essays', 'technology', 'social science', 'true crime', 'sports']],
  ['Literary Fiction',   ['literary fiction', 'american fiction', 'english fiction', 'british fiction', 'fiction']],
]

const DIRECT_MAP = {
  'fiction':               'Literary Fiction',
  'biography & autobiography': 'Biography',
  'history':               'Non-Fiction',
  'science':               'Non-Fiction',
  'technology & engineering': 'Non-Fiction',
  'social science':        'Non-Fiction',
  'political science':     'Non-Fiction',
  'philosophy':            'Non-Fiction',
  'psychology':            'Non-Fiction',
  'religion':              'Non-Fiction',
  'nature':                'Non-Fiction',
  'health & fitness':      'Self-Help',
  'business & economics':  'Non-Fiction',
  'true crime':            'Non-Fiction',
  'sports & recreation':   'Non-Fiction',
  'comics & graphic novels': 'Graphic Novel',
  'juvenile fiction':      "Children's",
  'juvenile nonfiction':   "Children's",
  'young adult fiction':   'Young Adult',
  'young adult nonfiction': 'Young Adult',
}

function extractGenreFromGoogleCategories(categories) {
  if (!categories?.length) return null
  const combined = categories.map(c => c.toLowerCase()).join(' ')
  for (const [genre, keywords] of GENRE_MAP) {
    if (keywords.some(k => combined.includes(k))) return genre
  }
  const primary = categories[0].split('/')[0].trim()
  const lc = primary.toLowerCase()
  if (DIRECT_MAP[lc]) return DIRECT_MAP[lc]
  return primary.length <= 30 ? primary : primary.slice(0, 28) + '…'
}

// ── Supabase helpers ─────────────────────────────────────────────────────────

async function getBooksWithoutGenre() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/books?select=id,isbn_13,isbn_10,title,author&genre=is.null&limit=1000`,
    { headers }
  )
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`)
  return res.json()
}

/**
 * Fetch genre via edge function and ALSO save genre/description/isbn to DB
 * via service role key (bypasses RLS). Returns the genre string found.
 */
async function getGenreFromEdgeFn(book) {
  try {
    const isbn = book.isbn_13 || book.isbn_10
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-book-metadata`, {
      method:  'POST',
      headers,
      // Pass book_id so edge fn saves to DB using service role key
      body:    JSON.stringify({ isbn: isbn || null, title: book.title, author: book.author || null, book_id: book.id }),
      signal:  AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.found || !data.categories?.length) return null
    return extractGenreFromGoogleCategories(data.categories)
  } catch {
    return null
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching books without genres from Supabase…')
  const books = await getBooksWithoutGenre()
  console.log(`Found ${books.length} books without a genre.\n`)
  if (!books.length) { console.log('All books have genres!'); return }

  let found = 0, skipped = 0

  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH)
    await Promise.allSettled(batch.map(async (book, bi) => {
      const idx = i + bi + 1
      try {
        // getGenreFromEdgeFn passes book_id to edge fn, which saves to DB directly
        const genre = await getGenreFromEdgeFn(book)
        if (genre) {
          console.log(`  ✓ [${idx}/${books.length}] ${book.title} → ${genre}`)
          found++
        } else {
          console.log(`  ✗ [${idx}/${books.length}] No genre: ${book.title}`)
          skipped++
        }
      } catch (err) {
        console.log(`  ! [${idx}/${books.length}] Error: ${err.message}`)
        skipped++
      }
    }))

    const done = Math.min(i + BATCH, books.length)
    if (done % 40 === 0 || done === books.length) {
      console.log(`\n  → ${done}/${books.length} | ✓ ${found} genres set | ✗ ${skipped} skipped\n`)
    }

    if (i + BATCH < books.length) await sleep(DELAY_MS)
  }

  console.log(`\n✅ Done! ${found}/${books.length} books now have genres.`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
