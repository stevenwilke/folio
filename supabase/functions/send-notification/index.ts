import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { preflight, requireUser, serviceClient, rateLimit, jsonResponse, jsonError, handleError } from '../_shared/auth.ts'

// Push notification fan-out via Expo. Same auth model as send-email:
//   - Service-role caller bypass (cron / DB webhooks).
//   - User caller required otherwise; per-sender rate limit.
//   - Title and body capped to keep payloads under Expo's per-message limit.

const MAX_TITLE_LEN = 100
const MAX_BODY_LEN  = 280
const RATE_LIMIT_PER_HOUR = 60

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const isService  = authHeader === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
    const admin = serviceClient()

    if (!isService) {
      const { user } = await requireUser(req)
      await rateLimit(admin, user.id, 'send-notification', RATE_LIMIT_PER_HOUR)
    }

    const body = await req.json()
    const user_id = body.user_id
    const title   = String(body.title ?? '').slice(0, MAX_TITLE_LEN)
    const text    = String(body.body  ?? '').slice(0, MAX_BODY_LEN)
    const data    = body.data && typeof body.data === 'object' ? body.data : {}

    if (!user_id || !title || !text) {
      return jsonError('Missing required fields: user_id, title, body', 400)
    }

    const { data: tokens, error } = await admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', user_id)

    if (error) throw error
    if (!tokens?.length) {
      return jsonResponse({ sent: 0, message: 'No push tokens for user' })
    }

    const messages = tokens.map(({ token }: { token: string }) => ({
      to: token,
      title,
      body: text,
      data,
      sound: 'default',
      badge: 1,
    }))

    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    })

    const result = await expoRes.json()
    return jsonResponse({ sent: messages.length, result })
  } catch (err) {
    return handleError(err)
  }
})
