/**
 * Maps Open Library subjects to clean canonical genre names.
 * Checks each subject string for known keywords, in priority order.
 */

const GENRE_MAP = [
  ['Young Adult',        ['young adult', 'ya fiction', 'teen fiction', 'juvenile fiction']],
  ["Children's",         ["children's", 'juvenile literature', 'picture book', 'middle grade']],
  ['Science Fiction',    ['science fiction', 'sci-fi', 'dystopian', 'space opera', 'cyberpunk', 'time travel fiction']],
  ['Fantasy',            ['fantasy fiction', 'fantasy', 'high fantasy', 'epic fantasy', 'fairy tale', 'magic realism']],
  ['Mystery',            ['mystery fiction', 'mystery', 'detective', 'whodunit', 'cozy mystery', 'crime fiction']],
  ['Thriller',           ['thriller', 'suspense fiction', 'psychological thriller']],
  ['Horror',             ['horror fiction', 'horror', 'ghost stories', 'supernatural fiction', 'occult fiction']],
  ['Romance',            ['romance fiction', 'romance', 'love stories', 'romantic fiction']],
  ['Historical Fiction', ['historical fiction', 'historical novel']],
  ['Biography',          ['biography', 'autobiography', 'memoirs', 'memoir']],
  ['Self-Help',          ['self-help', 'personal development', 'motivational']],
  ['Poetry',             ['poetry', 'poems', 'verse']],
  ['Graphic Novel',      ['graphic novel', 'comics', 'manga']],
  ['Non-Fiction',        ['history', 'science and', 'natural history', 'philosophy', 'psychology', 'economics', 'politics', 'religion', 'travel writing', 'essays']],
  ['Literary Fiction',   ['literary fiction', 'american fiction', 'english fiction', 'british fiction', 'fiction']],
]

// Subjects that are metadata noise, not genres
const SKIP = [
  'accessible book', 'protected daisy', 'large type', 'in library',
  'overdrive', 'open library', 'internet archive', 'nyt', 'new york times',
  'read', 'ebook', 'audiobook', 'hardcover', 'paperback',
]

export function extractGenre(subjects) {
  if (!subjects?.length) return null

  const cleaned = subjects
    .map(s => s.toLowerCase().trim())
    .filter(s => !SKIP.some(bad => s.includes(bad)))

  for (const [genre, keywords] of GENRE_MAP) {
    if (cleaned.some(s => keywords.some(k => s.includes(k)))) {
      return genre
    }
  }

  // Fall back to first remaining subject, title-cased, max 30 chars
  const first = subjects.find(s => !SKIP.some(bad => s.toLowerCase().includes(bad)))
  if (first) return first.length > 30 ? first.slice(0, 28) + '…' : first
  return null
}
