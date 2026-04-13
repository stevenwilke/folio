import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const username = url.searchParams.get('username')

    if (!username) {
      return new Response('Missing username parameter', { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Look up the profile and check it's public
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username, is_public')
      .eq('username', username)
      .maybeSingle()

    if (!profile) {
      return new Response('User not found', { status: 404, headers: corsHeaders })
    }
    if (!profile.is_public) {
      return new Response('This user\'s library is private', { status: 403, headers: corsHeaders })
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
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${username}-library.csv"`,
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
