// Fiction genres (must match canonical names from genres.js)
const FICTION_GENRES = new Set([
  'Young Adult', "Children's", 'Science Fiction', 'Fantasy',
  'Mystery', 'Thriller', 'Horror', 'Romance',
  'Historical Fiction', 'Graphic Novel', 'Literary Fiction', 'Poetry',
]);

export interface ReadingSpeeds {
  fiction: number | null;
  nonfiction: number | null;
  blended: number | null;
}

export interface ReadingSession {
  started_at: string;
  ended_at: string | null;
  pages_read: number | null;
  is_fiction: boolean | null;
}

/** Returns true for fiction, false for nonfiction, null if genre unknown */
export function isFiction(genre: string | null): boolean | null {
  if (!genre) return null;
  return FICTION_GENRES.has(genre) ? true : false;
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute pages-per-minute reading speeds from completed sessions.
 * Returns { fiction, nonfiction, blended } — each is pages/min or null.
 */
export function computeReadingSpeeds(sessions: ReadingSession[]): ReadingSpeeds {
  const fictionSpeeds: number[] = [];
  const nonfictionSpeeds: number[] = [];

  for (const s of sessions) {
    if (!s.started_at || !s.ended_at || !s.pages_read || s.pages_read <= 0) continue;
    const minutes = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000;
    if (minutes < 2 || minutes > 480) continue;
    const ppm = s.pages_read / minutes;
    if (s.is_fiction === true) fictionSpeeds.push(ppm);
    else if (s.is_fiction === false) nonfictionSpeeds.push(ppm);
  }

  const allSpeeds = [...fictionSpeeds, ...nonfictionSpeeds];

  return {
    fiction: median(fictionSpeeds),
    nonfiction: median(nonfictionSpeeds),
    blended: median(allSpeeds),
  };
}

/**
 * Estimate reading time for a book.
 */
export function estimateReadingTime(
  totalPages: number,
  currentPage: number,
  genre: string | null,
  speeds: ReadingSpeeds,
): { minutes: number; label: string } | null {
  if (!totalPages || !speeds) return null;

  const remaining = Math.max(0, totalPages - (currentPage || 0));
  if (remaining === 0) return null;

  const fic = isFiction(genre);
  const speed =
    fic === true ? (speeds.fiction || speeds.blended) :
    fic === false ? (speeds.nonfiction || speeds.blended) :
    speeds.blended;

  if (!speed || speed <= 0) return null;

  const minutes = Math.round(remaining / speed);
  return { minutes, label: formatDuration(minutes) };
}

/** Format minutes into human-readable duration */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Format seconds into M:SS timer display */
export function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Check if an active session has been idle too long */
export function checkSessionIdle(startedAt: string, thresholdMin = 30) {
  const elapsedMin = (Date.now() - new Date(startedAt).getTime()) / 60000;
  return { isIdle: elapsedMin > thresholdMin, elapsedMin: Math.round(elapsedMin) };
}
