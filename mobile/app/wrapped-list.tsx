import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
import { BookCard, ReadStatus } from '../components/BookCard';

type FilterType = 'genre' | 'author' | 'year' | 'all-read';

interface BookRow {
  id: string;
  read_status: ReadStatus;
  added_at: string | null;
  books: {
    id: string;
    title: string;
    author: string | null;
    cover_image_url: string | null;
    genre: string | null;
    pages: number | null;
  } | null;
}

/**
 * Filtered book list that the Stats page deep-links into. Examples:
 *   /wrapped-list?type=genre&value=Non-Fiction&year=2026   (read books in genre, that year)
 *   /wrapped-list?type=author&value=David%20Baldacci       (all read books by author)
 *   /wrapped-list?type=year&value=2026                     (all read books in year)
 */
export default function WrappedListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; value?: string; year?: string; title?: string }>();
  const type = (params.type || 'all-read') as FilterType;
  const value = params.value || '';
  const year = params.year ? parseInt(params.year, 10) : null;

  const [rows, setRows] = useState<BookRow[]>([]);
  const [loading, setLoading] = useState(true);

  const screenTitle =
    params.title ||
    (type === 'genre'  ? `${value} books`
    : type === 'author' ? `By ${value}`
    : type === 'year'   ? `Books read in ${value}`
    : 'Books');

  async function fetchRows() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRows([]); return; }

    let query = supabase
      .from('collection_entries')
      .select('id, read_status, added_at, books!inner(id, title, author, cover_image_url, genre, pages)')
      .eq('user_id', user.id)
      .eq('read_status', 'read');

    if (type === 'genre')  query = query.eq('books.genre', value);
    if (type === 'author') query = query.eq('books.author', value);

    const { data } = await query.order('added_at', { ascending: false });
    let result = (data ?? []) as unknown as BookRow[];

    // Year filter is post-query because added_at can be the import date for
    // legacy entries; we still want to show them when filtering by author/genre.
    if (year != null) {
      result = result.filter((r) => {
        const d = r.added_at ? new Date(r.added_at) : null;
        return d ? d.getFullYear() === year : false;
      });
    }

    setRows(result);
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchRows().finally(() => setLoading(false));
    }, [type, value, year]),
  );

  const COLUMNS = 2;
  const HORIZONTAL_PADDING = 16;
  const GAP = 10;
  const cardWidth = Math.floor(
    (Dimensions.get('window').width - HORIZONTAL_PADDING * 2 - GAP) / COLUMNS,
  );

  return (
    <>
      <Stack.Screen options={{ title: screenTitle, headerBackTitle: 'Stats' }} />
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.rust} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No books here yet</Text>
          <Text style={styles.emptyHint}>
            As you mark books as Read, they'll show up in this list.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.root}
          contentContainerStyle={styles.content}
        >
          <Text style={styles.count}>
            {rows.length} book{rows.length === 1 ? '' : 's'}
          </Text>
          <View style={styles.grid}>
            {rows.map((r) => (
              <View key={r.id} style={{ marginBottom: GAP }}>
                <BookCard
                  id={r.books?.id ?? r.id}
                  title={r.books?.title ?? 'Untitled'}
                  author={r.books?.author}
                  coverImageUrl={r.books?.cover_image_url}
                  status={r.read_status}
                  cardWidth={cardWidth}
                  onPress={() => r.books?.id && router.push(`/book/${r.books.id}` as any)}
                />
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  count: {
    fontSize: 12,
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, padding: 32 },
  emptyTitle: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontSize: 18,
    fontWeight: '700',
    color: Colors.ink,
    marginBottom: 6,
  },
  emptyHint: { fontSize: 13, color: Colors.muted, textAlign: 'center' },
});
