import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { FakeCover } from '../../components/FakeCover';
import { ReadStatus } from '../../components/BookCard';

// Unified result shape for both sources
interface SearchResult {
  key: string;
  title: string;
  author: string;
  coverUrl: string | null;
  saveCoverUrl: string | null;
  year: number | null;
  isbn13: string | null;
  isbn10: string | null;
  genre: string | null;
  source: 'folio' | 'openlibrary';
  bookId: string | null;
  addedStatus?: ReadStatus | null;
  adding?: boolean;
}

const STATUS_OPTIONS: { key: ReadStatus; label: string }[] = [
  { key: 'owned', label: 'In Library' },
  { key: 'read', label: 'Read' },
  { key: 'reading', label: 'Reading' },
  { key: 'want', label: 'Want' },
];

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function doSearch(q: string) {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const stripped = q.replace(/[-\s]/g, '');
      const isIsbn   = /^\d{10,13}$/.test(stripped);

      // Build Supabase query
      let folioQ = supabase
        .from('books')
        .select('id, title, author, isbn_13, isbn_10, cover_image_url, published_year, genre')
        .limit(8);
      if (isIsbn) {
        folioQ = folioQ.or(`isbn_13.eq.${stripped},isbn_10.eq.${stripped}`);
      } else {
        folioQ = folioQ.or(`title.ilike.%${q.trim()}%,author.ilike.%${q.trim()}%`);
      }

      const [olJson, { data: folioBooks }] = await Promise.all([
        fetch(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,isbn,cover_i,first_publish_year&limit=12`
        ).then(r => r.json()).catch(() => ({ docs: [] })),
        folioQ,
      ]);

      // Normalize Folio results
      const folioResults: SearchResult[] = (folioBooks ?? []).map((b: any) => ({
        key:          `folio-${b.id}`,
        title:        b.title,
        author:       b.author || 'Unknown author',
        coverUrl:     b.cover_image_url || null,
        saveCoverUrl: b.cover_image_url || null,
        year:         b.published_year || null,
        isbn13:       b.isbn_13 || null,
        isbn10:       b.isbn_10 || null,
        genre:        b.genre || null,
        source:       'folio',
        bookId:       b.id,
        addedStatus:  null,
        adding:       false,
      }));

      // ISBNs already in Folio — used to dedup OL results
      const folioIsbn13s = new Set(folioResults.map(r => r.isbn13).filter(Boolean));
      const folioIsbn10s = new Set(folioResults.map(r => r.isbn10).filter(Boolean));

      // Normalize OL results, skipping duplicates
      const olResults: SearchResult[] = (olJson.docs ?? [])
        .filter((d: any) => {
          const i13 = d.isbn?.find((i: string) => i.length === 13);
          const i10 = d.isbn?.find((i: string) => i.length === 10);
          if (i13 && folioIsbn13s.has(i13)) return false;
          if (i10 && folioIsbn10s.has(i10)) return false;
          return true;
        })
        .map((d: any) => ({
          key:          `ol-${d.key}`,
          title:        d.title,
          author:       d.author_name?.[0] || 'Unknown author',
          coverUrl:     d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : null,
          saveCoverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
          year:         d.first_publish_year || null,
          isbn13:       d.isbn?.find((i: string) => i.length === 13) || null,
          isbn10:       d.isbn?.find((i: string) => i.length === 10) || null,
          genre:        null,
          source:       'openlibrary',
          bookId:       null,
          addedStatus:  null,
          adding:       false,
        }));

      setResults([...folioResults, ...olResults]);
    } catch {
      Alert.alert('Error', 'Failed to search. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  function handleQueryChange(text: string) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(text), 500);
  }

  async function addBook(index: number, status: ReadStatus) {
    const item = results[index];
    if (!item) return;

    setResults((prev) =>
      prev.map((r, i) => (i === index ? { ...r, adding: true } : r))
    );

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let bookId: string = item.bookId ?? '';

      if (!bookId) {
        // Try to find existing book by ISBN then title+author
        if (item.isbn13) {
          const { data } = await supabase.from('books').select('id').eq('isbn_13', item.isbn13).maybeSingle();
          if (data) bookId = data.id;
        }
        if (!bookId && item.isbn10) {
          const { data } = await supabase.from('books').select('id').eq('isbn_10', item.isbn10).maybeSingle();
          if (data) bookId = data.id;
        }
        if (!bookId) {
          const { data } = await supabase.from('books').select('id')
            .eq('title', item.title).eq('author', item.author).maybeSingle();
          if (data) bookId = data.id;
        }

        // Still not found — insert new book
        if (!bookId) {
          const { data: newBook, error: bookError } = await supabase
            .from('books')
            .insert({
              title:           item.title,
              author:          item.author,
              isbn_13:         item.isbn13,
              isbn_10:         item.isbn10,
              cover_image_url: item.saveCoverUrl,
              published_year:  item.year,
              genre:           item.genre,
            })
            .select('id')
            .single();
          if (bookError) throw bookError;
          bookId = newBook.id;
        }
      }

      const { error: entryError } = await supabase
        .from('collection_entries')
        .upsert(
          { user_id: user.id, book_id: bookId, read_status: status },
          { onConflict: 'user_id,book_id' }
        );

      if (entryError) throw entryError;

      setResults((prev) =>
        prev.map((r, i) =>
          i === index ? { ...r, addedStatus: status, adding: false } : r
        )
      );
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not add book.');
      setResults((prev) =>
        prev.map((r, i) => (i === index ? { ...r, adding: false } : r))
      );
    }
  }

  function renderItem({ item, index }: { item: SearchResult; index: number }) {
    return (
      <View style={styles.resultCard}>
        <View style={styles.resultCover}>
          {item.coverUrl ? (
            <Image
              source={{ uri: item.coverUrl }}
              style={styles.coverImage}
              resizeMode="cover"
            />
          ) : (
            <FakeCover title={item.title} author={item.author} width={56} height={80} />
          )}
        </View>

        <View style={styles.resultInfo}>
          <View style={styles.titleRow}>
            <Text style={styles.resultTitle} numberOfLines={2}>
              {item.title}
            </Text>
            {item.source === 'folio' && (
              <View style={styles.folioBadge}>
                <Text style={styles.folioBadgeText}>📚 In Folio</Text>
              </View>
            )}
          </View>
          <Text style={styles.resultAuthor} numberOfLines={1}>
            {item.author}
          </Text>
          {item.year ? (
            <Text style={styles.resultYear}>{item.year}</Text>
          ) : null}

          {item.addedStatus ? (
            <View style={styles.addedBadge}>
              <Text style={styles.addedBadgeText}>
                Added as {STATUS_OPTIONS.find((s) => s.key === item.addedStatus)?.label} ✓
              </Text>
            </View>
          ) : (
            <View style={styles.addButtons}>
              {item.adding ? (
                <ActivityIndicator size="small" color={Colors.rust} />
              ) : (
                STATUS_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.addBtn, { borderColor: Colors.status[opt.key] }]}
                    onPress={() => {
                      Keyboard.dismiss();
                      addBook(index, opt.key);
                    }}
                  >
                    <Text style={[styles.addBtnText, { color: Colors.status[opt.key] }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Search bar + scan button */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={handleQueryChange}
            placeholder="Search by title, author, or ISBN…"
            placeholderTextColor={Colors.muted}
            returnKeyType="search"
            onSubmitEditing={() => doSearch(query)}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={() => router.push('/scan')}
          activeOpacity={0.8}
        >
          <Text style={styles.scanBtnIcon}>📷</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.rust} />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            results.length === 0 && styles.listContentEmpty,
          ]}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            searched && results.length > 0 ? (
              <TouchableOpacity
                style={styles.manualBanner}
                onPress={() => router.push('/manual-add' as any)}
                activeOpacity={0.7}
              >
                <Text style={styles.manualBannerText}>Can't find it?</Text>
                <Text style={styles.manualBannerLink}>Add manually →</Text>
              </TouchableOpacity>
            ) : null
          }
          ListEmptyComponent={
            searched ? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📭</Text>
                <Text style={styles.emptyTitle}>No results found</Text>
                <Text style={styles.emptySubtitle}>Try a different search term.</Text>
                <TouchableOpacity
                  style={styles.manualBtn}
                  onPress={() => router.push('/manual-add' as any)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.manualBtnText}>Add Book Manually</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>🔍</Text>
                <Text style={styles.emptyTitle}>Search for books</Text>
                <Text style={styles.emptySubtitle}>
                  Find books to add to your library, track reading progress, or save for later.
                </Text>
              </View>
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
  },
  scanBtn: {
    width: 48,
    height: 48,
    backgroundColor: Colors.rust,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtnIcon: {
    fontSize: 22,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
    paddingTop: 0,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  resultCard: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
    padding: 12,
    gap: 12,
  },
  resultCover: {
    flexShrink: 0,
  },
  coverImage: {
    width: 56,
    height: 80,
    borderRadius: 3,
  },
  resultInfo: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    flexWrap: 'wrap',
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    lineHeight: 18,
    flexShrink: 1,
  },
  folioBadge: {
    backgroundColor: 'rgba(90,122,90,0.12)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    flexShrink: 0,
    alignSelf: 'flex-start',
    marginTop: 1,
  },
  folioBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.sage,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  resultAuthor: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  resultYear: {
    fontSize: 11,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  addButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  addBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    backgroundColor: Colors.background,
  },
  addBtnText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  addedBadge: {
    marginTop: 6,
    backgroundColor: Colors.statusBg.owned,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  addedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.sage,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  manualBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  manualBannerText: {
    fontSize: 13,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  manualBannerLink: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.rust,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  manualBtn: {
    marginTop: 20,
    backgroundColor: Colors.rust,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  manualBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
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
