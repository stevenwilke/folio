import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { preflight, requireUser, serviceClient, rateLimit, jsonResponse, jsonError, handleError } from '../_shared/auth.ts'

// Hardening from round 9 audit:
//   - JWT required (was unauth — anyone could overwrite any book's cover).
//   - cover_url restricted to a host allowlist (was SSRF — could probe
//     internal Edge metadata endpoints).
//   - Caller must own a collection_entry for book_id (no arbitrary
//     book overwrites).
//   - Per-user rate limit.
//   - Image fetch capped at 5 MB.

const BUCKET = 'book-covers'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const RATE_LIMIT_PER_HOUR = 30

// Trusted upstream cover sources only. SSRF-safe.
const ALLOWED_HOSTS = new Set([
  'covers.openlibrary.org',
  'books.google.com',
  'books.googleusercontent.com',
  'images.amazon.com',
  'images-na.ssl-images-amazon.com',
  'images-eu.ssl-images-amazon.com',
  'm.media-amazon.com',
  'images.thriftbooks.com',
])

function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    return ALLOWED_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre

  try {
    const { user } = await requireUser(req)
    const admin = serviceClient()
    await rateLimit(admin, user.id, 'upload-book-cover', RATE_LIMIT_PER_HOUR)

    const { book_id, cover_url } = await req.json()
    if (!book_id || !cover_url) return jsonError('book_id and cover_url are required', 400)
    if (typeof cover_url !== 'string' || !isAllowedUrl(cover_url)) {
      return jsonError('cover_url must be HTTPS from an allowed host', 400)
    }

    // Verify caller owns this book in their collection (prevents arbitrary
    // book_id metadata overwrite).
    const { count } = await admin
      .from('collection_entries')
      .select('id', { head: true, count: 'exact' })
      .eq('user_id', user.id)
      .eq('book_id', book_id)
    if (!count || count === 0) {
      return jsonError('You do not have this book in your library', 403)
    }

    // Download the cover image
    const imgRes = await fetch(cover_url, {
      headers: { 'User-Agent': 'folio-app/1.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (!imgRes.ok) return jsonError(`Failed to fetch image: ${imgRes.status}`, 502)

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
    if (!contentType.startsWith('image/')) return jsonError(`Not an image: ${contentType}`, 415)

    const arrayBuf = await imgRes.arrayBuffer()
    if (arrayBuf.byteLength > MAX_IMAGE_BYTES) return jsonError('Image too large', 413)

    const ext   = contentType.includes('png') ? 'png' : 'jpg'
    const path  = `${book_id}.${ext}`
    const bytes = new Uint8Array(arrayBuf)

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return jsonError(uploadError.message, 500)
    }

    const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path)

    const { error: updateError } = await admin
      .from('books')
      .update({ cover_image_url: publicUrl })
      .eq('id', book_id)

    if (updateError) console.error('Books update error:', updateError)

    return jsonResponse({ success: true, url: publicUrl })
  } catch (err) {
    return handleError(err)
  }
})
