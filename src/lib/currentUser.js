import { supabase } from './supabase'

// Module-level username cache. Notification emitters fetch the current user's
// username dozens of times across handlers; the value never changes mid-session
// so a one-shot cache replaces ~10 round-trips per active user with one.
let _cachedId = null
let _cachedUsername = null
let _inflight = null

export async function getMyUsername(userId) {
  if (!userId) return null
  if (_cachedId === userId && _cachedUsername) return _cachedUsername
  if (_inflight) return _inflight
  _inflight = (async () => {
    const { data } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle()
    _cachedId = userId
    _cachedUsername = data?.username || null
    _inflight = null
    return _cachedUsername
  })()
  return _inflight
}

// Reset on sign-out so the next signed-in user doesn't see the previous name.
export function clearCachedUsername() {
  _cachedId = null
  _cachedUsername = null
  _inflight = null
}
