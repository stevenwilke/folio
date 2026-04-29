import { supabase } from './supabase'
import { extractGenre } from './genres'

const PREFIX_RE = /^(oclc|lccn|issn|recordnumber|record|htrec)\s*[:/\s]\s*([\w-]+)$/i
const URL_RE = /catalog\.hathitrust\.org\/Record\/(\w+)/i

// Recognize an explicit HathiTrust identifier in a search box so users can
// paste a catalog URL or `oclc:12345` / `lccn:foo` / `record:000577141` and
// jump straight to that exact record. Returns null for normal title/ISBN
// queries (those go through the standard search path).
export function parseHathitrustQuery(q) {
  if (!q) return null
  const trimmed = q.trim()
  const url = trimmed.match(URL_RE)
  if (url) return { type: 'recordnumber', value: url[1] }
  const pre = trimmed.match(PREFIX_RE)
  if (pre) {
    const prefix = pre[1].toLowerCase()
    const type = prefix === 'record' || prefix === 'htrec' ? 'recordnumber' : prefix
    return { type, value: pre[2] }
  }
  return null
}

// Look up a HathiTrust record via the edge function. Pass exactly one of
// { isbn, oclc, lccn, issn, recordnumber }. Returns the raw response object
// (with `found`, `title`, `author`, `publisher`, etc.) or null on miss/error.
// Never throws — callers can treat null as "not found."
export async function lookupHathitrust(ids) {
  try {
    const { data } = await supabase.functions.invoke('lookup-hathitrust', { body: ids })
    return data?.found ? data : null
  } catch {
    return null
  }
}

// Map a raw HathiTrust response to the unified search-result shape used by
// SearchModal/GlobalSearchModal. HathiTrust doesn't serve cover thumbnails,
// so we fall back to OL covers by ISBN when available.
export function fromHathiResult(rec) {
  const isbn = rec.isbn_13 || rec.isbn_10
  const cover = isbn
    ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`
    : null
  return {
    key:          `ht-${rec.record_id}`,
    title:        rec.title,
    author:       rec.author || 'Unknown author',
    coverUrl:     cover,
    saveCoverUrl: cover,
    year:         rec.published_year || null,
    isbn13:       rec.isbn_13 || null,
    isbn10:       rec.isbn_10 || null,
    genre:        extractGenre(rec.subjects),
    source:       'hathitrust',
    bookId:       null,
    publisher:    rec.publisher || null,
    pages:        rec.pages || null,
    language:     rec.language || null,
    recordUrl:    rec.record_url || null,
  }
}
