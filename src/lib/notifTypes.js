// Single source of truth for notification types, icons, and which types skip
// the in-app channel because legacy queries already render them with richer UI.

export const NOTIF_ICONS = {
  friend_request: '👥', friend_accepted: '👥',
  borrow_request: '📚', borrow_approved: '📚', borrow_returned: '📚',
  order_update: '🏪', recommendation: '💌',
  club_activity: '📖', achievement: '🏅', quote_shared: '💬',
  book_drop_claimed: '📦', stale_reading: '⏳', author_claim: '✍️',
  author_post: '📣', marketplace_alert: '💸', author_question: '❓',
  buddy_read_invite: '👯', buddy_read_message: '💬',
}

// In-app rendering for these types comes from legacy queries (friendships,
// borrow_requests, orders, book_recommendations) that the bell + /notifications
// already render with action buttons. Skip the redundant insert and filter
// these out when querying the unified notifications table.
export const LEGACY_INAPP_TYPES = new Set([
  'friend_request',
  'borrow_request',
  'order_update',
  'recommendation',
])

// PostgREST `not.in.(...)` filter built from LEGACY_INAPP_TYPES, kept in sync.
export const LEGACY_INAPP_FILTER = `(${[...LEGACY_INAPP_TYPES].join(',')})`
