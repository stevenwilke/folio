import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { preflight, serviceClient, clientIp, rateLimitByIp, handleError } from '../_shared/auth.ts'

// Per-IP rate limit — caps at 20 exports/hour from the same IP. The intent
// is to prevent scraping of every public library; legitimate users only
// export their own (or the occasional friend's) library.
const RATE_LIMIT_PER_HOUR = 20

const SHELF_MAP: Record<string, string> = {
  owned: 'owned',
  read: 'read',
  reading: 'currently-reading',
  want: 'to-read',
}

function escapeCSV(v: string | number | null | undefined): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`
}

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre

  try {
    const supabase = serviceClient()
    await rateLimitByIp(supabase, clientIp(req), 'export-library', RATE_LIMIT_PER_HOUR)

    const url = new URL(req.url)
    const usernameRaw = url.searchParams.get('username')

    // Validate username format up-front to avoid expensive lookups on
    // garbage input. Matches profile-username constraints (alphanumeric +
    // underscore + hyphen, ≤32 chars).
    if (!usernameRaw || !/^[A-Za-z0-9_-]{1,32}$/.test(usernameRaw)) {
      return new Response('Invalid username', { status: 400 })
    }
    const username = usernameRaw

    // Look up the profile and check it's public
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username, is_public')
      .eq('username', username)
      .maybeSingle()

    if (!profile) {
      return new Response('User not found', { status: 404 })
    }
    if (!profile.is_public) {
      return new Response('This user\'s library is private', { status: 403 })
    }

    // Fetch their collection
    const { data: entries } = await supabase
      .from('collection_entries')
      .select('read_status, has_read, user_rating, review_text, books ( title, author, isbn_10, isbn_13, pages, published_year )')
      .eq('user_id', profile.id)
      .order('added_at', { ascending: false })
      .limit(5000)

    const rows = (entries || []).map((e: any) => {
      let shelf = SHELF_MAP[e.read_status] || 'owned'
      if (e.read_status === 'owned' && e.has_read) shelf = 'read'
      return [
        escapeCSV(e.books?.title),
        escapeCSV(e.books?.author),
        escapeCSV(e.books?.isbn_10),
        escapeCSV(e.books?.isbn_13),
        escapeCSV(e.user_rating),
        escapeCSV(e.books?.pages),
        escapeCSV(e.books?.published_year),
        escapeCSV(shelf),
        escapeCSV(e.review_text),
        escapeCSV(''),
      ].join(',')
    })

    const header = 'Title,Author,ISBN,ISBN13,My Rating,Number of Pages,Original Publication Year,Exclusive Shelf,My Review,Binding'
    const csv = [header, ...rows].join('\n')

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${username}-library.csv"`,
      },
    })
  } catch (err) {
    return handleError(err, req)
  }
})
