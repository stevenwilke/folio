import { supabase } from './supabase';

/**
 * Mobile mirror of src/lib/externalRating.js — keep in sync.
 * Fetches a default book rating from Google Books or Open Library so books
 * the Ex Libris community hasn't rated yet still show some signal.
 */

interface BookData {
  isbn_13?: string | null;
  isbn_10?: string | null;
  title?: string | null;
  author?: string | null;
}

interface ExternalRating {
  rating: number;
  count: number;
  source: 'google_books' | 'open_library';
}

export async function fetchExternalRating(b: BookData = {}): Promise<ExternalRating | null> {
  const isbn = b.isbn_13 || b.isbn_10 || null;
  return (
    (await fetchGoogleBooksRating(isbn, b.title, b.author)) ||
    (await fetchOpenLibraryRating(isbn, b.title, b.author))
  );
}

async function fetchGoogleBooksRating(
  isbn: string | null,
  title?: string | null,
  author?: string | null,
): Promise<ExternalRating | null> {
  try {
    const q = isbn
      ? `isbn:${isbn}`
      : `intitle:${title ?? ''}${author ? `+inauthor:${author}` : ''}`;
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    for (const item of data.items || []) {
      const vi = item.volumeInfo;
      if (vi?.averageRating != null && vi.ratingsCount > 0) {
        return { rating: Number(vi.averageRating), count: Number(vi.ratingsCount), source: 'google_books' };
      }
    }
  } catch {}
  return null;
}

async function fetchOpenLibraryRating(
  isbn: string | null,
  title?: string | null,
  author?: string | null,
): Promise<ExternalRating | null> {
  try {
    let workKey: string | null = null;
    if (isbn) {
      const r = await fetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=key&limit=1`);
      if (r.ok) {
        const d = await r.json();
        workKey = d?.docs?.[0]?.key || null;
      }
    }
    if (!workKey && (title || author)) {
      const q = encodeURIComponent(`${title ?? ''} ${author ?? ''}`.trim());
      const r = await fetch(`https://openlibrary.org/search.json?q=${q}&fields=key&limit=1`);
      if (r.ok) {
        const d = await r.json();
        workKey = d?.docs?.[0]?.key || null;
      }
    }
    if (!workKey || !workKey.startsWith('/works/')) return null;

    const r = await fetch(`https://openlibrary.org${workKey}/ratings.json`);
    if (!r.ok) return null;
    const d = await r.json();
    const avg = d?.summary?.average;
    const count = d?.summary?.count;
    if (avg && count > 0) {
      return { rating: Number(avg), count: Number(count), source: 'open_library' };
    }
  } catch {}
  return null;
}

export async function syncExternalRating(bookId: string, bookData: BookData) {
  if (!bookId) return null;
  const result = await fetchExternalRating(bookData);
  const update = result
    ? {
        external_rating: result.rating,
        external_rating_count: result.count,
        external_rating_source: result.source,
        external_rating_fetched_at: new Date().toISOString(),
      }
    : { external_rating_fetched_at: new Date().toISOString() };
  await supabase.from('books').update(update).eq('id', bookId);
  return result;
}

export interface DisplayRating {
  kind: 'community' | 'external';
  avg: number;
  count: number;
  source: string;
}

export function getDisplayRating(
  community: { avg_rating?: string | number | null; rating_count?: number | null } | null,
  book: { external_rating?: number | null; external_rating_count?: number | null; external_rating_source?: string | null } | null,
): DisplayRating | null {
  if (community && (community.rating_count || 0) > 0) {
    return {
      kind: 'community',
      avg: parseFloat(String(community.avg_rating || 0)),
      count: community.rating_count || 0,
      source: 'Ex Libris',
    };
  }
  if (book?.external_rating != null && (book?.external_rating_count || 0) > 0) {
    return {
      kind: 'external',
      avg: Number(book.external_rating),
      count: Number(book.external_rating_count),
      source: book.external_rating_source === 'open_library' ? 'Open Library' : 'Google Books',
    };
  }
  return null;
}
