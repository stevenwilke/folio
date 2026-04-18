import React, { useState, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import SwipeTabNav from '../../components/SwipeTabNav';

interface SearchResult {
  key: string;
  type?: 'result';
  title: string;
  author: string;
  coverUrl: string | null;
  saveCoverUrl: string | null;
  year: number | null;
  isbn13: string | null;
  isbn10: string | null;
  genre: string | null;
  source: 'folio' | 'openlibrary' | 'google';
  bookId: string | null;
  addedStatus?: ReadStatus | null;
  adding?: boolean;
  inLibrary?: boolean;
  readStatus?: ReadStatus | null;
}

interface SectionHeaderItem {
  key: string;
  type: 'sectionHeader';
  label: string;
}

type ListItem = SearchResult | SectionHeaderItem;

const STATUS_OPTIONS: { key: ReadStatus; label: string }[] = [
  { key: 'owned', label: 'In Library' },
  { key: 'read', label: 'Read' },
  { key: 'reading', label: 'Reading' },
  { key: 'want', label: 'Want' },
];

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recent searches + recently added books for empty state
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentBooks, setRecentBooks] = useState<{ id: string; title: string; author: string | null; cover_image_url: string | null }[]>([]);
  const [recentSearchedBooks, setRecentSearchedBooks] = useState<{ id: string | null; title: string; author: string | null; coverUrl: string | null }[]>([]);
  const RECENT_SEARCHES_KEY = 'folio-recent-searches';
  const RECENT_SEARCHED_BOOKS_KEY = 'folio-recently-searched-books';

  useEffect(() => {
    AsyncStorage.multiGet([RECENT_SEARCHES_KEY, RECENT_SEARCHED_BOOKS_KEY]).then(pairs => {
      for (const [key, val] of pairs) {
        if (!val) continue;
        try {
          const parsed = JSON.parse(val);
          if (key === RECENT_SEARCHES_KEY) setRecentSearches(parsed);
          else setRecentSearchedBooks(parsed);
        } catch {}
      }
    });
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('collection_entries')
        .select('book_id, books(id, title, author, cover_image_url)')
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })
        .limit(8);
      if (data) {
        setRecentBooks(data.map((e: any) => ({
          id: e.books?.id || e.book_id,
          title: e.books?.title || '',
          author: e.books?.author || null,
          cover_image_url: e.books?.cover_image_url || null,
        })));
      }
    })();
  }, []);

  function saveRecentSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...recentSearches.filter(s => s !== trimmed)].slice(0, 8);
    setRecentSearches(updated);
    AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated)).catch(() => {});
  }

  async function doSearch(q: string) {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    saveRecentSearch(q);
    try {
      const stripped = q.replace(/[-\s]/g, '');
      const isIsbn   = /^\d{10,13}$/.test(stripped);

      // Build Supabase query
      let folioQ = supabase
        .from('books')
        .select('id, title, author, isbn_13, isbn_10, cover_image_url, published_year, genre')
        .limit(30);
      if (isIsbn) {
        folioQ = folioQ.or(`isbn_13.eq.${stripped},isbn_10.eq.${stripped}`);
      } else {
        folioQ = folioQ.or(`title.ilike.%${q.trim()}%,author.ilike.%${q.trim()}%`);
      }

      // Per-request timeout so a slow/dead API can never stall the search
      const fetchJson = async (url: string, ms = 8000): Promise<any> => {
        const ctrl = new AbortController();
        const id = setTimeout(() => ctrl.abort(), ms);
        try {
          const r = await fetch(url, { signal: ctrl.signal });
          return await r.json();
        } finally {
          clearTimeout(id);
        }
      };

      const [olJson, gbJson, { data: folioBooks }] = await Promise.all([
        fetchJson(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,isbn,cover_i,first_publish_year&limit=30`
        ).catch((err: any) => { console.warn('[Search] OpenLibrary failed:', err?.message ?? err); return { docs: [] }; }),
        fetchJson(
          `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=30`
        ).catch((err: any) => { console.warn('[Search] Google Books failed:', err?.message ?? err); return { items: [] }; }),
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

      // ISBNs already in the app — used to dedup OL results
      const folioIsbn13s = new Set(folioResults.map(r => r.isbn13).filter(Boolean));
      const folioIsbn10s = new Set(folioResults.map(r => r.isbn10).filter(Boolean));

      // Normalize Open Library results, skipping duplicates already in Folio DB
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
          coverUrl:     d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false` : null,
          saveCoverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false` : null,
          year:         d.first_publish_year || null,
          isbn13:       d.isbn?.find((i: string) => i.length === 13) || null,
          isbn10:       d.isbn?.find((i: string) => i.length === 10) || null,
          genre:        null,
          source:       'openlibrary' as const,
          bookId:       null,
          addedStatus:  null,
          adding:       false,
        }));

      // Normalize Google Books results, skipping duplicates already seen in Folio or OL
      const seenIsbn13 = new Set<string>([...folioIsbn13s, ...olResults.map((r) => r.isbn13).filter(Boolean) as string[]]);
      const seenIsbn10 = new Set<string>([...folioIsbn10s, ...olResults.map((r) => r.isbn10).filter(Boolean) as string[]]);
      const seenTitleKey = new Set<string>([
        ...folioResults.map((r) => `${r.title.toLowerCase()}|${(r.author || '').toLowerCase()}`),
        ...olResults.map((r) => `${r.title.toLowerCase()}|${(r.author || '').toLowerCase()}`),
      ]);

      const gbResults: SearchResult[] = (gbJson.items ?? [])
        .map((item: any) => {
          const info = item?.volumeInfo;
          if (!info?.title) return null;
          const ids: any[] = info.industryIdentifiers ?? [];
          const isbn13 = ids.find((x) => x.type === 'ISBN_13')?.identifier ?? null;
          const isbn10 = ids.find((x) => x.type === 'ISBN_10')?.identifier ?? null;
          const year = info.publishedDate ? parseInt(info.publishedDate.slice(0, 4)) : null;
          const coverUrl = (info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null)?.replace(/^http:/, 'https:') ?? null;
          return {
            key:          `gb-${item.id}`,
            title:        info.title,
            author:       info.authors?.[0] || 'Unknown author',
            coverUrl,
            saveCoverUrl: coverUrl,
            year,
            isbn13,
            isbn10,
            genre:        info.categories?.[0] ?? null,
            source:       'google' as const,
            bookId:       null,
            addedStatus:  null,
            adding:       false,
          } as SearchResult;
        })
        .filter((r: SearchResult | null): r is SearchResult => {
          if (!r) return false;
          if (r.isbn13 && seenIsbn13.has(r.isbn13)) return false;
          if (r.isbn10 && seenIsbn10.has(r.isbn10)) return false;
          const key = `${r.title.toLowerCase()}|${(r.author || '').toLowerCase()}`;
          if (seenTitleKey.has(key)) return false;
          seenTitleKey.add(key);
          if (r.isbn13) seenIsbn13.add(r.isbn13);
          if (r.isbn10) seenIsbn10.add(r.isbn10);
          return true;
        });

      // Check which folio books are in the user's library
      const { data: { user } } = await supabase.auth.getUser();
      let libraryBookIds = new Set<string>();
      let libraryStatusMap: Record<string, ReadStatus> = {};
      if (user && folioResults.length > 0) {
        const bookIds = folioResults.map(r => r.bookId).filter(Boolean) as string[];
        const { data: entries } = await supabase
          .from('collection_entries')
          .select('book_id, read_status')
          .eq('user_id', user.id)
          .in('book_id', bookIds);
        (entries || []).forEach((e: any) => {
          libraryBookIds.add(e.book_id);
          libraryStatusMap[e.book_id] = e.read_status;
        });
      }

      // Tag folio results with library info
      const taggedFolio = folioResults.map(r => ({
        ...r,
        inLibrary: r.bookId ? libraryBookIds.has(r.bookId) : false,
        readStatus: r.bookId ? (libraryStatusMap[r.bookId] || null) : null,
      }));

      const allResults: SearchResult[] = [...taggedFolio, ...olResults, ...gbResults];

      // Build sectioned list with header items
      const libraryBooks = allResults.filter(r => r.inLibrary);
      const otherBooks   = allResults.filter(r => !r.inLibrary);

      const sectioned: ListItem[] = [];
      if (libraryBooks.length > 0) {
        sectioned.push({ key: '__header_library', type: 'sectionHeader', label: 'In Your Library' });
        sectioned.push(...libraryBooks);
      }
      if (otherBooks.length > 0) {
        if (libraryBooks.length > 0) {
          sectioned.push({ key: '__header_all', type: 'sectionHeader', label: 'All Books' });
        }
        sectioned.push(...otherBooks);
      }

      setResults(sectioned);

      // Persist the top few result books so they show up under "Recently Searched"
      const topBooks = allResults
        .slice(0, 5)
        .map((r) => ({
          id: r.bookId ?? null,
          title: r.title,
          author: r.author ?? null,
          coverUrl: r.coverUrl ?? null,
        }));
      if (topBooks.length) {
        const dedupeKey = (b: { id: string | null; title: string }) => b.id ?? b.title.toLowerCase();
        const merged = [
          ...topBooks,
          ...recentSearchedBooks.filter(
            (b) => !topBooks.some((t) => dedupeKey(t) === dedupeKey(b)),
          ),
        ].slice(0, 10);
        setRecentSearchedBooks(merged);
        AsyncStorage.setItem(RECENT_SEARCHED_BOOKS_KEY, JSON.stringify(merged)).catch(() => {});
      }
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
    if (!item || item.type === 'sectionHeader') return;

    setResults((prev) =>
      prev.map((r, i) => (i === index ? { ...r, adding: true } : r))
    );

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const bookItem = item as SearchResult;
      let bookId: string = bookItem.bookId ?? '';

      if (!bookId) {
        // Try to find existing book by ISBN then title+author
        if (bookItem.isbn13) {
          const { data } = await supabase.from('books').select('id').eq('isbn_13', bookItem.isbn13).maybeSingle();
          if (data) bookId = data.id;
        }
        if (!bookId && bookItem.isbn10) {
          const { data } = await supabase.from('books').select('id').eq('isbn_10', bookItem.isbn10).maybeSingle();
          if (data) bookId = data.id;
        }
        if (!bookId) {
          const { data } = await supabase.from('books').select('id')
            .eq('title', bookItem.title).eq('author', bookItem.author).maybeSingle();
          if (data) bookId = data.id;
        }

        // Still not found — insert new book
        if (!bookId) {
          const { data: newBook, error: bookError } = await supabase
            .from('books')
            .insert({
              title:           bookItem.title,
              author:          bookItem.author,
              isbn_13:         bookItem.isbn13,
              isbn_10:         bookItem.isbn10,
              cover_image_url: bookItem.saveCoverUrl,
              published_year:  bookItem.year,
              genre:           bookItem.genre,
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

  const STATUS_LABELS: Record<ReadStatus, string> = {
    owned:   'In Library',
    read:    'Read',
    reading: 'Reading',
    want:    'Want to Read',
  };

  function renderItem({ item, index }: { item: ListItem; index: number }) {
    // Section header
    if (item.type === 'sectionHeader') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>{item.label}</Text>
        </View>
      );
    }

    const result = item as SearchResult;
    const libraryStatus = result.addedStatus || result.readStatus;

    return (
      <TouchableOpacity
        style={styles.resultCard}
        activeOpacity={result.bookId ? 0.7 : 1}
        onPress={() => {
          Keyboard.dismiss();
          if (result.bookId) router.push(`/book/${result.bookId}`);
        }}
      >
        <View style={styles.resultCover}>
          {result.coverUrl ? (
            <Image
              source={{ uri: result.coverUrl }}
              style={styles.coverImage}
              resizeMode="cover"
            />
          ) : (
            <FakeCover title={result.title} author={result.author} width={56} height={80} />
          )}
        </View>

        <View style={styles.resultInfo}>
          <Text style={styles.resultTitle} numberOfLines={2}>
            {result.title}
          </Text>
          <Text style={styles.resultAuthor} numberOfLines={1}>
            {result.author}
          </Text>
          {result.year ? (
            <Text style={styles.resultYear}>{result.year}</Text>
          ) : null}

          {libraryStatus ? (
            <View style={[styles.addedBadge, { backgroundColor: Colors.statusBg[libraryStatus] }]}>
              <Text style={[styles.addedBadgeText, { color: Colors.status[libraryStatus] }]}>
                {STATUS_LABELS[libraryStatus]} ✓
              </Text>
            </View>
          ) : (
            <View style={styles.addButtons}>
              {result.adding ? (
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
      </TouchableOpacity>
    );
  }

  return (
    <SwipeTabNav current="search">
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
        <FlatList<ListItem>
          data={results}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            results.length === 0 && styles.listContentEmpty,
            { paddingBottom: 120 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
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
                {/* Recently searched books — horizontal cards in the top area */}
                {recentSearchedBooks.length > 0 && (
                  <View style={[styles.recentSection, { marginTop: 0, alignItems: 'stretch' }]}>
                    <View style={styles.recentHeader}>
                      <Text style={styles.recentLabel}>Recently Searched</Text>
                      <TouchableOpacity onPress={() => { setRecentSearchedBooks([]); AsyncStorage.removeItem(RECENT_SEARCHED_BOOKS_KEY); }}>
                        <Text style={styles.recentClear}>Clear</Text>
                      </TouchableOpacity>
                    </View>
                    <FlatList
                      data={recentSearchedBooks}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyExtractor={(item, i) => (item.id ?? item.title) + ':' + i}
                      contentContainerStyle={{ gap: 10, paddingVertical: 8 }}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={styles.recentBookCard}
                          onPress={() => {
                            if (item.id) router.push(`/book/${item.id}`);
                            else { setQuery(item.title); doSearch(item.title); }
                          }}
                          activeOpacity={0.75}
                        >
                          {item.coverUrl ? (
                            <Image source={{ uri: item.coverUrl }} style={styles.recentBookCover} />
                          ) : (
                            <View style={[styles.recentBookCover, { backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                              <Text style={{ fontSize: 9, color: Colors.muted, textAlign: 'center', padding: 2 }} numberOfLines={3}>
                                {item.title}
                              </Text>
                            </View>
                          )}
                          <Text style={styles.recentBookTitle} numberOfLines={2}>{item.title}</Text>
                          {item.author && (
                            <Text style={styles.recentBookAuthor} numberOfLines={1}>{item.author}</Text>
                          )}
                        </TouchableOpacity>
                      )}
                    />
                  </View>
                )}

                {/* Recent search queries — chips */}
                {recentSearches.length > 0 && (
                  <View style={styles.recentSection}>
                    <View style={styles.recentHeader}>
                      <Text style={styles.recentLabel}>Recent Searches</Text>
                      <TouchableOpacity onPress={() => { setRecentSearches([]); AsyncStorage.removeItem(RECENT_SEARCHES_KEY); }}>
                        <Text style={styles.recentClear}>Clear</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.recentChips}>
                      {recentSearches.map((s, i) => (
                        <TouchableOpacity
                          key={i}
                          style={styles.recentChip}
                          onPress={() => { setQuery(s); doSearch(s); }}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.recentChipText}>{s}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                <Text style={styles.emptyIcon}>🔍</Text>
                <Text style={styles.emptyTitle}>Search for books</Text>
                <Text style={styles.emptySubtitle}>
                  Find books to add to your library, track reading progress, or save for later.
                </Text>

                {/* Quick add buttons */}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity
                    style={styles.manualBtn}
                    onPress={() => router.push('/manual-add' as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.manualBtnText}>+ Add Manually</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.manualBtn, { backgroundColor: Colors.rust }]}
                    onPress={() => router.push('/scan' as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.manualBtnText, { color: '#fff' }]}>📷 Scan Barcode</Text>
                  </TouchableOpacity>
                </View>

                {/* Recently added books */}
                {recentBooks.length > 0 && (
                  <View style={styles.recentSection}>
                    <Text style={styles.recentLabel}>Recently Added</Text>
                    <FlatList
                      data={recentBooks}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyExtractor={(item) => item.id}
                      contentContainerStyle={{ gap: 10, paddingVertical: 8 }}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={styles.recentBookCard}
                          onPress={() => router.push(`/book/${item.id}`)}
                          activeOpacity={0.75}
                        >
                          {item.cover_image_url ? (
                            <Image source={{ uri: item.cover_image_url }} style={styles.recentBookCover} />
                          ) : (
                            <View style={[styles.recentBookCover, { backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                              <Text style={{ fontSize: 9, color: Colors.muted, textAlign: 'center', padding: 2 }} numberOfLines={3}>
                                {item.title}
                              </Text>
                            </View>
                          )}
                          <Text style={styles.recentBookTitle} numberOfLines={2}>{item.title}</Text>
                          {item.author && (
                            <Text style={styles.recentBookAuthor} numberOfLines={1}>{item.author}</Text>
                          )}
                        </TouchableOpacity>
                      )}
                    />
                  </View>
                )}
              </View>
            )
          }
        />
      )}
    </View>
    </SwipeTabNav>
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
  sectionHeader: {
    paddingHorizontal: 4,
    paddingVertical: 6,
    marginTop: 4,
    marginBottom: 2,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
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
  resultTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    lineHeight: 18,
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
  recentSection: {
    width: '100%',
    marginTop: 24,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  recentLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.ink,
    letterSpacing: 0.5,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  recentClear: {
    fontSize: 12,
    color: Colors.rust,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  recentChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recentChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  recentChipText: {
    fontSize: 13,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  recentBookCard: {
    width: 80,
  },
  recentBookCover: {
    width: 80,
    height: 120,
    borderRadius: 4,
  },
  recentBookTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.ink,
    marginTop: 4,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  recentBookAuthor: {
    fontSize: 10,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});
