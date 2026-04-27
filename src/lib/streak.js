import { supabase } from './supabase'

/**
 * Compute current + longest daily reading streak from a list of YYYY-MM-DD
 * strings. "Current" includes a grace day — if the user hasn't read today yet
 * but read yesterday, the yesterday-anchored run is still surfaced.
 */
export function computeStreak(dateStrings) {
  if (!dateStrings?.length) return { current: 0, longest: 0 }
  const days = new Set(dateStrings.filter(Boolean))
  if (!days.size) return { current: 0, longest: 0 }

  const sorted = [...days].sort()
  let longest = 1, run = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diff = (curr - prev) / 86_400_000
    if (diff === 1) { run++; longest = Math.max(longest, run) }
    else run = 1
  }

  // Anchor the current streak at today, falling back to yesterday so a
  // not-yet-read-today user still sees their in-flight streak.
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const current = walkBack(today, days) || walkBack(yesterday.toISOString().slice(0, 10), days)
  return { current, longest }
}

function walkBack(startDay, days) {
  let n = 0, check = startDay
  while (days.has(check)) {
    n++
    const d = new Date(check); d.setDate(d.getDate() - 1)
    check = d.toISOString().slice(0, 10)
  }
  return n
}

/**
 * Fetch the streak for any user (uses SECURITY DEFINER RPC under the hood).
 */
export async function fetchStreak(userId) {
  if (!userId) return { current: 0, longest: 0 }
  const { data, error } = await supabase.rpc('get_reading_streak_dates', { p_user_id: userId })
  if (error) {
    console.error('[fetchStreak] error:', error)
    return { current: 0, longest: 0 }
  }
  const dates = (data || []).map(r => r.active_date).filter(Boolean)
  return computeStreak(dates)
}
