import { supabase } from './supabase'

/**
 * Send a transactional email to a user via the send-email Supabase Edge Function.
 *
 * @param {string} toUserId   - The recipient's Supabase user ID
 * @param {string} type       - Email template type: 'friend_request' | 'loan_request' |
 *                              'loan_accepted' | 'book_club_post' | 'reading_goal_achieved'
 * @param {object} data       - Template-specific data (e.g. { fromUsername, bookTitle })
 */
export async function sendEmail(toUserId, type, data = {}) {
  try {
    const { error } = await supabase.functions.invoke('send-email', {
      body: { to_user_id: toUserId, type, data },
    })
    if (error) console.error('[sendEmail] Error:', error)
    return !error
  } catch (err) {
    console.error('[sendEmail] Unexpected error:', err)
    return false
  }
}
