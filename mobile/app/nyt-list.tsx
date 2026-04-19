import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, Platform, ScrollView,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Colors } from '../constants/colors';
import { supabase } from '../lib/supabase';
import { FakeCover } from '../components/FakeCover';

const NYT_API_KEY = '2vGCkSNIV0d51GG4sERlG9pwoYG7b8ktvPLFBNmbsCWtK2oO';

const NYT_LISTS = [
  { key: 'hardcover-fiction',                    label: 'Fiction',     emoji: '📖' },
  { key: 'combined-print-and-e-book-nonfiction', label: 'Nonfiction',  emoji: '🧠' },
  { key: 'trade-fiction-paperback',              label: 'Paperback',   emoji: '📄' },
  { key: 'young-adult-hardcover',                label: 'Young Adult', emoji: '🌟' },
];

interface NYTBook {
  title: string;
  author: string | null;
  coverUrl: string | null;
  rank: number;
  weeksOnList: number;
  description: string | null;
  isbn13: string | null;
}

function titleKey(title?: string | null, author?: string | null) {
  return `${(title ?? '').toLowerCase().trim()}||${(author ?? '').toLowerCase().trim()}`;
}

async function fetchNYTList(listName: string): Promise<NYTBook[]> {
  try {
    const r = await fetch(
      `https://api.nytimes.com/svc/books/v3/lists/current/${listName}.json?api-key=${NYT_API_KEY}`
    );
    const j = await r.json();
    const books = j.results?.books ?? [];
    return books.map((b: any) => ({
      title: b.title?.replace(/\b\w+/g, (w: string) => w[0] + w.slice(1).toLowerCase()) ?? b.title,
      author: b.author ?? null,
      coverUrl: b.book_image ?? null,
      rank: b.rank ?? 0,
      weeksOnList: b.weeks_on_list ?? 0,
      description: b.description ?? null,
      isbn13: b.primary_isbn13 ?? null,
    }));
  } catch {
    return [];
  }
}

export default function NYTListScreen() {
  const params = useLocalSearchParams<{ list?: string }>();
  const router = useRouter();
  const initial = NYT_LISTS.find(l => l.key === params.list)?.key ?? NYT_LISTS[0].key;

  const [activeList, setActiveList] = useState(initial);
  const [books, setBooks] = useState<NYTBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [myKeys, setMyKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchNYTList(activeList).then(result => {
      if (!cancelled) {
        setBooks(result);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [activeList]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('collection_entries')
        .select('books(title, author)')
        .eq('user_id', user.id);
      const keys = new Set<string>();
      (data || []).forEach((e: any) => keys.add(titleKey(e.books?.title, e.books?.author)));
      setMyKeys(keys);
    })();
  }, []);

  const activeMeta = NYT_LISTS.find(l => l.key === activeList);

  const openBook = useCallback(async (book: NYTBook) => {
    // Try to match in our books table (by ISBN first, then title+author), otherwise create a stub.
    let bookId: string | null = null;
    if (book.isbn13) {
      const { data } = await supabase.from('books').select('id').eq('isbn_13', book.isbn13).maybeSingle();
      if (data) bookId = data.id;
    }
    if (!bookId && book.author) {
      const { data } = await supabase
        .from('books').select('id')
        .eq('title', book.title).eq('author', book.author).maybeSingle();
      if (data) bookId = data.id;
    }
    if (!bookId) {
      const { data: created } = await supabase.from('books').insert({
        title: book.title, author: book.author,
        isbn_13: book.isbn13, cover_image_url: book.coverUrl,
        description: book.description,
      }).select('id').single();
      if (created) bookId = created.id;
    }
    if (bookId) router.push(`/book/${bookId}` as any);
  }, [router]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{
        title: 'NYT Best Sellers',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.ink,
      }} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        {NYT_LISTS.map(l => (
          <TouchableOpacity
            key={l.key}
            style={[styles.tab, activeList === l.key && styles.tabActive]}
            onPress={() => setActiveList(l.key)}
          >
            <Text style={[styles.tabText, activeList === l.key && styles.tabTextActive]}>
              {l.emoji} {l.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.attribution}>
        {activeMeta?.emoji} {activeMeta?.label} · From The New York Times
      </Text>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.rust} />
        </View>
      ) : books.length === 0 ? (
        <Text style={styles.empty}>No best sellers available.</Text>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(b, i) => `${b.rank}-${i}`}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const have = myKeys.has(titleKey(item.title, item.author));
            return (
              <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => openBook(item)}>
                <View style={styles.rankBadge}>
                  <Text style={styles.rankNumber}>{item.rank}</Text>
                </View>
                <View style={styles.coverWrap}>
                  {item.coverUrl
                    ? <Image source={{ uri: item.coverUrl }} style={styles.cover} resizeMode="cover" />
                    : <FakeCover title={item.title} author={item.author ?? ''} width={64} height={96} />
                  }
                </View>
                <View style={styles.meta}>
                  <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                  {item.author && <Text style={styles.author} numberOfLines={1}>{item.author}</Text>}
                  <Text style={styles.weeks}>
                    {item.weeksOnList === 1 ? '1 week on list' : `${item.weeksOnList} weeks on list`}
                  </Text>
                  {have && <Text style={styles.have}>✓ In Library</Text>}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  tabRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.rust, borderColor: Colors.rust },
  tabText: {
    fontSize: 12, fontWeight: '600', color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  tabTextActive: { color: '#fff' },
  attribution: {
    fontSize: 12, color: Colors.muted, fontStyle: 'italic',
    paddingHorizontal: 16, marginBottom: 8,
  },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: 14, color: Colors.muted, textAlign: 'center', padding: 40 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  rankBadge: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.rust, alignItems: 'center', justifyContent: 'center',
  },
  rankNumber: {
    color: '#fff', fontSize: 14, fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  coverWrap: { width: 64, height: 96, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden' },
  cover: { width: '100%', height: '100%' },
  meta: { flex: 1, gap: 2 },
  title: {
    fontSize: 14, fontWeight: '700', color: Colors.ink, lineHeight: 18,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  author: { fontSize: 12, color: Colors.muted },
  weeks: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  have: { fontSize: 11, color: Colors.sage, fontWeight: '600', marginTop: 2 },
});
