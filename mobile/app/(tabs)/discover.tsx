import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, ScrollView, Platform, Alert, Modal, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { FakeCover } from '../../components/FakeCover';

type ReadStatus = 'owned' | 'read' | 'reading' | 'want';

const STATUS_OPTIONS: { key: ReadStatus; label: string; color: string }[] = [
  { key: 'owned',   label: 'In Library',  color: Colors.sage },
  { key: 'read',    label: 'Read',         color: Colors.gold },
  { key: 'reading', label: 'Reading',      color: Colors.rust },
  { key: 'want',    label: 'Want',         color: '#7a5ea8' },
];

const GENRES = [
  { label: 'Fiction',      slug: 'fiction',                      emoji: '📖' },
  { label: 'Mystery',      slug: 'mystery_and_detective_stories', emoji: '🔍' },
  { label: 'Sci-Fi',       slug: 'science_fiction',               emoji: '🚀' },
  { label: 'Fantasy',      slug: 'fantasy_fiction',               emoji: '🧙' },
  { label: 'Romance',      slug: 'romance',                       emoji: '❤️' },
  { label: 'Biography',    slug: 'biography',                     emoji: '👤' },
  { label: 'Self-Help',    slug: 'self-help',                     emoji: '💡' },
  { label: 'History',      slug: 'history',                       emoji: '📜' },
  { label: 'Young Adult',  slug: 'young_adult_fiction',           emoji: '🌟' },
  { label: 'Horror',       slug: 'horror_tales',                  emoji: '👻' },
  { label: 'Classics',     slug: 'classics',                      emoji: '🎭' },
  { label: 'Business',     slug: 'business_and_economics',        emoji: '💼' },
];

const NYT_API_KEY = '2vGCkSNIV0d51GG4sERlG9pwoYG7b8ktvPLFBNmbsCWtK2oO';

const NYT_LISTS = [
  { key: 'hardcover-fiction',                    label: 'Fiction',     emoji: '📖' },
  { key: 'combined-print-and-e-book-nonfiction', label: 'Nonfiction',  emoji: '🧠' },
  { key: 'trade-fiction-paperback',              label: 'Paperback',   emoji: '📄' },
  { key: 'young-adult-hardcover',                label: 'Young Adult', emoji: '🌟' },
];

interface DiscoverBook {
  olKey: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  year: number | null;
  friendName?: string;
}

function titleKey(title?: string | null, author?: string | null) {
  return `${(title ?? '').toLowerCase().trim()}||${(author ?? '').toLowerCase().trim()}`;
}

async function fetchSubject(slug: string, limit = 15): Promise<DiscoverBook[]> {
  try {
    const r = await fetch(`https://openlibrary.org/subjects/${slug}.json?limit=${limit}`);
    const j = await r.json();
    return (j.works ?? []).map((w: any) => ({
      olKey: w.key,
      title: w.title,
      author: w.authors?.[0]?.name ?? null,
      coverUrl: w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg` : null,
      year: w.first_publish_year ?? null,
    }));
  } catch { return []; }
}

async function fetchNewReleases(limit = 24): Promise<DiscoverBook[]> {
  const year = new Date().getFullYear();
  const cutoff = year - 3;
  try {
    const r = await fetch(
      `https://openlibrary.org/search.json?q=first_publish_year:[${cutoff}+TO+${year}]&sort=rating&limit=${limit * 2}&fields=key,title,author_name,cover_i,first_publish_year`
    );
    const j = await r.json();
    const results = (j.docs ?? [])
      .filter((d: any) => d.cover_i && d.first_publish_year >= cutoff)
      .slice(0, limit)
      .map((d: any) => ({
        olKey:    d.key,
        title:    d.title,
        author:   d.author_name?.[0] ?? null,
        coverUrl: `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`,
        year:     d.first_publish_year ?? null,
      }));
    if (results.length >= 4) return results;
  } catch { /* fall through */ }
  // Fallback: weekly trending, still filtered to recent books
  try {
    const r = await fetch(`https://openlibrary.org/trending/weekly.json?limit=40`);
    const j = await r.json();
    return (j.works ?? [])
      .filter((w: any) => w.cover_id && w.first_publish_year >= cutoff)
      .slice(0, limit)
      .map((w: any) => ({
        olKey:    w.key,
        title:    w.title,
        author:   w.authors?.[0]?.name ?? null,
        coverUrl: `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg`,
        year:     w.first_publish_year ?? null,
      }));
  } catch { return []; }
}

async function searchOL(query: string, limit = 8): Promise<DiscoverBook[]> {
  try {
    const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key,title,author_name,cover_i,first_publish_year&limit=${limit}`);
    const j = await r.json();
    return (j.docs ?? []).map((d: any) => ({
      olKey: d.key,
      title: d.title,
      author: d.author_name?.[0] ?? null,
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      year: d.first_publish_year ?? null,
    }));
  } catch { return []; }
}

async function fetchNYTList(listName: string): Promise<DiscoverBook[]> {
  try {
    const r = await fetch(
      `https://api.nytimes.com/svc/books/v3/lists/current/${listName}.json?api-key=${NYT_API_KEY}`
    );
    const j = await r.json();
    const books = j.results?.books ?? [];
    return books.map((b: any) => ({
      olKey: `nyt-${listName}-${b.rank}`,
      title: b.title?.replace(/\b\w+/g, (w: string) => w[0] + w.slice(1).toLowerCase()) ?? b.title,
      author: b.author ?? null,
      coverUrl: b.book_image ?? null,
      year: null,
      rank: b.rank ?? null,
      weeksOnList: b.weeks_on_list ?? 0,
    }));
  } catch { return []; }
}

function MobileFriendStats({ stats }: { stats: any[] | null }) {
  if (stats === null) return <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 6, fontStyle: 'italic' }}>Checking friends…</Text>;
  if (!stats.length) return <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 6 }}>👥 No friends have read this yet</Text>;
  const withRating = stats.filter(s => s.user_rating);
  const avg = withRating.length
    ? (withRating.reduce((sum: number, s: any) => sum + s.user_rating, 0) / withRating.length).toFixed(1) : null;
  const names = stats.map((s: any) => s.profiles?.username).filter(Boolean);
  const display = names.length === 1 ? names[0]
    : names.length === 2 ? `${names[0]} and ${names[1]}`
    : `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 > 1 ? 's' : ''}`;
  return (
    <Text style={{ fontSize: 11, color: Colors.ink, marginTop: 6 }}>
      👥 <Text style={{ fontWeight: '700' }}>{display}</Text> {stats.length === 1 ? 'has' : 'have'} read this{avg ? <Text style={{ color: Colors.gold }}> · avg ★{avg}</Text> : null}
    </Text>
  );
}

function BookCard({ book, myKeys, onPreview }: {
  book: DiscoverBook;
  myKeys: Set<string>;
  onPreview: (book: DiscoverBook) => void;
}) {
  const have = myKeys.has(titleKey(book.title, book.author));
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.75} onPress={() => onPreview(book)}>
      <View style={styles.cardCover}>
        {book.coverUrl
          ? <Image source={{ uri: book.coverUrl }} style={styles.coverImg} resizeMode="cover" />
          : <FakeCover title={book.title} author={book.author ?? ''} width={120} height={170} />
        }
        {have && (
          <View style={styles.haveBadge}>
            <Text style={styles.haveBadgeText}>In Library</Text>
          </View>
        )}
      </View>
      <View style={styles.cardMeta}>
        <Text style={styles.cardTitle} numberOfLines={2}>{book.title}</Text>
        {book.author && <Text style={styles.cardAuthor} numberOfLines={1}>{book.author}</Text>}
        {book.friendName && <Text style={styles.cardFriend}>📚 {book.friendName}</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ---- BOOK PREVIEW MODAL ----
function BookPreviewModal({ book, myKeys, onAdd, onViewDetail, onClose }: {
  book: DiscoverBook;
  myKeys: Set<string>;
  onAdd: (book: DiscoverBook, status: ReadStatus) => Promise<void>;
  onViewDetail: () => void;
  onClose: () => void;
}) {
  const [desc,        setDesc]        = useState<string | null>(null);
  const [adding,      setAdding]      = useState(false);
  const [added,       setAdded]       = useState<ReadStatus | null>(null);
  const [friendStats, setFriendStats] = useState<any[] | null>(null);
  const have = myKeys.has(titleKey(book.title, book.author));

  useEffect(() => {
    setDesc(null);
    if (!book.olKey) return;
    const key = book.olKey.replace('/works/', '');
    fetch(`https://openlibrary.org/works/${key}.json`)
      .then(r => r.json())
      .then(j => {
        const raw = j.description;
        const text = typeof raw === 'string' ? raw : raw?.value ?? null;
        setDesc(text ? text.split('\n')[0].slice(0, 280) + (text.length > 280 ? '…' : '') : null);
      })
      .catch(() => {});
  }, [book.olKey]);

  useEffect(() => {
    setFriendStats(null);
    async function loadFriendStats() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setFriendStats([]); return; }
      const { data: bookRow } = await supabase.from('books').select('id').eq('title', book.title).limit(1);
      const bookId = (bookRow as any)?.[0]?.id;
      if (!bookId) { setFriendStats([]); return; }
      const { data: fs } = await supabase.from('friendships').select('requester_id, addressee_id')
        .eq('status', 'accepted').or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
      const ids = (fs || []).map((f: any) => f.requester_id === user.id ? f.addressee_id : f.requester_id);
      if (!ids.length) { setFriendStats([]); return; }
      const { data } = await supabase.from('collection_entries')
        .select('user_rating, profiles(username)').eq('book_id', bookId).in('user_id', ids);
      setFriendStats((data as any[]) || []);
    }
    loadFriendStats();
  }, [book.title]);

  async function handleAdd(status: ReadStatus) {
    if (adding || added || have) return;
    setAdding(true);
    try { await onAdd(book, status); setAdded(status); }
    catch { Alert.alert('Error', 'Could not add book.'); }
    finally { setAdding(false); }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalBox} onPress={() => {}}>
          {/* Header row */}
          <View style={styles.modalTop}>
            <View style={styles.modalCover}>
              {book.coverUrl
                ? <Image source={{ uri: book.coverUrl }} style={{ width: '100%', height: '100%', borderRadius: 8 }} resizeMode="cover" />
                : <FakeCover title={book.title} author={book.author ?? ''} width={90} height={135} />}
            </View>
            <View style={styles.modalInfo}>
              <Text style={styles.modalTitle}>{book.title}</Text>
              {book.author && <Text style={styles.modalAuthor}>by {book.author}</Text>}
              {book.year   && <Text style={styles.modalYear}>{book.year}</Text>}
              {desc && <Text style={styles.modalDesc} numberOfLines={5}>{desc}</Text>}
              <MobileFriendStats stats={friendStats} />
            </View>
          </View>

          {/* Add buttons */}
          {!have && !added ? (
            <View style={styles.modalAddSection}>
              <Text style={styles.modalAddLabel}>Add to library:</Text>
              <View style={styles.modalAddRow}>
                {adding
                  ? <ActivityIndicator color={Colors.rust} />
                  : STATUS_OPTIONS.map(opt => (
                      <TouchableOpacity key={opt.key} style={[styles.addBtn, { borderColor: opt.color }]} onPress={() => handleAdd(opt.key)}>
                        <Text style={[styles.addBtnText, { color: opt.color }]}>{opt.label}</Text>
                      </TouchableOpacity>
                    ))
                }
              </View>
            </View>
          ) : (
            <Text style={styles.modalInLib}>✓ {have ? 'In your library' : `Added as "${STATUS_OPTIONS.find(s => s.key === added)?.label}"`}</Text>
          )}

          {/* View full details */}
          <TouchableOpacity style={styles.modalDetailBtn} onPress={onViewDetail}>
            <Text style={styles.modalDetailBtnText}>View Full Details →</Text>
          </TouchableOpacity>

          {/* Close */}
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function HorizontalSection({ title, subtitle, books, myKeys, onPreview, loading }: {
  title: string; subtitle?: string;
  books: DiscoverBook[]; myKeys: Set<string>;
  onPreview: (b: DiscoverBook) => void;
  loading: boolean;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      {loading ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {[...Array(4)].map((_, i) => <View key={i} style={styles.skeleton} />)}
        </ScrollView>
      ) : books.length === 0 ? (
        <Text style={styles.emptyText}>Nothing found yet.</Text>
      ) : (
        <FlatList
          horizontal
          data={books}
          keyExtractor={(b, i) => b.olKey ?? String(i)}
          renderItem={({ item }) => <BookCard book={item} myKeys={myKeys} onPreview={onPreview} />}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        />
      )}
    </View>
  );
}

interface AIRec extends DiscoverBook { _aiReason?: string }

function AIPickCard({ book, myKeys, onPreview }: { book: AIRec; myKeys: Set<string>; onPreview: (b: DiscoverBook) => void }) {
  const have = myKeys.has(titleKey(book.title, book.author));
  const colors = ['#5a3e7a','#1e5f74','#7a3b3b','#3a6b4a','#6b4a1e','#3a4a6b'];
  const c  = colors[Math.abs((book.title || '').charCodeAt(0)) % colors.length];
  const c2 = colors[(Math.abs((book.title || '').charCodeAt(0)) + 3) % colors.length];
  return (
    <TouchableOpacity style={styles.aiCard} activeOpacity={0.75} onPress={() => onPreview(book)}>
      <View style={[styles.aiCardCover, { backgroundColor: c }]}>
        {book.coverUrl
          ? <Image source={{ uri: book.coverUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" onError={() => {}} />
          : <FakeCover title={book.title} author={book.author ?? ''} width={110} height={160} />
        }
        {have && (
          <View style={styles.haveBadge}><Text style={styles.haveBadgeText}>In Library</Text></View>
        )}
      </View>
      <View style={styles.aiCardMeta}>
        <Text style={styles.cardTitle} numberOfLines={2}>{book.title}</Text>
        {book.author && <Text style={styles.cardAuthor} numberOfLines={1}>{book.author}</Text>}
        {book._aiReason && (
          <View style={styles.aiReasonPill}>
            <Text style={styles.aiReasonText}>{book._aiReason}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const [myKeys,        setMyKeys]        = useState(new Set<string>());
  const [forYou,        setForYou]        = useState<DiscoverBook[]>([]);
  const [forYouTitle,   setForYouTitle]   = useState('Recommended for You');
  const [forYouLoad,    setForYouLoad]    = useState(true);
  const [newReleases,   setNewReleases]   = useState<DiscoverBook[]>([]);
  const [newRelLoad,    setNewRelLoad]    = useState(true);
  const [friends,       setFriends]       = useState<DiscoverBook[]>([]);
  const [friendsLoad,   setFriendsLoad]   = useState(true);
  const [hasFriends,    setHasFriends]    = useState(true);
  const [activeGenre,   setActiveGenre]   = useState<typeof GENRES[0] | null>(null);
  const [genreBooks,    setGenreBooks]    = useState<DiscoverBook[]>([]);
  const [genreLoad,     setGenreLoad]     = useState(false);
  const [previewBook,   setPreviewBook]   = useState<DiscoverBook | null>(null);
  const [aiRecs,        setAiRecs]        = useState<AIRec[]>([]);
  const [aiRecsLoad,    setAiRecsLoad]    = useState(true);
  const [nytList,       setNytList]       = useState(NYT_LISTS[0].key);
  const [nytBooks,      setNytBooks]      = useState<DiscoverBook[]>([]);
  const [nytLoad,       setNytLoad]       = useState(true);
  const nytCacheRef = useRef<Record<string, DiscoverBook[]>>({});

  useEffect(() => { init(); }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadNYT() {
      if (nytCacheRef.current[nytList]) {
        setNytBooks(nytCacheRef.current[nytList]);
        return;
      }
      setNytLoad(true);
      const books = await fetchNYTList(nytList);
      if (cancelled) return;
      nytCacheRef.current[nytList] = books;
      setNytBooks(books);
      setNytLoad(false);
    }
    loadNYT();
    return () => { cancelled = true; };
  }, [nytList]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: entries } = await supabase
      .from('collection_entries')
      .select('read_status, user_rating, books(title, author)')
      .eq('user_id', user.id);

    const books = (entries ?? []).map((e: any) => e.books).filter(Boolean);
    const keys  = new Set(books.map((b: any) => titleKey(b.title, b.author)));
    setMyKeys(keys);

    buildForYou(entries ?? [], books, keys, user.id);
    buildFriends(user.id, keys);
    buildNewReleases(keys);
    buildAIRecs(entries ?? [], keys);
  }

  async function buildForYou(entries: any[], books: any[], ownedKeys: Set<string>, userId: string) {
    setForYouLoad(true);
    try {
      const loved = entries.filter((e: any) => e.user_rating >= 4 || ['read','owned'].includes(e.read_status));
      const authorCount: Record<string, number> = {};
      loved.forEach((e: any) => {
        const a = e.books?.author;
        if (a) authorCount[a] = (authorCount[a] ?? 0) + 1;
      });
      const topAuthors = Object.entries(authorCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);

      if (topAuthors.length) {
        setForYouTitle(topAuthors.length === 1 ? `More by ${topAuthors[0]}` : `Because you read ${topAuthors[0]} & others`);
        const results = await Promise.all(topAuthors.map(a => searchOL(`author:"${a}"`, 8)));
        const seen = new Set<string>();
        const filtered = results.flat().filter(b => {
          const k = titleKey(b.title, b.author);
          if (seen.has(k) || ownedKeys.has(k)) return false;
          seen.add(k); return true;
        }).slice(0, 20);
        if (filtered.length) { setForYou(filtered); setForYouLoad(false); return; }
      }

      setForYouTitle('Popular picks you might enjoy');
      const fallback = await fetchSubject('fiction', 20);
      setForYou(fallback.filter(b => !ownedKeys.has(titleKey(b.title, b.author))));
    } catch { setForYou([]); }
    finally { setForYouLoad(false); }
  }

  async function buildNewReleases(ownedKeys: Set<string>) {
    setNewRelLoad(true);
    try {
      const books = await fetchNewReleases(24);
      setNewReleases(books.filter(b => !ownedKeys.has(titleKey(b.title, b.author))));
    } catch { setNewReleases([]); }
    finally { setNewRelLoad(false); }
  }

  async function buildFriends(userId: string, ownedKeys: Set<string>) {
    setFriendsLoad(true);
    try {
      const { data: fs } = await supabase.from('friendships').select('requester_id,addressee_id')
        .eq('status', 'accepted').or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
      const ids = (fs ?? []).map((f: any) => f.requester_id === userId ? f.addressee_id : f.requester_id);
      if (!ids.length) { setHasFriends(false); setFriendsLoad(false); return; }

      const { data: entries } = await supabase.from('collection_entries')
        .select('books(title,author,cover_image_url,published_year), profiles(username)')
        .in('user_id', ids).order('updated_at', { ascending: false }).limit(40);

      const seen = new Set<string>();
      const unique: DiscoverBook[] = (entries ?? []).filter((e: any) => {
        const k = titleKey(e.books?.title, e.books?.author);
        if (seen.has(k)) return false; seen.add(k); return true;
      }).slice(0, 16).map((e: any) => ({
        olKey: titleKey(e.books?.title, e.books?.author),
        title: e.books?.title, author: e.books?.author,
        coverUrl: e.books?.cover_image_url, year: e.books?.published_year,
        friendName: e.profiles?.username,
      }));
      setFriends(unique);
    } catch { setFriends([]); }
    finally { setFriendsLoad(false); }
  }

  async function buildAIRecs(entries: any[], ownedKeys: Set<string>) {
    setAiRecsLoad(true);
    try {
      const books = entries.map((e: any) => ({
        title:       e.books?.title   ?? '',
        author:      e.books?.author  ?? null,
        genre:       e.books?.genre   ?? null,
        user_rating: e.user_rating    ?? null,
        read_status: e.read_status    ?? 'owned',
      })).filter((b: any) => b.title);

      if (books.length < 3) { setAiRecsLoad(false); return; }

      const { data, error } = await supabase.functions.invoke('ai-book-recommendations', { body: { books } });
      if (error || !data?.recommendations?.length) { setAiRecsLoad(false); return; }

      const enriched: AIRec[] = await Promise.all(
        (data.recommendations as { title: string; author: string; reason: string }[]).map(async (rec) => {
          try {
            const q = encodeURIComponent(`${rec.title} ${rec.author ?? ''}`);
            const r = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=3&fields=key,title,author_name,cover_i,first_publish_year`);
            const j = await r.json();
            const match = (j.docs ?? []).find((d: any) => d.cover_i) ?? j.docs?.[0];
            return {
              olKey:      match?.key ?? titleKey(rec.title, rec.author),
              title:      rec.title,
              author:     rec.author,
              coverUrl:   match?.cover_i ? `https://covers.openlibrary.org/b/id/${match.cover_i}-M.jpg` : null,
              year:       match?.first_publish_year ?? null,
              _aiReason:  rec.reason,
            };
          } catch {
            return { olKey: titleKey(rec.title, rec.author), title: rec.title, author: rec.author, coverUrl: null, year: null, _aiReason: rec.reason };
          }
        })
      );

      setAiRecs(enriched.filter(b => !ownedKeys.has(titleKey(b.title, b.author))));
    } catch {
      // silently fail — not critical
    } finally {
      setAiRecsLoad(false);
    }
  }

  async function handleGenre(genre: typeof GENRES[0]) {
    if (activeGenre?.slug === genre.slug) { setActiveGenre(null); setGenreBooks([]); return; }
    setActiveGenre(genre); setGenreLoad(true); setGenreBooks([]);
    const books = await fetchSubject(genre.slug, 20);
    setGenreBooks(books); setGenreLoad(false);
  }

  async function handleViewDetail(book: DiscoverBook) {
    const payload = { title: book.title, author: book.author, cover_image_url: book.coverUrl, published_year: book.year ?? null };
    const { data: existing } = await supabase.from('books').select('id').eq('title', book.title).limit(1);
    if (existing?.length) { setPreviewBook(null); router.push(`/book/${existing[0].id}`); return; }
    const { data: nb, error } = await supabase.from('books').insert(payload).select('id').single();
    if (nb?.id) { setPreviewBook(null); router.push(`/book/${nb.id}`); return; }
    if (error) {
      const { data: retry } = await supabase.from('books').select('id').eq('title', book.title).limit(1);
      if (retry?.length) { setPreviewBook(null); router.push(`/book/${retry[0].id}`); }
    }
  }

  async function handleAdd(book: DiscoverBook, status: ReadStatus) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = { title: book.title, author: book.author, cover_image_url: book.coverUrl, published_year: book.year ?? null };
    let bookId: string;
    const { data: existing } = await supabase.from('books').select('id').eq('title', book.title).limit(1);
    if (existing?.length) {
      bookId = existing[0].id;
    } else {
      const { data: nb, error } = await supabase.from('books').insert(payload).select('id').single();
      if (error || !nb) throw error;
      bookId = nb.id;
    }
    await supabase.from('collection_entries').upsert({ user_id: user.id, book_id: bookId, read_status: status }, { onConflict: 'user_id,book_id' });
    setMyKeys(prev => new Set([...prev, titleKey(book.title, book.author)]));
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      {/* AI Picks */}
      <View style={styles.section}>
        <View style={styles.aiSectionHead}>
          <Text style={styles.sectionTitle}>✨ AI Picks For You</Text>
          <View style={styles.claudePill}><Text style={styles.claudePillText}>Claude AI</Text></View>
        </View>
        <Text style={styles.sectionSub}>Personalized suggestions based on your reading taste</Text>
        {aiRecsLoad ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {[...Array(4)].map((_, i) => <View key={i} style={styles.skeleton} />)}
          </ScrollView>
        ) : aiRecs.length > 0 ? (
          <FlatList
            horizontal
            data={aiRecs}
            keyExtractor={(b, i) => b.olKey ?? String(i)}
            renderItem={({ item }) => <AIPickCard book={item} myKeys={myKeys} onPreview={setPreviewBook} />}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          />
        ) : (
          <Text style={styles.emptyText}>Add at least 3 books to unlock AI picks!</Text>
        )}
      </View>

      {/* NYT Best Sellers */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>NYT Best Sellers</Text>
        <Text style={styles.nytAttribution}>From The New York Times</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nytTabRow}>
          {NYT_LISTS.map(l => (
            <TouchableOpacity
              key={l.key}
              style={[styles.nytTab, nytList === l.key && styles.nytTabActive]}
              onPress={() => setNytList(l.key)}
            >
              <Text style={[styles.nytTabText, nytList === l.key && styles.nytTabTextActive]}>
                {l.emoji} {l.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {nytLoad ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {[...Array(4)].map((_, i) => <View key={i} style={styles.skeleton} />)}
          </ScrollView>
        ) : nytBooks.length === 0 ? (
          <Text style={styles.emptyText}>No best sellers found.</Text>
        ) : (
          <FlatList
            horizontal
            data={nytBooks}
            keyExtractor={(b, i) => b.olKey ?? String(i)}
            renderItem={({ item }) => <BookCard book={item} myKeys={myKeys} onPreview={setPreviewBook} />}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          />
        )}
      </View>

      {/* For You */}
      <HorizontalSection
        title={forYouTitle}
        subtitle="Tailored to your reading history"
        books={forYou} myKeys={myKeys} onPreview={setPreviewBook} loading={forYouLoad}
      />

      {/* New Releases */}
      <HorizontalSection
        title="✨ New Releases"
        subtitle="Fresh titles published this year"
        books={newReleases} myKeys={myKeys} onPreview={setPreviewBook} loading={newRelLoad}
      />

      {/* Friends Reading */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Friends Are Reading</Text>
        <Text style={styles.sectionSub}>See what your friends have been picking up</Text>
        {!hasFriends
          ? <Text style={styles.emptyText}>Add friends to see what they're reading</Text>
          : friendsLoad
            ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {[...Array(4)].map((_, i) => <View key={i} style={styles.skeleton} />)}
              </ScrollView>
            : friends.length === 0
              ? <Text style={styles.emptyText}>Your friends haven't added any books yet.</Text>
              : <FlatList horizontal data={friends} keyExtractor={(b, i) => b.olKey ?? String(i)}
                  renderItem={({ item }) => <BookCard book={item} myKeys={myKeys} onPreview={setPreviewBook} />}
                  showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} />
        }
      </View>

      {/* Genre Browser */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Browse by Genre</Text>
        <Text style={styles.sectionSub}>Tap a genre to explore</Text>
        <View style={styles.genreGrid}>
          {GENRES.map(g => (
            <TouchableOpacity
              key={g.slug}
              style={[styles.genreChip, activeGenre?.slug === g.slug && styles.genreChipActive]}
              onPress={() => handleGenre(g)}
            >
              <Text style={styles.genreEmoji}>{g.emoji}</Text>
              <Text style={[styles.genreLabel, activeGenre?.slug === g.slug && styles.genreLabelActive]}>{g.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeGenre && (
          <View style={styles.genrePanel}>
            <Text style={styles.genrePanelTitle}>{activeGenre.emoji} {activeGenre.label}</Text>
            {genreLoad
              ? <ActivityIndicator color={Colors.rust} style={{ marginVertical: 16 }} />
              : <FlatList horizontal data={genreBooks} keyExtractor={(b, i) => b.olKey ?? String(i)}
                  renderItem={({ item }) => <BookCard book={item} myKeys={myKeys} onPreview={setPreviewBook} />}
                  showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} />
            }
          </View>
        )}
      </View>

      {/* Book Preview Modal */}
      {previewBook && (
        <BookPreviewModal
          book={previewBook}
          myKeys={myKeys}
          onAdd={handleAdd}
          onViewDetail={() => handleViewDetail(previewBook)}
          onClose={() => setPreviewBook(null)}
        />
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingVertical: 16, paddingBottom: 40 },

  section:     { marginBottom: 28 },
  sectionTitle:{ fontSize: 18, fontWeight: '700', color: Colors.ink, marginBottom: 2, paddingHorizontal: 16, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  sectionSub:  { fontSize: 12, color: Colors.muted, marginBottom: 12, paddingHorizontal: 16, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  emptyText:   { fontSize: 13, color: Colors.muted, paddingHorizontal: 16, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  row:      { paddingHorizontal: 16, gap: 12 },
  skeleton: { width: 100, height: 220, borderRadius: 8, backgroundColor: '#e8e0d4', flexShrink: 0 },

  card:      { width: 120, flexShrink: 0, backgroundColor: Colors.card, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  cardCover: { width: 120, height: 170, backgroundColor: Colors.border, position: 'relative' },
  coverImg:  { width: '100%', height: '100%' },
  haveBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(90,122,90,0.9)', paddingVertical: 3 },
  haveBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700', textAlign: 'center', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  cardMeta:  { padding: 8, gap: 2 },
  cardTitle: { fontSize: 11, fontWeight: '700', color: Colors.ink, lineHeight: 14, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  cardAuthor:{ fontSize: 10, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  cardFriend:{ fontSize: 10, color: Colors.rust, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  cardActions:{ paddingHorizontal: 6, paddingBottom: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  addBtn:    { paddingHorizontal: 5, paddingVertical: 3, borderRadius: 4, borderWidth: 1, backgroundColor: Colors.background },
  addBtnText:{ fontSize: 9, fontWeight: '600', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  // AI Picks
  aiSectionHead:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 2 },
  claudePill:     { backgroundColor: 'rgba(123,94,168,0.12)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  claudePillText: { fontSize: 10, fontWeight: '600', color: '#7b5ea8', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  aiCard:         { width: 130, flexShrink: 0, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  aiCardCover:    { width: 130, height: 175, position: 'relative', overflow: 'hidden' },
  aiCardMeta:     { padding: 8, gap: 3 },
  aiReasonPill:   { backgroundColor: 'rgba(123,94,168,0.10)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 2 },
  aiReasonText:   { fontSize: 9, color: '#7b5ea8', fontWeight: '600', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  // NYT Best Sellers
  nytTabRow:       { paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  nytTab:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border },
  nytTabActive:    { backgroundColor: Colors.rust, borderColor: Colors.rust },
  nytTabText:      { fontSize: 12, fontWeight: '600', color: Colors.ink, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  nytTabTextActive:{ color: '#fff' },
  nytAttribution:  { fontSize: 11, color: Colors.muted, marginBottom: 10, paddingHorizontal: 16, fontStyle: 'italic', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  genreGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 16 },
  genreChip:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border },
  genreChipActive:{ backgroundColor: Colors.rust, borderColor: Colors.rust },
  genreEmoji:    { fontSize: 14 },
  genreLabel:    { fontSize: 12, fontWeight: '600', color: Colors.ink, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  genreLabelActive:{ color: '#fff' },
  genrePanel:    { marginHorizontal: 16, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingTop: 14, paddingBottom: 4, overflow: 'hidden' },
  genrePanelTitle:{ fontSize: 15, fontWeight: '700', color: Colors.ink, paddingHorizontal: 14, marginBottom: 10, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },

  // Modal
  modalBackdrop:   { flex: 1, backgroundColor: 'rgba(26,18,8,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalBox:        { backgroundColor: Colors.card, borderRadius: 18, padding: 20, width: '100%', maxHeight: '85%', position: 'relative' },
  modalTop:        { flexDirection: 'row', gap: 14, marginBottom: 16 },
  modalCover:      { width: 90, height: 135, borderRadius: 8, overflow: 'hidden', flexShrink: 0 },
  modalInfo:       { flex: 1, minWidth: 0 },
  modalTitle:      { fontSize: 17, fontWeight: '700', color: Colors.ink, marginBottom: 4, lineHeight: 22, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  modalAuthor:     { fontSize: 13, color: Colors.sage, fontWeight: '500', marginBottom: 2, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  modalYear:       { fontSize: 12, color: Colors.muted, marginBottom: 8, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  modalDesc:       { fontSize: 12, color: Colors.ink, lineHeight: 17, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  modalAddSection: { marginBottom: 12 },
  modalAddLabel:   { fontSize: 12, color: Colors.muted, marginBottom: 6, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  modalAddRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modalInLib:      { fontSize: 13, color: Colors.sage, fontWeight: '600', marginBottom: 12, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  modalDetailBtn:  { backgroundColor: Colors.rust, borderRadius: 10, padding: 12, alignItems: 'center' },
  modalDetailBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  modalClose:      { position: 'absolute', top: 12, right: 14, padding: 6 },
  modalCloseText:  { fontSize: 16, color: Colors.muted },
});
