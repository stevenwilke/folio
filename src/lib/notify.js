import { supabase } from './supabase'
import { LEGACY_INAPP_TYPES } from './notifTypes'

// Notification types whose in-app row is created atomically by a DB trigger
// in the same transaction as the underlying action. The client must NOT
// also insert the in-app row or recipients see duplicates.
// (Push + email channels are still fanned out from here for these types.)
const TRIGGER_HANDLED_INAPP = new Set(['friend_request', 'friend_accepted'])

/**
 * Send a notification to a user across enabled channels.
 *
 * Looks up the recipient's notification_preferences for `type` and fans out to
 * in-app (notifications table), push (send-notification edge fn), and email
 * (send-email edge fn). Missing prefs row = all channels on.
 *
 * @param {string} toUserId
 * @param {string} type        One of the values allowed by the notifications enum.
 * @param {object} payload
 * @param {string} payload.title           Required. In-app + push title.
 * @param {string} payload.body            Required. In-app body + push body.
 * @param {string} [payload.link]          In-app link (e.g. '/loans').
 * @param {object} [payload.metadata]      Stored on the in-app row.
 * @param {string} [payload.emailTemplate] If set, also sends email via this template.
 * @param {object} [payload.emailData]     Template variables for the email.
 */
export async function notify(toUserId, type, payload = {}) {
  if (!toUserId || !type) return
  const { title, body, link, metadata, emailTemplate, emailData } = payload

  const { data: prefRow } = await supabase
    .from('notification_preferences')
    .select('email, push, in_app')
    .eq('user_id', toUserId)
    .eq('type', type)
    .maybeSingle()

  const prefs = prefRow ?? { email: true, push: true, in_app: true }

  const tasks = []

  if (prefs.in_app && title && body && !LEGACY_INAPP_TYPES.has(type) && !TRIGGER_HANDLED_INAPP.has(type)) {
    tasks.push(
      supabase.from('notifications').insert({
        user_id: toUserId,
        type,
        title,
        body,
        link: link || null,
        metadata: metadata || {},
      })
    )
  }

  if (prefs.push && title && body) {
    tasks.push(
      supabase.functions.invoke('send-notification', {
        body: { user_id: toUserId, title, body, data: { link, ...(metadata || {}) } },
      })
    )
  }

  if (prefs.email && emailTemplate) {
    tasks.push(
      supabase.functions.invoke('send-email', {
        body: { to_user_id: toUserId, type: emailTemplate, data: emailData || {} },
      })
    )
  }

  const results = await Promise.allSettled(tasks)
  results.forEach((r) => {
    if (r.status === 'rejected') console.error('[notify] channel failed:', r.reason)
  })
}

/**
 * Send a notification to every admin user. Honors per-admin prefs.
 */
export async function notifyAdmins(type, payload = {}) {
  const { data: admins } = await supabase
    .from('profiles')
    .select('id')
    .eq('is_admin', true)
  if (!admins?.length) return
  await Promise.allSettled(admins.map((a) => notify(a.id, type, payload)))
}
