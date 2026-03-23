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
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { FakeCover } from '../../components/FakeCover';
import { ReadStatus } from '../../components/BookCard';

interface OpenLibraryDoc {
  key: string;
  title: string;
  author_name?: string[];
  isbn?: string[];
  cover_i?: number;
  first_publish_year?: number;
}

interface SearchResult extends OpenLibraryDoc {
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
      const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,isbn,cover_i,first_publish_year&limit=12`;
      const res = await fetch(url);
      const json = await res.json();
      const docs: SearchResult[] = (json.docs ?? []).map((d: OpenLibraryDoc) => ({
        ...d,
        addedStatus: null,
        adding: false,
      }));
      setResults(docs);
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

    // Optimistically mark as adding
    setResults((prev) =>
      prev.map((r, i) => (i === index ? { ...r, adding: true } : r))
    );

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Upsert book record
      const isbn13 = item.isbn?.find((i) => i.length === 13) ?? null;
      const isbn10 = item.isbn?.find((i) => i.length === 10) ?? null;
      const coverUrl = item.cover_i
        ? `https://covers.openlibrary.org/b/id/${item.cover_i}-M.jpg`
        : null;

      const bookPayload = {
        title: item.title,
        author: item.author_name?.[0] ?? null,
        isbn_13: isbn13,
        isbn_10: isbn10,
        cover_image_url: coverUrl,
        published_year: item.first_publish_year ?? null,
      };

      // Try to find existing book by ISBN or title+author
      let bookId: string;

      const { data: existingBooks } = await supabase
        .from('books')
        .select('id')
        .or(
          isbn13
            ? `isbn_13.eq.${isbn13}`
            : `title.eq.${item.title},author.eq.${item.author_name?.[0] ?? ''}`
        )
        .limit(1);

      if (existingBooks && existingBooks.length > 0) {
        bookId = existingBooks[0].id;
        // Update cover if missing
        await supabase
          .from('books')
          .update(bookPayload)
          .eq('id', bookId);
      } else {
        const { data: newBook, error: bookError } = await supabase
          .from('books')
          .insert(bookPayload)
          .select('id')
          .single();
        if (bookError) throw bookError;
        bookId = newBook.id;
      }

      // Upsert collection entry
      const { error: entryError } = await supabase
        .from('collection_entries')
        .upsert(
          {
            user_id: user.id,
            book_id: bookId,
            read_status: status,
          },
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
    const coverUrl = item.cover_i
      ? `https://covers.openlibrary.org/b/id/${item.cover_i}-S.jpg`
      : null;
    const author = item.author_name?.[0] ?? 'Unknown author';

    return (
      <View style={styles.resultCard}>
        <View style={styles.resultCover}>
          {coverUrl ? (
            <Image
              source={{ uri: coverUrl }}
              style={styles.coverImage}
              resizeMode="cover"
            />
          ) : (
            <FakeCover title={item.title} author={author} width={56} height={80} />
          )}
        </View>

        <View style={styles.resultInfo}>
          <Text style={styles.resultTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.resultAuthor} numberOfLines={1}>
            {author}
          </Text>
          {item.first_publish_year ? (
            <Text style={styles.resultYear}>{item.first_publish_year}</Text>
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
      {/* Search bar */}
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
          ListEmptyComponent={
            searched ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No results found</Text>
                <Text style={styles.emptySubtitle}>Try a different search term.</Text>
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
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
