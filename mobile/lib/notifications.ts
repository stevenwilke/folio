import { supabase } from './supabase'

/**
 * Send a push notification to a specific user via the Supabase edge function.
 * Silently no-ops if the user has no registered device or if there's an error.
 */
export async function sendPushNotification(
  toUserId: string,
  title: string,
  body: string,
  data: Record<string, string> = {}
) {
  try {
    await supabase.functions.invoke('send-notification', {
      body: { user_id: toUserId, title, body, data },
    })
  } catch (err) {
    // Never let notification failures break the main action
    console.warn('Push notification failed (non-fatal):', err)
  }
}
