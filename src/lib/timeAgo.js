// Compact relative-time formatter used across feeds, notifications, the
// catalog, etc. Variants in the codebase differ on whether they say "now" /
// "just now" and whether they append " ago" — both are tunable here so a
// future cleanup pass can migrate the remaining inline copies (Feed.jsx,
// BookDropCard.jsx, Notifications.jsx, etc.) without changing visible text.
//
// Returns: 'now' | '5m' | '3h' | '2d' | 'Mar 25' (plus optional " ago").
export function timeAgo(dateStr, { suffix = '', justNow = 'now' } = {}) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return justNow
  const sfx = suffix ? ` ${suffix}` : ''
  if (mins < 60) return `${mins}m${sfx}`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h${sfx}`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d${sfx}`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
