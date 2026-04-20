/**
 * Reader levels — derived from earned badges.
 *
 * Each earned badge contributes points based on its tier:
 *   bronze=1, silver=3, gold=5, platinum=10
 *
 * Points accumulate into levels 1-10 via LEVEL_THRESHOLDS. Level 10 is the cap.
 * The ring color and title for an avatar come from the level's entry in LEVELS.
 *
 * Shared by web (Stats, Profile, NavBar) and mirrored in mobile/lib/level.ts.
 * Keep the two files in sync.
 */

import { TIER_STYLES } from './badges'

export const TIER_POINTS = { bronze: 1, silver: 3, gold: 5, platinum: 10 }

// index is level - 1; value is points required to REACH that level
export const LEVEL_THRESHOLDS = [0, 5, 15, 30, 50, 75, 100, 130, 170, 220]

const PRE_BRONZE_RING = '#b89878'

export const LEVELS = [
  { level: 1,  title: 'Novice Reader',    ring: PRE_BRONZE_RING },
  { level: 2,  title: 'Page Seeker',      ring: PRE_BRONZE_RING },
  { level: 3,  title: 'Avid Reader',      ring: TIER_STYLES.bronze.text },
  { level: 4,  title: 'Well Read',        ring: TIER_STYLES.bronze.text },
  { level: 5,  title: 'Bibliophile',      ring: TIER_STYLES.silver.text },
  { level: 6,  title: 'Literary Mind',    ring: TIER_STYLES.silver.text },
  { level: 7,  title: 'Scholar',          ring: TIER_STYLES.gold.text },
  { level: 8,  title: 'Master Reader',    ring: TIER_STYLES.gold.text },
  { level: 9,  title: 'Grand Librarian',  ring: TIER_STYLES.platinum.text },
  { level: 10, title: 'Legendary Reader', ring: TIER_STYLES.platinum.text },
]

export function pointsFromBadges(badges) {
  if (!badges) return 0
  let pts = 0
  for (const b of badges) {
    if (b.earned) pts += TIER_POINTS[b.tier] || 0
  }
  return pts
}

export function levelFromPoints(points) {
  let lvl = 1
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (points >= LEVEL_THRESHOLDS[i]) lvl = i + 1
  }
  return lvl
}

/**
 * @param {number} level
 * @param {number} points
 * @returns { level, title, ring, points, nextLevelAt, progressPct }
 */
export function getLevelInfo(level, points = 0) {
  const entry = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level - 1))]
  const isMax = level >= LEVELS.length
  const nextLevelAt = isMax ? null : LEVEL_THRESHOLDS[level]
  const floor = LEVEL_THRESHOLDS[level - 1] ?? 0
  const span = isMax ? 1 : (nextLevelAt - floor)
  const progressPct = isMax ? 100 : Math.max(0, Math.min(100, Math.round(((points - floor) / span) * 100)))
  return { ...entry, points, nextLevelAt, progressPct, isMax }
}

export function computeLevelFromBadges(badges) {
  const points = pointsFromBadges(badges)
  const level = levelFromPoints(points)
  return getLevelInfo(level, points)
}
