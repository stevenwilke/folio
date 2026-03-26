import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  Keyboard,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
import { FakeCover } from '../components/FakeCover';

// ── Types ──────────────────────────────────────────────────

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
}

interface FriendSearchResult {
  id: string;
  username: string;
  avatar_url: string | null;
  requested: boolean;
}

const POPULAR_ISBNS = [
  '9780525559474',
  '9780385737951',
  '9780743273565',
  '9780061120084',
  '9780316769174',
  '9780062315007',
];

const TOTAL_STEPS = 3;

// ── Main Screen ────────────────────────────────────────────

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  function goNext() {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  async function finish() {
    await AsyncStorage.setItem('exlibris-onboarded', 'true');
    router.replace('/(tabs)');
  }

  return (
    <SafeAreaView style={styles.root}>
      {/* Progress dots */}
      <View style={styles.dotsRow}>
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === step && styles.dotActive]}
          />
        ))}
      </View>

      {step === 0 && <StepWelcome onNext={goNext} />}
      {step === 1 && <StepImportFriends onSkip={goNext} onContinue={goNext} />}
      {step === 2 && <StepFirstBook onFinish={finish} />}
    </SafeAreaView>
  );
}

// ── Step 1: Welcome ────────────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.logoText}>Ex Libris</Text>
      <Text style={styles.headline}>Your reading life, organized.</Text>

      <View style={styles.featureCards}>
        <View style={styles.featureCard}>
          <Text style={styles.featureIcon}>📚</Text>
          <View style={styles.featureText}>
            <Text style={styles.featureTitle}>Track Everything</Text>
            <Text style={styles.featureSub}>Library, statuses, ratings</Text>
          </View>
        </View>
        <View style={styles.featureCard}>
          <Text style={styles.featureIcon}>👥</Text>
          <View style={styles.featureText}>
            <Text style={styles.featureTitle}>Friends &amp; Social</Text>
            <Text style={styles.featureSub}>See what friends read</Text>
          </View>
        </View>
        <View style={styles.featureCard}>
          <Text style={styles.featureIcon}>🔍</Text>
          <View style={styles.featureText}>
            <Text style={styles.featureTitle}>Discover &amp; Trade</Text>
            <Text style={styles.featureSub}>Find new books, marketplace</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={onNext} activeOpacity={0.85}>
        <Text style={styles.primaryBtnText}>Get Started →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── Step 2: Import & Friends ───────────────────────────────

function StepImportFriends({
  onSkip,
  onContinue,
}: {
  onSkip: () => void;
  onContinue: () => void;
}) {
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<FriendSearchResult[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setMyId(user.id);
    });
  }, []);

  async function runSearch() {
    const q = search.trim();
    if (!q || !myId) return;
    setSearching(true);
    setSearched(true);
    Keyboard.dismiss();

    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${q}%`)
      .neq('id', myId)
      .limit(15);

    const ids = (data || []).map((p: any) => p.id);
    const requestedSet = new Set<string>();
    if (ids.length) {
      const { data: fs } = await supabase
        .from('friendships')
        .select('addressee_id')
        .eq('requester_id', myId)
        .eq('status', 'pending')
        .in('addressee_id', ids);
      (fs || []).forEach((f: any) => requestedSet.add(f.addressee_id));
    }

    setResults(
      (data || []).map((p: any) => ({
        id: p.id,
        username: p.username,
        avatar_url: p.avatar_url,
        requested: requestedSet.has(p.id),
      }))
    );
    setSearching(false);
  }

  async function addFriend(userId: string) {
    if (!myId) return;
    setActing(userId);
    await supabase
      .from('friendships')
      .insert({ requester_id: myId, addressee_id: userId });
    setResults((prev) =>
      prev.map((r) => (r.id === userId ? { ...r, requested: true } : r))
    );
    setActing(null);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.stepContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.stepTitle}>Bring your books</Text>

      {/* Goodreads import */}
      <View style={styles.infoCard}>
        <Text style={styles.infoCardTitle}>Import from Goodreads</Text>
        <Text style={styles.infoCardBody}>
          Export your Goodreads library as a CSV and import it on the Ex Libris
          web app at <Text style={styles.infoCardLink}>exlibris.app</Text> to
          bring over your entire reading history.
        </Text>
        <View style={styles.webNote}>
          <Text style={styles.webNoteText}>Import on Web (CSV)</Text>
        </View>
      </View>

      {/* Find Friends */}
      <View style={styles.infoCard}>
        <Text style={styles.infoCardTitle}>Find Friends</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by username…"
            placeholderTextColor={Colors.muted}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={runSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.searchBtn, (!search.trim() || searching) && { opacity: 0.5 }]}
            onPress={runSearch}
            disabled={!search.trim() || searching}
          >
            <Text style={styles.searchBtnText}>{searching ? '…' : 'Search'}</Text>
          </TouchableOpacity>
        </View>

        {searched && !searching && (
          <View style={{ marginTop: 8, gap: 6 }}>
            {results.length === 0 ? (
              <Text style={styles.emptySearch}>No users found for "{search}"</Text>
            ) : (
              results.map((user) => (
                <View key={user.id} style={styles.friendRow}>
                  <MiniAvatar username={user.username} size={36} />
                  <Text style={styles.friendName}>{user.username}</Text>
                  {user.requested ? (
                    <Text style={styles.requestedText}>Requested</Text>
                  ) : (
                    <TouchableOpacity
                      style={styles.addBtn}
                      onPress={() => addFriend(user.id)}
                      disabled={acting === user.id}
                    >
                      <Text style={styles.addBtnText}>
                        {acting === user.id ? '…' : '+ Add'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={styles.stepActions}>
        <TouchableOpacity onPress={onSkip} style={styles.skipBtn}>
          <Text style={styles.skipBtnText}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={onContinue} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ── Step 3: Add First Book ─────────────────────────────────

function StepFirstBook({ onFinish }: { onFinish: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function doSearch(q: string) {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const [olJson, { data: folioBooks }] = await Promise.all([
        fetch(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,isbn,cover_i,first_publish_year&limit=10`
        ).then((r) => r.json()).catch(() => ({ docs: [] })),
        supabase
          .from('books')
          .select('id, title, author, isbn_13, isbn_10, cover_image_url, published_year, genre')
          .or(`title.ilike.%${q.trim()}%,author.ilike.%${q.trim()}%`)
          .limit(6),
      ]);

      const folioResults: SearchResult[] = (folioBooks ?? []).map((b: any) => ({
        key: `folio-${b.id}`,
        title: b.title,
        author: b.author || 'Unknown author',
        coverUrl: b.cover_image_url || null,
        saveCoverUrl: b.cover_image_url || null,
        year: b.published_year || null,
        isbn13: b.isbn_13 || null,
        isbn10: b.isbn_10 || null,
        genre: b.genre || null,
        source: 'folio',
        bookId: b.id,
      }));

      const folioIsbn13s = new Set(folioResults.map((r) => r.isbn13).filter(Boolean));

      const olResults: SearchResult[] = (olJson.docs ?? [])
        .filter((d: any) => {
          const i13 = d.isbn?.find((i: string) => i.length === 13);
          return !(i13 && folioIsbn13s.has(i13));
        })
        .map((d: any) => ({
          key: `ol-${d.key}`,
          title: d.title,
          author: d.author_name?.[0] || 'Unknown author',
          coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : null,
          saveCoverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
          year: d.first_publish_year || null,
          isbn13: d.isbn?.find((i: string) => i.length === 13) || null,
          isbn10: d.isbn?.find((i: string) => i.length === 10) || null,
          genre: null,
          source: 'openlibrary',
          bookId: null,
        }));

      setResults([...folioResults, ...olResults].slice(0, 12));
    } catch {
      // silent — search is best-effort
    } finally {
      setLoading(false);
    }
  }

  function handleQueryChange(text: string) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(text), 500);
  }

  async function addBook(item: SearchResult) {
    if (adding || added) return;
    setAdding(item.key);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let bookId: string = item.bookId ?? '';

      if (!bookId) {
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
        if (!bookId) {
          const { data: newBook, error: bookError } = await supabase
            .from('books')
            .insert({
              title: item.title,
              author: item.author,
              isbn_13: item.isbn13,
              isbn_10: item.isbn10,
              cover_image_url: item.saveCoverUrl,
              published_year: item.year,
              genre: item.genre,
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
          { user_id: user.id, book_id: bookId, read_status: 'reading' },
          { onConflict: 'user_id,book_id' }
        );
      if (entryError) throw entryError;

      setAdded(item.key);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not add book.');
    } finally {
      setAdding(null);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.stepContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.stepTitle}>What are you reading?</Text>
        <Text style={styles.stepSubtitle}>
          Add a book to kick things off. We'll mark it as "Currently Reading."
        </Text>

        {/* Search bar */}
        <View style={styles.searchBarWrap}>
          <TextInput
            style={styles.searchInputLarge}
            placeholder="Search by title or author…"
            placeholderTextColor={Colors.muted}
            value={query}
            onChangeText={handleQueryChange}
            returnKeyType="search"
            onSubmitEditing={() => doSearch(query)}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>

        {/* Popular books row */}
        {!query.trim() && (
          <View style={{ marginBottom: 16 }}>
            <Text style={styles.popularLabel}>Popular picks</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }}>
              <View style={styles.popularRow}>
                {POPULAR_ISBNS.map((isbn) => (
                  <PopularCover key={isbn} isbn={isbn} onAdd={onFinish} />
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Search results */}
        {loading && (
          <ActivityIndicator size="small" color={Colors.rust} style={{ marginTop: 12 }} />
        )}

        {!loading && results.length > 0 && (
          <View style={{ gap: 8 }}>
            {results.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.resultRow, added === item.key && styles.resultRowAdded]}
                onPress={() => addBook(item)}
                activeOpacity={0.75}
                disabled={!!added}
              >
                {item.coverUrl ? (
                  <Image
                    source={{ uri: item.coverUrl }}
                    style={styles.resultCover}
                    resizeMode="cover"
                  />
                ) : (
                  <FakeCover title={item.title} author={item.author} width={44} height={62} />
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.resultTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.resultAuthor} numberOfLines={1}>{item.author}</Text>
                  {item.year ? <Text style={styles.resultYear}>{item.year}</Text> : null}
                </View>
                {adding === item.key ? (
                  <ActivityIndicator size="small" color={Colors.rust} />
                ) : added === item.key ? (
                  <View style={styles.addedBadge}>
                    <Text style={styles.addedBadgeText}>Reading ✓</Text>
                  </View>
                ) : (
                  <View style={styles.tapHint}>
                    <Text style={styles.tapHintText}>Tap to add</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 24 }]}
          onPress={onFinish}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Start Exploring →</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ── Popular Cover cell ──────────────────────────────────────

function PopularCover({ isbn, onAdd }: { isbn: string; onAdd: () => void }) {
  const coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
  return (
    <TouchableOpacity style={styles.popularCover} onPress={onAdd} activeOpacity={0.8}>
      <Image source={{ uri: coverUrl }} style={styles.popularCoverImg} resizeMode="cover" />
    </TouchableOpacity>
  );
}

// ── Mini Avatar ─────────────────────────────────────────────

function MiniAvatar({ username, size }: { username: string; size: number }) {
  const colors = [Colors.rust, Colors.sage, Colors.gold, '#4a6fa5', '#7b5ea7'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash + username.charCodeAt(i)) % colors.length;
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: colors[hash], justifyContent: 'center', alignItems: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontSize: size * 0.4, fontWeight: '700' }}>
        {username.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 16,
    paddingBottom: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.border,
  },
  dotActive: {
    backgroundColor: Colors.rust,
    width: 24,
  },

  // Step container
  stepContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 48,
  },

  // Welcome step
  logoText: {
    fontSize: 52,
    fontWeight: '700',
    color: Colors.rust,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    textAlign: 'center',
    marginBottom: 8,
    marginTop: 16,
  },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.ink,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 32,
    lineHeight: 30,
  },
  featureCards: {
    gap: 12,
    marginBottom: 40,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  featureIcon: {
    fontSize: 28,
    width: 36,
    textAlign: 'center',
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 2,
  },
  featureSub: {
    fontSize: 13,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Step 2
  stepTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 6,
  },
  stepSubtitle: {
    fontSize: 14,
    color: Colors.muted,
    marginBottom: 24,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  infoCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 16,
  },
  infoCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 8,
  },
  infoCardBody: {
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 19,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
    marginBottom: 10,
  },
  infoCardLink: {
    color: Colors.rust,
    fontWeight: '600',
  },
  webNote: {
    backgroundColor: Colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  webNoteText: {
    fontSize: 12,
    color: Colors.muted,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  searchInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  searchBtn: {
    backgroundColor: Colors.ink,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  searchBtnText: {
    color: '#fdf8f0',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  emptySearch: {
    color: Colors.muted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 12,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
  },
  friendName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  requestedText: {
    fontSize: 13,
    color: Colors.sage,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  addBtn: {
    backgroundColor: Colors.rust,
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Step actions
  stepActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
  },
  skipBtn: {
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  skipBtnText: {
    fontSize: 15,
    color: Colors.muted,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Primary button
  primaryBtn: {
    backgroundColor: Colors.rust,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },

  // Step 3
  searchBarWrap: {
    marginBottom: 16,
  },
  searchInputLarge: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  popularLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  popularRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
  },
  popularCover: {
    borderRadius: 6,
    overflow: 'hidden',
    shadowColor: Colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  popularCoverImg: {
    width: 70,
    height: 100,
    borderRadius: 6,
    backgroundColor: Colors.border,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
  },
  resultRowAdded: {
    borderColor: Colors.sage,
    backgroundColor: Colors.statusBg.owned,
  },
  resultCover: {
    width: 44,
    height: 62,
    borderRadius: 4,
    flexShrink: 0,
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
  addedBadge: {
    backgroundColor: Colors.statusBg.owned,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 0,
  },
  addedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.sage,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  tapHint: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.rust,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 0,
  },
  tapHintText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.rust,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});
