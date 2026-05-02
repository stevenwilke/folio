// Shared auth + response helpers for Edge functions.
//
// Every function should:
//   1. handle CORS preflight via `corsHeaders` + an OPTIONS short-circuit
//   2. require auth via requireUser() OR requireService() at the top
//   3. return errors via jsonError() so shape stays consistent
//
// Without this, every function reimplements auth differently — see the
// audit (round 8) for what that produced.

import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2'

// ── CORS ─────────────────────────────────────────────────────────────────────
// Browser fetch-CORS used to be `*`, which let any site invoke these
// functions cross-origin from a logged-in user's browser. We now echo the
// request's Origin only if it matches a known allowlist:
//   - exact match for production domains (set via ALLOWED_ORIGINS env var,
//     comma-separated; defaults below)
//   - regex match for Vercel preview URLs and localhost dev
//
// Server-to-server (curl, edge runtime, scheduled jobs) doesn't send Origin
// and isn't subject to CORS — those keep working.

const DEFAULT_ALLOWED = [
  'https://exlibrisomnium.com',
  'https://www.exlibrisomnium.com',
  'https://exlibris.app',
]

function allowedOrigins(): string[] {
  const envList = Deno.env.get('ALLOWED_ORIGINS')
  if (envList) return envList.split(',').map(s => s.trim()).filter(Boolean)
  return DEFAULT_ALLOWED
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  if (allowedOrigins().includes(origin)) return true
  // Vercel preview deployments
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true
  // Local dev
  if (/^https?:\/\/localhost(:\d+)?$/i.test(origin)) return true
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)) return true
  return false
}

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  // If origin isn't allowed, omit ACAO entirely — browsers will block the
  // response. Non-browser callers don't care.
  return headers
}

// Backward-compat: some functions import `corsHeaders` directly. This still
// works for non-browser callers; browser callers should use jsonResponse(req, ...)
// which derives CORS from the request.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function jsonResponse(data: unknown, statusOrReq: number | Request = 200, maybeStatus?: number): Response {
  // Two call shapes:
  //   jsonResponse(data, status)        — legacy, uses wildcard CORS
  //   jsonResponse(data, req, status?)  — preferred, derives CORS from request
  let status = 200
  let cors: Record<string, string> = corsHeaders
  if (typeof statusOrReq === 'number') {
    status = statusOrReq
  } else {
    cors = corsFor(statusOrReq)
    if (typeof maybeStatus === 'number') status = maybeStatus
  }
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

export function jsonError(message: string, status = 400, req?: Request): Response {
  if (req) return jsonResponse({ error: message }, req, status)
  return jsonResponse({ error: message }, status)
}

/** Returns the OPTIONS preflight response if applicable, else null. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) })
  return null
}

/**
 * Verify the caller's JWT and return the user + a JWT-scoped supabase client
 * (RLS applies). Throws { status, message } on failure — caller catches and
 * returns jsonError(message, status).
 */
export async function requireUser(req: Request): Promise<{ user: User; supabaseUser: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw { status: 401, message: 'Unauthorized' }

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error } = await supabaseUser.auth.getUser()
  if (error || !user) throw { status: 401, message: 'Unauthorized' }
  return { user, supabaseUser }
}

/**
 * Require that the caller is using the service role key (i.e. an internal
 * cron / admin caller, not a user). Use for fan-out functions like
 * weekly-reading-report and stale-reading-check.
 */
export function requireService(req: Request): void {
  const authHeader = req.headers.get('Authorization') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    throw { status: 401, message: 'Service-role auth required' }
  }
}

/** Returns the admin (service-role) client. RLS bypassed; use with care. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

/**
 * Escape a string for safe interpolation into HTML. Use on every
 * caller-supplied value going into an email template.
 */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

/**
 * Per-user rate limit using the contact_lookups pattern from round 5.
 * Records each call to a generic `edge_calls` audit table and rejects
 * users who exceed `maxPerHour`. Caller passes the function name so
 * limits can be tuned independently.
 *
 * Throws { status: 429, message } when over the limit.
 */
export async function rateLimit(
  admin: SupabaseClient,
  userId: string,
  fnName: string,
  maxPerHour: number
): Promise<void> {
  // Prune old rows opportunistically.
  await admin.from('edge_calls').delete().lt('called_at', new Date(Date.now() - 24 * 3600_000).toISOString())

  const { count } = await admin
    .from('edge_calls')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('fn_name', fnName)
    .gt('called_at', new Date(Date.now() - 3600_000).toISOString())

  if ((count ?? 0) >= maxPerHour) {
    throw { status: 429, message: `Rate limit exceeded for ${fnName}. Try again later.` }
  }

  await admin.from('edge_calls').insert({ user_id: userId, fn_name: fnName })
}

/** Catches the throw shape used above and returns the right Response. */
export function handleError(err: unknown, req?: Request): Response {
  if (err && typeof err === 'object' && 'status' in err && 'message' in err) {
    const e = err as { status: number; message: string }
    return jsonError(e.message, e.status, req)
  }
  console.error('Unhandled edge error:', err)
  return jsonError('Internal error', 500, req)
}

/**
 * Per-IP rate limit for unauthenticated endpoints (submit-contact,
 * export-library, etc.) where there's no user_id to key on.
 * Reads the client IP from cf-connecting-ip (Cloudflare) or
 * x-forwarded-for (first hop).
 *
 * Throws { status: 429, message } when over the limit.
 */
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return 'unknown'
}

export async function rateLimitByIp(
  admin: SupabaseClient,
  ip: string,
  fnName: string,
  maxPerHour: number
): Promise<void> {
  if (ip === 'unknown') return  // can't enforce, fail open

  await admin.from('ip_rate_limits').delete().lt('called_at', new Date(Date.now() - 24 * 3600_000).toISOString())

  const { count } = await admin
    .from('ip_rate_limits')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('fn_name', fnName)
    .gt('called_at', new Date(Date.now() - 3600_000).toISOString())

  if ((count ?? 0) >= maxPerHour) {
    throw { status: 429, message: `Rate limit exceeded. Try again later.` }
  }

  await admin.from('ip_rate_limits').insert({ ip, fn_name: fnName })
}
