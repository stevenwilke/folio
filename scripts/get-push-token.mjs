#!/usr/bin/env node
/**
 * Fetch Expo push tokens from Supabase for testing.
 *
 * Usage:
 *   node scripts/get-push-token.mjs                    # list all tokens
 *   node scripts/get-push-token.mjs <email-or-user-id> # filter by user
 */

const SUPABASE_URL = 'https://wdafggpiyqahkktrmtem.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY — find it in Supabase dashboard → Project Settings → API.')
  process.exit(1)
}

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
}

const filter = process.argv[2]

let userIdFilter = null
if (filter) {
  if (filter.includes('@')) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(filter)}`,
      { headers }
    )
    const body = await res.json()
    const user = body.users?.[0] ?? body?.[0]
    if (!user) {
      console.error(`No user found for ${filter}`)
      process.exit(1)
    }
    userIdFilter = user.id
  } else {
    userIdFilter = filter
  }
}

const query = userIdFilter
  ? `user_id=eq.${userIdFilter}&select=user_id,token,platform,updated_at&order=updated_at.desc`
  : `select=user_id,token,platform,updated_at&order=updated_at.desc`

const res = await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?${query}`, { headers })
const rows = await res.json()

if (!Array.isArray(rows) || rows.length === 0) {
  console.log('No push tokens found.')
  process.exit(0)
}

for (const r of rows) {
  console.log(`[${r.platform}] ${r.token}   user=${r.user_id}   updated=${r.updated_at}`)
}
