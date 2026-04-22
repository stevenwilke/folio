import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { supabase } from './supabase';

const APP_GROUP = 'group.com.exlibris.app';
const KEY = 'currentlyReading';
const WIDGET_KIND = 'FolioCurrentlyReading';

// Cache the last-written payload (minus updatedAt, which churns every call) so we
// can skip redundant `setString` + `reloadWidget` when nothing meaningful changed.
let lastBooksSignature: string | null = null;

interface ReadingBook {
  title: string;
  author: string | null;
  coverUrl: string | null;
  currentPage: number | null;
  totalPages: number | null;
  bookId: string;
}

interface WidgetPayload {
  books: ReadingBook[];
  updatedAt: string;
}

// ExtensionStorage ships with @bacons/apple-targets — exposes:
//   setString(key, value, group)
//   reloadWidget(timelineKind)
const ExtensionStorage = requireOptionalNativeModule('ExtensionStorage') as
  | {
      setString: (key: string, value: string, group?: string) => void;
      reloadWidget: (kind?: string) => void;
    }
  | null;

/**
 * Syncs the user's most recent "reading" book to the shared App Group
 * UserDefaults so the iOS widget can display it. Safe no-op elsewhere.
 */
export async function syncCurrentlyReadingWidget(userId?: string): Promise<void> {
  if (Platform.OS !== 'ios' || !ExtensionStorage) return;

  try {
    let uid = userId;
    if (!uid) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      uid = user.id;
    }

    const { data: entries } = await supabase
      .from('collection_entries')
      .select('book_id, current_page, added_at, books(id, title, author, cover_image_url, pages)')
      .eq('user_id', uid)
      .eq('read_status', 'reading')
      .order('added_at', { ascending: false })
      // Generous cap — the watch app scrolls through all of these. The widget
      // only ever shows one at a time so it doesn't care; this just sets the
      // ceiling for the watch's reading list.
      .limit(30);

    const books: ReadingBook[] = (entries ?? [])
      .filter((e: any) => e.books)
      .map((e: any) => ({
        title: e.books.title,
        author: e.books.author ?? null,
        coverUrl: e.books.cover_image_url ?? null,
        currentPage: e.current_page ?? null,
        totalPages: e.books.pages ?? null,
        bookId: e.books.id,
      }));

    const booksSignature = JSON.stringify(books);
    if (booksSignature === lastBooksSignature) return;
    lastBooksSignature = booksSignature;

    const payload: WidgetPayload = {
      books,
      updatedAt: new Date().toISOString(),
    };

    ExtensionStorage.setString(KEY, JSON.stringify(payload), APP_GROUP);
    ExtensionStorage.reloadWidget(WIDGET_KIND);
  } catch {
    // Widget sync is best-effort — don't surface errors to the user
  }
}
