import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { preflight, requireService, serviceClient, jsonResponse, handleError } from '../_shared/auth.ts'

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre

  try {
    // Cron-only: require the caller to present the service-role key.
    requireService(req)
    const supabase = serviceClient()

    const { user_id } = await req.json().catch(() => ({}))

    // If user_id provided, send for that user only; otherwise send for all opted-in users
    let userIds: string[] = []
    if (user_id) {
      userIds = [user_id]
    } else {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('weekly_report_enabled', true)
      userIds = (data || []).map((p: any) => p.id)
    }

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const results: { userId: string; sent: boolean; error?: string }[] = []

    for (const uid of userIds) {
      try {
        // Get username
        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', uid)
          .single()

        // Reading sessions this week
        const { data: sessions } = await supabase
          .from('reading_sessions')
          .select('started_at, ended_at, pages_read')
          .eq('user_id', uid)
          .eq('status', 'completed')
          .gte('ended_at', oneWeekAgo)

        const sessionCount = (sessions || []).length
        const totalPages = (sessions || []).reduce((sum: number, s: any) => sum + (s.pages_read || 0), 0)
        const totalMinutes = Math.round((sessions || []).reduce((sum: number, s: any) => {
          if (!s.started_at || !s.ended_at) return sum
          return sum + (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000
        }, 0))

        // Books finished this week
        const { count: booksFinished } = await supabase
          .from('collection_entries')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', uid)
          .eq('has_read', true)
          .gte('updated_at', oneWeekAgo)

        // Format reading time
        let readingTime = '0 min'
        if (totalMinutes >= 60) {
          const h = Math.floor(totalMinutes / 60)
          const m = totalMinutes % 60
          readingTime = m > 0 ? `${h}h ${m}m` : `${h}h`
        } else if (totalMinutes > 0) {
          readingTime = `${totalMinutes} min`
        }

        // Current streak (simplified — count consecutive days back from today)
        const { data: allSessions } = await supabase
          .from('reading_sessions')
          .select('ended_at')
          .eq('user_id', uid)
          .eq('status', 'completed')
          .order('ended_at', { ascending: false })
          .limit(60)
        const sessionDays = new Set((allSessions || []).map((s: any) => s.ended_at?.slice(0, 10)).filter(Boolean))
        let streak = 0
        let checkDate = new Date()
        for (let i = 0; i < 60; i++) {
          const day = checkDate.toISOString().slice(0, 10)
          if (sessionDays.has(day)) {
            streak++
          } else if (i > 0) {
            break
          }
          checkDate.setDate(checkDate.getDate() - 1)
        }

        // Skip sending if nothing happened this week
        if (sessionCount === 0 && (booksFinished || 0) === 0) {
          results.push({ userId: uid, sent: false, error: 'No activity this week' })
          continue
        }

        // Send email via send-email function
        const emailRes = await supabase.functions.invoke('send-email', {
          body: {
            to_user_id: uid,
            type: 'weekly_reading_report',
            data: {
              username: profile?.username || 'Reader',
              sessions: sessionCount,
              pagesRead: totalPages,
              readingTime,
              booksFinished: booksFinished || 0,
              streak,
            },
          },
        })

        results.push({ userId: uid, sent: !emailRes.error })
      } catch (err) {
        results.push({ userId: uid, sent: false, error: String(err) })
      }
    }

    return jsonResponse({ sent: results.filter(r => r.sent).length, total: results.length, results })
  } catch (err) {
    return handleError(err)
  }
})
