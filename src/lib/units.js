// User-facing distance units. Auto-detected from locale (US/Liberia/Myanmar
// default to imperial, everywhere else to metric) and overridable via a
// localStorage preference. Listeners are notified on change so any component
// using `useUnits` re-renders.

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'units'
export const KM_PER_MILE = 1.609344
export const FEET_PER_MILE = 5280
const FEET_PER_METER = 3.28084

const listeners = new Set()

function detectFromLocale() {
  if (typeof navigator === 'undefined') return 'metric'
  try {
    const locale = new Intl.Locale(navigator.language)
    const ms = locale.getMeasurementSystem?.()
    if (ms === 'us' || ms === 'uk') return 'imperial'
    if (ms) return 'metric'
  } catch {}
  // Fallback for browsers without getMeasurementSystem.
  return /^en-(US|LR)/i.test(navigator.language || '') ? 'imperial' : 'metric'
}

export function getUnits() {
  if (typeof window === 'undefined') return 'metric'
  const stored = window.localStorage?.getItem(STORAGE_KEY)
  if (stored === 'metric' || stored === 'imperial') return stored
  return detectFromLocale()
}

export function setUnits(units) {
  if (units !== 'metric' && units !== 'imperial') return
  window.localStorage?.setItem(STORAGE_KEY, units)
  listeners.forEach(fn => fn(units))
}

export function useUnits() {
  const [units, setUnitsState] = useState(getUnits)
  useEffect(() => {
    const fn = (next) => setUnitsState(next)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return [units, setUnits]
}

// Conversion helpers — distances in the codebase are stored as km internally
// (haversineKm output). Convert at the display layer only.
export function kmToMiles(km) { return km / KM_PER_MILE }
export function milesToKm(mi) { return mi * KM_PER_MILE }
export function metersToFeet(m) { return m * FEET_PER_METER }
