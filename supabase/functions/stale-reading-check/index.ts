import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Gentle nudge for books stuck in 'reading' with no recent progress.
// Default: 14d inactivity, max one reminder per book per 7d.
const STALE_DAYS    = 14
const COOLDOWN_DAYS = 7

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const now = new Date()
    const staleCutoff    = new Date(now.getTime() - STALE_DAYS    * 86400_000).toISOString()
    const cooldownCutoff = new Date(now.getTime() - COOLDOWN_DAYS * 86400_000).toISOString()

    // All "currently reading" entries
    const { data: entries, error: entriesErr } = await supabase
      .from('collection_entries')
      .select('id, user_id, book_id, added_at, current_page, books(id, title, pages)')
      .eq('read_status', 'reading')
    if (entriesErr) throw entriesErr

    // Batch-fetch all reading_sessions for the user+book pairs we care about,
    // then index by `${user_id}:${book_id}` for O(1) latest-activity lookup.
    const entryList = entries ?? []
    const bookIds = Array.from(new Set(entryList.map((e: any) => e.book_id)))
    const userIds = Array.from(new Set(entryList.map((e: any) => e.user_id)))
    const { data: sessions } = bookIds.length
      ? await supabase
          .from('reading_sessions')
          .select('user_id, book_id, started_at, ended_at')
          .in('user_id', userIds)
          .in('book_id', bookIds)
          .order('started_at', { ascending: false })
      : { data: [] as any[] }

    const latestByKey = new Map<string, { started_at: string | null; ended_at: string | null }>()
    for (const s of sessions ?? []) {
      const key = `${(s as any).user_id}:${(s as any).book_id}`
      if (!latestByKey.has(key)) latestByKey.set(key, s as any)  // query is ordered desc, first wins
    }

    const candidates: {
      user_id: string; book_id: string; title: string; pages: number | null; current_page: number | null;
    }[] = []

    for (const e of entryList) {
      const book: any = (e as any).books
      if (!book) continue
      const key = `${(e as any).user_id}:${(e as any).book_id}`
      const latestSession = latestByKey.get(key)
      const lastActivity = latestSession?.ended_at || latestSession?.started_at || (e as any).added_at
      if (!lastActivity) continue
      if (lastActivity > staleCutoff) continue  // active recently — skip

      candidates.push({
        user_id: (e as any).user_id,
        book_id: (e as any).book_id,
        title: book.title,
        pages: book.pages ?? null,
        current_page: (e as any).current_page ?? null,
      })
    }

    let sent = 0
    let skipped_cooldown = 0

    for (const c of candidates) {
      // Dedupe: skip if a stale_reading notification for this book was sent in the cooldown window
      const { data: recent } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', c.user_id)
        .eq('type', 'stale_reading')
        .gt('created_at', cooldownCutoff)
        .contains('data', { book_id: c.book_id } as any)
        .limit(1)

      if (recent && recent.length > 0) { skipped_cooldown++; continue }

      const pct = (c.pages && c.current_page)
        ? Math.min(100, Math.round((c.current_page / c.pages) * 100))
        : null
      const title = `Still reading "${c.title}"?`
      const body = pct != null
        ? `You're ${pct}% in. Pick up where you left off.`
        : `Last picked up a while ago — pick up where you left off.`

      // In-app notification row
      await supabase.from('notifications').insert({
        user_id: c.user_id,
        type: 'stale_reading',
        title,
        body,
        link: `/?book=${c.book_id}`,
        data: { book_id: c.book_id },
      })

      // Push notification (fire-and-forget; don't block on errors)
      try {
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            user_id: c.user_id,
            title,
            body,
            data: { book_id: c.book_id, type: 'stale_reading' },
          }),
        })
      } catch (err) {
        console.error('Push send failed:', err)
      }

      sent++
    }

    return new Response(
      JSON.stringify({ checked: entries?.length ?? 0, candidates: candidates.length, sent, skipped_cooldown }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('stale-reading-check error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    )
  }
})
