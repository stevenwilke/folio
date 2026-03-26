import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { FakeCover } from '../../components/FakeCover';
import { ReadStatus } from '../../components/BookCard';

// ── Types ──────────────────────────────────────────────────

interface FolioBook {
  id: string;
  title: string;
  author: string | null;
  cover_image_url: string | null;
  isbn_13: string | null;
  isbn_10: string | null;
  published_year: number | null;
  userStatus: ReadStatus | null;
}

interface OLBook {
  key: string;
  title: string;
  coverUrl: string | null;
  year: number | null;
  isbn13: string | null;
  isbn10: string | null;
  adding: boolean;
  addedStatus: ReadStatus | null;
}

// ── Screen ─────────────────────────────────────────────────

export default function AuthorScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const authorName = decodeURIComponent(name ?? '');

  const [folioBooks, setFolioBooks] = useState<FolioBook[]>([]);
  const [olBooks, setOlBooks] = useState<OLBook[]>([]);
  const [friendCount, setFriendCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);

  async function fetchData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setMyId(user.id);

    // Folio books by this author
    const { data: folio } = await supabase
      .from('books')
      .select('id, title, author, cover_image_url, isbn_13, isbn_10, published_year')
      .ilike('author', `%${authorName}%`);

    const folioList = folio ?? [];

    // User's collection status for these books
    let statusMap: Record<string, ReadStatus> = {};
    if (folioList.length > 0) {
      const { data: owned } = await supabase
        .from('collection_entries')
        .select('book_id, read_status')
        .eq('user_id', user.id)
        .in('book_id', folioList.map((b: any) => b.id));
      (owned ?? []).forEach((e: any) => { statusMap[e.book_id] = e.read_status; });
    }

    const mappedFolio: FolioBook[] = folioList.map((b: any) => ({
      ...b,
      userStatus: statusMap[b.id] ?? null,
    }));
    setFolioBooks(mappedFolio);

    // Friend stats — how many friends have read any book by this author
    const { data: friendships } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    const friendIds = (friendships ?? []).map((f: any) =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id
    );

    if (friendIds.length > 0 && folioList.length > 0) {
      const bookIds = folioList.map((b: any) => b.id);
      const { data: friendEntries } = await supabase
        .from('collection_entries')
        .select('user_id')
        .in('user_id', friendIds)
        .in('book_id', bookIds);
      const uniqueFriends = new Set((friendEntries ?? []).map((e: any) => e.user_id));
      setFriendCount(uniqueFriends.size);
    } else {
      setFriendCount(0);
    }

    // Open Library results
    try {
      const res = await fetch(
        `https://openlibrary.org/search.json?author=${encodeURIComponent(authorName)}&limit=20&fields=key,title,isbn,cover_i,first_publish_year`
      );
      const json = await res.json();

      // ISBNs already in Folio — deduplicate
      const folioIsbn13s = new Set(mappedFolio.map((b) => b.isbn_13).filter(Boolean));
      const folioTitles = new Set(mappedFolio.map((b) => b.title?.toLowerCase()));

      const olList: OLBook[] = (json.docs ?? [])
        .filter((d: any) => {
          const i13 = d.isbn?.find((i: string) => i.length === 13);
          if (i13 && folioIsbn13s.has(i13)) return false;
          if (d.title && folioTitles.has(d.title.toLowerCase())) return false;
          return true;
        })
        .map((d: any) => ({
          key: d.key,
          title: d.title,
          coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
          year: d.first_publish_year ?? null,
          isbn13: d.isbn?.find((i: string) => i.length === 13) ?? null,
          isbn10: d.isbn?.find((i: string) => i.length === 10) ?? null,
          adding: false,
          addedStatus: null,
        }));

      setOlBooks(olList);
    } catch {
      setOlBooks([]);
    }
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchData().finally(() => setLoading(false));
    }, [authorName])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }

  async function addFromOL(olBook: OLBook, status: ReadStatus) {
    if (!myId) return;
    setOlBooks((prev) =>
      prev.map((b) => (b.key === olBook.key ? { ...b, adding: true } : b))
    );
    try {
      let bookId = '';

      if (olBook.isbn13) {
        const { data } = await supabase.from('books').select('id').eq('isbn_13', olBook.isbn13).maybeSingle();
        if (data) bookId = data.id;
      }
      if (!bookId && olBook.isbn10) {
        const { data } = await supabase.from('books').select('id').eq('isbn_10', olBook.isbn10).maybeSingle();
        if (data) bookId = data.id;
      }
      if (!bookId) {
        const { data } = await supabase.from('books').select('id')
          .eq('title', olBook.title).eq('author', authorName).maybeSingle();
        if (data) bookId = data.id;
      }
      if (!bookId) {
        const { data: newBook, error } = await supabase
          .from('books')
          .insert({
            title: olBook.title,
            author: authorName,
            isbn_13: olBook.isbn13,
            isbn_10: olBook.isbn10,
            cover_image_url: olBook.coverUrl,
            published_year: olBook.year,
          })
          .select('id')
          .single();
        if (error) throw error;
        bookId = newBook.id;
      }

      const { error: entryError } = await supabase
        .from('collection_entries')
        .upsert(
          { user_id: myId, book_id: bookId, read_status: status },
          { onConflict: 'user_id,book_id' }
        );
      if (entryError) throw entryError;

      setOlBooks((prev) =>
        prev.map((b) =>
          b.key === olBook.key ? { ...b, adding: false, addedStatus: status } : b
        )
      );

      // Refresh folio books so newly added one appears
      fetchData();
    } catch {
      setOlBooks((prev) =>
        prev.map((b) => (b.key === olBook.key ? { ...b, adding: false } : b))
      );
    }
  }

  // Stats for progress bar
  const readCount = folioBooks.filter((b) => b.userStatus === 'read').length;
  const totalFolio = folioBooks.length;

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />
      }
      data={[]} // we render everything in ListHeaderComponent
      renderItem={null}
      ListHeaderComponent={
        <>
          {/* Author header */}
          <Text style={styles.authorName}>{authorName}</Text>

          {/* Stats row */}
          <Text style={styles.statsRow}>
            <Text style={styles.statValue}>{totalFolio}</Text>
            <Text style={styles.statLabel}> in Folio</Text>
            {'  ·  '}
            <Text style={styles.statLabel}>Read by </Text>
            <Text style={styles.statValue}>{friendCount}</Text>
            <Text style={styles.statLabel}> friend{friendCount !== 1 ? 's' : ''}</Text>
          </Text>

          {/* Progress bar */}
          {totalFolio > 0 && (
            <View style={styles.progressSection}>
              <Text style={styles.progressLabel}>
                You've read{' '}
                <Text style={styles.progressBold}>{readCount}</Text>
                {' of '}
                <Text style={styles.progressBold}>{totalFolio}</Text>
                {totalFolio !== 1 ? ' books by this author' : ' book by this author'}
              </Text>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: totalFolio > 0
                        ? `${Math.round((readCount / totalFolio) * 100)}%` as any
                        : '0%',
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressPct}>
                {totalFolio > 0 ? `${Math.round((readCount / totalFolio) * 100)}%` : '0%'}
              </Text>
            </View>
          )}

          {/* In Folio section */}
          {totalFolio > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>In Folio</Text>
              {folioBooks.map((book) => (
                <TouchableOpacity
                  key={book.id}
                  style={styles.bookRow}
                  activeOpacity={0.75}
                  onPress={() => router.push(`/book/${book.id}`)}
                >
                  <BookCoverSmall
                    url={book.cover_image_url ?? (book.isbn_13 ? `https://covers.openlibrary.org/b/isbn/${book.isbn_13}-L.jpg` : null)}
                    title={book.title}
                    author={book.author}
                  />
                  <View style={styles.bookInfo}>
                    <Text style={styles.bookTitle} numberOfLines={2}>{book.title}</Text>
                    {book.published_year ? (
                      <Text style={styles.bookYear}>{book.published_year}</Text>
                    ) : null}
                    {book.userStatus ? (
                      <StatusBadge status={book.userStatus} />
                    ) : null}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* More Books section */}
          {olBooks.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>More Books</Text>
              {olBooks.map((book) => (
                <View key={book.key} style={styles.bookRow}>
                  <BookCoverSmall
                    url={book.coverUrl}
                    title={book.title}
                    author={authorName}
                  />
                  <View style={styles.bookInfo}>
                    <Text style={styles.bookTitle} numberOfLines={2}>{book.title}</Text>
                    {book.year ? (
                      <Text style={styles.bookYear}>{book.year}</Text>
                    ) : null}
                    {book.addedStatus ? (
                      <StatusBadge status={book.addedStatus} />
                    ) : book.adding ? (
                      <ActivityIndicator size="small" color={Colors.rust} style={{ marginTop: 6 }} />
                    ) : (
                      <TouchableOpacity
                        style={styles.addToLibBtn}
                        onPress={() => addFromOL(book, 'want')}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.addToLibBtnText}>+ Add to Library</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {totalFolio === 0 && olBooks.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📖</Text>
              <Text style={styles.emptyTitle}>No books found</Text>
              <Text style={styles.emptySubtitle}>
                We couldn't find any books by this author.
              </Text>
            </View>
          )}
        </>
      }
    />
  );
}

// ── Sub-components ─────────────────────────────────────────

function BookCoverSmall({
  url,
  title,
  author,
}: {
  url: string | null;
  title: string;
  author: string | null;
}) {
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={styles.coverSmall}
        resizeMode="cover"
      />
    );
  }
  return <FakeCover title={title} author={author} width={50} height={70} />;
}

function StatusBadge({ status }: { status: ReadStatus }) {
  const labels: Record<ReadStatus, string> = {
    owned: 'In Library',
    read: 'Read',
    reading: 'Reading',
    want: 'Want to Read',
  };
  return (
    <View
      style={[
        styles.statusBadge,
        { backgroundColor: Colors.statusBg[status] },
      ]}
    >
      <Text style={[styles.statusBadgeText, { color: Colors.status[status] }]}>
        {labels[status]}
      </Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  authorName: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 8,
    lineHeight: 34,
  },
  statsRow: {
    fontSize: 14,
    color: Colors.muted,
    marginBottom: 16,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  statValue: {
    fontWeight: '700',
    color: Colors.ink,
  },
  statLabel: {
    color: Colors.muted,
  },

  // Progress bar
  progressSection: {
    marginBottom: 24,
  },
  progressLabel: {
    fontSize: 13,
    color: Colors.muted,
    marginBottom: 8,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  progressBold: {
    fontWeight: '700',
    color: Colors.ink,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.sage,
    borderRadius: 4,
  },
  progressPct: {
    fontSize: 12,
    color: Colors.sage,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Sections
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Book rows
  bookRow: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  coverSmall: {
    width: 50,
    height: 70,
    borderRadius: 4,
    flexShrink: 0,
  },
  bookInfo: {
    flex: 1,
    gap: 4,
    paddingTop: 2,
  },
  bookTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    lineHeight: 18,
  },
  bookYear: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Status badge
  statusBadge: {
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Add to library button
  addToLibBtn: {
    marginTop: 6,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Colors.rust,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  addToLibBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.rust,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Empty state
  empty: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.ink,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});
