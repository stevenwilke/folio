/**
 * Reader levels — derived from earned badges.
 * Mirror of src/lib/level.js. Keep in sync.
 */

export const TIER_POINTS: Record<string, number> = { bronze: 1, silver: 3, gold: 5, platinum: 10 };

export const LEVEL_THRESHOLDS = [0, 5, 15, 30, 50, 75, 100, 130, 170, 220];

export interface LevelEntry {
  level: number;
  title: string;
  ring: string;
}

export const LEVELS: LevelEntry[] = [
  { level: 1,  title: 'Novice Reader',    ring: '#b89878' },
  { level: 2,  title: 'Page Seeker',      ring: '#b89878' },
  { level: 3,  title: 'Avid Reader',      ring: '#a05a20' },
  { level: 4,  title: 'Well Read',        ring: '#a05a20' },
  { level: 5,  title: 'Bibliophile',      ring: '#6a6a88' },
  { level: 6,  title: 'Literary Mind',    ring: '#6a6a88' },
  { level: 7,  title: 'Scholar',          ring: '#a07808' },
  { level: 8,  title: 'Master Reader',    ring: '#a07808' },
  { level: 9,  title: 'Grand Librarian',  ring: '#2a9090' },
  { level: 10, title: 'Legendary Reader', ring: '#2a9090' },
];

export interface EarnedBadge { earned: boolean; tier: string }

export function pointsFromBadges(badges: EarnedBadge[] | null | undefined): number {
  if (!badges) return 0;
  let pts = 0;
  for (const b of badges) {
    if (b.earned) pts += TIER_POINTS[b.tier] || 0;
  }
  return pts;
}

export function levelFromPoints(points: number): number {
  let lvl = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (points >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
  }
  return lvl;
}

export interface LevelInfo extends LevelEntry {
  points: number;
  nextLevelAt: number | null;
  progressPct: number;
  isMax: boolean;
}

export function getLevelInfo(level: number, points = 0): LevelInfo {
  const entry = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level - 1))];
  const isMax = level >= LEVELS.length;
  const nextLevelAt = isMax ? null : LEVEL_THRESHOLDS[level];
  const floor = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const span = isMax ? 1 : ((nextLevelAt as number) - floor);
  const progressPct = isMax ? 100 : Math.max(0, Math.min(100, Math.round(((points - floor) / span) * 100)));
  return { ...entry, points, nextLevelAt, progressPct, isMax };
}

export function computeLevelFromBadges(badges: EarnedBadge[]): LevelInfo {
  const points = pointsFromBadges(badges);
  const level = levelFromPoints(points);
  return getLevelInfo(level, points);
}
