import { supabase } from './supabase'

export const REPORT_REASONS = [
  { key: 'spam',       label: 'Spam or scam' },
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'hate',       label: 'Hate speech or discrimination' },
  { key: 'sexual',     label: 'Sexual or explicit content' },
  { key: 'violence',   label: 'Violence or threats' },
  { key: 'self_harm',  label: 'Self-harm' },
  { key: 'illegal',    label: 'Illegal activity' },
  { key: 'other',      label: 'Other' },
]

// Bidirectional block list: anyone the current user has blocked, plus anyone
// who has blocked the current user. Callers filter content out by user_id.
export async function fetchBlockedUserIds(userId) {
  if (!userId) return []
  const [outgoing, incoming] = await Promise.all([
    supabase.from('user_blocks').select('blocked_id').eq('blocker_id', userId),
    supabase.from('user_blocks').select('blocker_id').eq('blocked_id', userId),
  ])
  const ids = new Set()
  for (const r of outgoing.data || []) ids.add(r.blocked_id)
  for (const r of incoming.data || []) ids.add(r.blocker_id)
  return [...ids]
}

export async function blockUser(blockedId) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id === blockedId) return { error: 'invalid' }
  return supabase.from('user_blocks').insert({ blocker_id: user.id, blocked_id: blockedId })
}

export async function unblockUser(blockedId) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'not-signed-in' }
  return supabase.from('user_blocks').delete().eq('blocker_id', user.id).eq('blocked_id', blockedId)
}

export async function isBlocked(blockedId) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase
    .from('user_blocks')
    .select('id')
    .eq('blocker_id', user.id)
    .eq('blocked_id', blockedId)
    .maybeSingle()
  return !!data
}

export async function reportContent({ contentType, contentId, reportedUserId, reason, details }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'not-signed-in' }
  return supabase.from('content_reports').insert({
    reporter_id:      user.id,
    reported_user_id: reportedUserId || null,
    content_type:     contentType,
    content_id:       contentId,
    reason,
    details:          details || null,
  })
}
