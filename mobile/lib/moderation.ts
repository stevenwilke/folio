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
] as const

export type ReportReason = typeof REPORT_REASONS[number]['key']

export type ContentType =
  | 'review'
  | 'feed_post'
  | 'post_comment'
  | 'club_post'
  | 'book_recommendation'
  | 'profile'
  | 'poll'
  | 'poll_comment'

export async function fetchBlockedUserIds(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return []
  const { data } = await supabase
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
  const ids = new Set<string>()
  for (const r of data || []) {
    const row = r as { blocker_id: string; blocked_id: string }
    ids.add(row.blocker_id === userId ? row.blocked_id : row.blocker_id)
  }
  return [...ids]
}

export async function blockUser(blockedId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id === blockedId) return { error: 'invalid' as const }
  return supabase.from('user_blocks').insert({ blocker_id: user.id, blocked_id: blockedId })
}

export async function unblockUser(blockedId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'not-signed-in' as const }
  return supabase.from('user_blocks').delete().eq('blocker_id', user.id).eq('blocked_id', blockedId)
}

export async function isBlocked(blockedId: string): Promise<boolean> {
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

export async function reportContent(args: {
  contentType: ContentType
  contentId: string
  reportedUserId?: string | null
  reason: ReportReason
  details?: string | null
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'not-signed-in' as const }
  return supabase.from('content_reports').insert({
    reporter_id:      user.id,
    reported_user_id: args.reportedUserId || null,
    content_type:     args.contentType,
    content_id:       args.contentId,
    reason:           args.reason,
    details:          args.details || null,
  })
}
