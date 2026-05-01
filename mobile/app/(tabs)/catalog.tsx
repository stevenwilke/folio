import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Image,
  RefreshControl,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { FakeCover } from '../../components/FakeCover';

// ── Card catalog ─────────────────────────────────────────────────────────
type CardId =
  | 'continue-reading' | 'goal' | 'stats' | 'nightstand' | 'quote'
  | 'dispatches' | 'this-week' | 'rediscover' | 'recently-added' | 'top-genres'
  | 'book-values' | 'library-count' | 'random-book' | 'want-to-read'
  | 'marketplace' | 'loans' | 'badges' | 'clubs' | 'my-shelves';

interface CardDef {
  id: CardId;
  label: string;
  defaultHidden?: boolean;
}

const CARDS: CardDef[] = [
  { id: 'continue-reading', label: 'Continue Reading' },
  { id: 'goal',             label: 'Reading Goal' },
  { id: 'stats',            label: 'Stats' },
  { id: 'nightstand',       label: 'On your Nightstand' },
  { id: 'quote',            label: 'Quote of the Day' },
  { id: 'dispatches',       label: 'Dispatches (Friends)' },
  { id: 'this-week',        label: 'This Week' },
  { id: 'rediscover',       label: 'Rediscover' },
  { id: 'recently-added',   label: 'Recently Added',  defaultHidden: true },
  { id: 'top-genres',       label: 'Top Genres',      defaultHidden: true },
  { id: 'book-values',      label: 'Book Values',     defaultHidden: true },
  { id: 'library-count',    label: 'Books in Library',defaultHidden: true },
  { id: 'random-book',      label: 'Random Book of the Day', defaultHidden: true },
  { id: 'want-to-read',     label: 'Want to Read',    defaultHidden: true },
  { id: 'marketplace',      label: 'Marketplace',     defaultHidden: true },
  { id: 'loans',            label: 'Loans',           defaultHidden: true },
  { id: 'badges',           label: 'Badges',          defaultHidden: true },
  { id: 'clubs',            label: 'Book Clubs',      defaultHidden: true },
  { id: 'my-shelves',       label: 'My Shelves',      defaultHidden: true },
];

const CARD_BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c])) as Record<CardId, CardDef>;
const DEFAULT_ORDER  = CARDS.filter(c => !c.defaultHidden).map(c => c.id);
const DEFAULT_HIDDEN = CARDS.filter(c =>  c.defaultHidden).map(c => c.id);
const STORAGE_KEY = 'exlibris-catalog-layout-v1';

interface Layout {
  order: CardId[];
  hidden: CardId[];
}

async function loadLayout(): Promise<Layout> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN };
    const parsed = JSON.parse(raw);
    const known = new Set<CardId>(CARDS.map(c => c.id));
    const order  = (parsed.order  || []).filter((id: CardId) => known.has(id));
    const hidden = (parsed.hidden || []).filter((id: CardId) => known.has(id));
    for (const c of CARDS) {
      if (!order.includes(c.id) && !hidden.includes(c.id)) {
        if (c.defaultHidden) hidden.push(c.id);
        else order.push(c.id);
      }
    }
    return { order, hidden };
  } catch {
    return { order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN };
  }
}
async function saveLayout(layout: Layout) {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch {}
}

// ── Data ─────────────────────────────────────────────────────────────────
interface BookRef { id: string; title: string; author: string | null; cover_image_url: string | null; pages?: number | null; genre?: string | null; }
interface Entry { id: string; read_status: string; current_page: number | null; added_at: string; has_read: boolean; books: BookRef | null; }
interface Profile { username: string | null; avatar_url: string | null; level: number | null; level_points: number | null; }
interface FriendProfile { id: string; username: string | null; avatar_url: string | null; }
interface Dispatch { kind: 'post' | 'add'; id: string; date: string; profile: FriendProfile | null; book: BookRef | null; status: string; content?: string | null; }
interface AgendaItem { when: Date; label: string; title: string; meta: string; link?: string; }
interface Loan { id: string; status: string; due_date: string | null; requester_id: string; owner_id: string; books: BookRef | null; }
interface Listing { id: string; price: number | null; condition: string | null; books: BookRef | null; }
interface Club { id: string; name: string; description: string | null; books: BookRef | null; _myRole: string; _memberCount?: number; }
interface Shelf { id: string; name: string; color: string | null; _bookCount: number; }

interface CatalogData {
  profile: Profile | null;
  entries: Entry[];
  reading: Entry[];
  want: Entry[];
  readEntries: Entry[];
  pagesThisWeek: number;
  streak: number;
  booksReadYear: number;
  counts: { total: number; reading: number; want: number; read: number };
  topGenres: [string, number][];
  goal: { target: number; current: number } | null;
  dispatches: Dispatch[];
  hasFriends: boolean;
  dailyQuote: { id: string; quote_text: string; books: BookRef } | null;
  rediscover: Entry | null;
  agenda: AgendaItem[];
  recentlyAdded: Entry[];
  bookValues: { retailTotal: number; retailCount: number; marketTotal: number; marketCount: number };
  myListings: Listing[];
  loans: { borrowing: Loan[]; lending: Loan[] };
  earnedBadgeCount: number;
  clubs: Club[];
  shelves: Shelf[];
  randomBook: BookRef | null;
}

// ── Utils ────────────────────────────────────────────────────────────────
function computeStreak(dates: string[]): number {
  if (!dates.length) return 0;
  const set = new Set(dates);
  let streak = 0;
  const cur = new Date();
  cur.setHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const key = cur.toISOString().slice(0, 10);
    if (set.has(key)) streak++;
    else if (i > 0) break;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

function dayLabel(date: Date): string {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(date); d.setHours(0,0,0,0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 0 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function greetingForHour(hour: number, name?: string | null): string {
  const display = name ? `, ${name}` : '';
  if (hour < 5)  return `Reading late${display}?`;
  if (hour < 12) return `Good morning${display}`;
  if (hour < 17) return `Good afternoon${display}`;
  if (hour < 21) return `Good evening${display}`;
  return `Good night${display}`;
}

// ── Screen ───────────────────────────────────────────────────────────────
export default function CatalogScreen() {
  const router = useRouter();
  const [layout, setLayout] = useState<Layout>({ order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN });
  const [editMode, setEditMode] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [data, setData] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { loadLayout().then(setLayout); }, []);

  function persist(next: Layout) {
    setLayout(next);
    saveLayout(next);
  }

  const fetchAll = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const userId = user.id;

    const { data: friendships } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
    const friendIds = (friendships || [])
      .map(f => f.requester_id === userId ? f.addressee_id : f.requester_id);

    const year = new Date().getFullYear();
    const [
      profileRes, collectionRes, sessionsRes, challengeRes,
      friendsPostsRes, friendsActivityRes, friendProfilesRes,
      quotesRes, borrowsRes, buddyReadsRes,
      myListingsRes, clubsRes, shelvesRes,
    ] = await Promise.all([
      supabase.from('profiles').select('username, avatar_url, level, level_points').eq('id', userId).maybeSingle(),
      supabase.from('collection_entries')
        .select('id, read_status, current_page, added_at, has_read, books(id, title, author, cover_image_url, pages, genre)')
        .eq('user_id', userId)
        .order('added_at', { ascending: false })
        .limit(2000),
      supabase.from('reading_sessions')
        .select('pages_read, started_at, ended_at')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .not('pages_read', 'is', null),
      supabase.from('reading_challenges')
        .select('*')
        .eq('user_id', userId)
        .eq('year', year)
        .is('month', null)
        .eq('challenge_type', 'books_count')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      friendIds.length
        ? supabase.from('reading_posts')
            .select('id, user_id, content, post_type, created_at, books(id, title, author, cover_image_url), profiles!reading_posts_user_id_fkey(username, avatar_url)')
            .in('user_id', friendIds)
            .order('created_at', { ascending: false }).limit(8)
        : Promise.resolve({ data: [] as any[] }),
      friendIds.length
        ? supabase.from('collection_entries')
            .select('id, user_id, read_status, added_at, books(id, title, author, cover_image_url)')
            .in('user_id', friendIds)
            .order('added_at', { ascending: false }).limit(8)
        : Promise.resolve({ data: [] as any[] }),
      friendIds.length
        ? supabase.from('profiles').select('id, username, avatar_url').in('id', friendIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('book_quotes')
        .select('id, quote_text, books(id, title, author, cover_image_url)')
        .eq('user_id', userId).limit(80),
      supabase.from('borrow_requests')
        .select('id, status, due_date, requester_id, owner_id, books(id, title, author, cover_image_url)')
        .or(`requester_id.eq.${userId},owner_id.eq.${userId}`)
        .eq('status', 'active'),
      supabase.from('buddy_read_participants')
        .select('buddy_reads(id, title, target_finish, status, books(id, title, author, cover_image_url))')
        .eq('user_id', userId),
      supabase.from('listings')
        .select('id, price, condition, created_at, books(id, title, author, cover_image_url)')
        .eq('seller_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('book_club_members')
        .select('role, book_clubs(id, name, description, current_book_id, books:current_book_id(id, title, author, cover_image_url), book_club_members(count))')
        .eq('user_id', userId)
        .limit(20),
      supabase.from('shelves')
        .select('id, name, color, shelf_books(count)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const entriesData: Entry[] = (collectionRes.data as any) || [];
    const ownedBookIds = entriesData.filter(e => e.read_status !== 'want' && e.books?.id).map(e => e.books!.id);
    const valuationRes = ownedBookIds.length
      ? await supabase.from('valuations').select('book_id, list_price, avg_price').in('book_id', ownedBookIds)
      : { data: [] as { book_id: string; list_price: number | null; avg_price: number | null }[] };
    const valuationRows = valuationRes.data || [];

    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
    const weekAhead = new Date(); weekAhead.setDate(weekAhead.getDate() + 7);

    const profile = (profileRes.data as any) as Profile | null;
    const entries = entriesData;
    const sessions = (sessionsRes.data as any[]) || [];
    const reading = entries.filter(e => e.read_status === 'reading');
    const want = entries.filter(e => e.read_status === 'want')
      .sort((a, b) => new Date(a.added_at).getTime() - new Date(b.added_at).getTime());
    const readEntries = entries.filter(e => e.read_status === 'read' || e.has_read);

    const pagesThisWeek = sessions
      .filter(s => s.ended_at && new Date(s.ended_at) >= weekStart)
      .reduce((sum, x) => sum + (x.pages_read || 0), 0);
    const dates = sessions.map(s => s.ended_at?.slice(0, 10)).filter(Boolean) as string[];
    const streak = computeStreak(dates);
    const booksReadYear = readEntries.filter(e => new Date(e.added_at) >= yearStart).length;
    const counts = {
      total: entries.length,
      reading: reading.length,
      want: want.length,
      read: readEntries.length,
    };
    const genreCounts: Record<string, number> = {};
    for (const e of readEntries) {
      const g = e.books?.genre;
      if (g) genreCounts[g] = (genreCounts[g] || 0) + 1;
    }
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 8) as [string, number][];

    const challenge = challengeRes.data as any;
    const goal = challenge ? { target: challenge.target_value, current: booksReadYear } : null;

    const profileMap: Record<string, FriendProfile> = Object.fromEntries(
      ((friendProfilesRes.data as any[]) || []).map((p: any) => [p.id, p])
    );
    const fpost: Dispatch[] = ((friendsPostsRes.data as any[]) || []).map((p: any) => ({
      kind: 'post', id: `p-${p.id}`, date: p.created_at,
      profile: p.profiles || profileMap[p.user_id], book: p.books,
      status: p.post_type === 'quote' ? 'quote' : 'post',
      content: p.content,
    }));
    const fact: Dispatch[] = ((friendsActivityRes.data as any[]) || []).map((a: any) => ({
      kind: 'add', id: `a-${a.id}`, date: a.added_at,
      profile: profileMap[a.user_id], status: a.read_status, book: a.books,
    }));
    const dispatches = [...fpost, ...fact]
      .filter(x => x.book)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 12);

    const quotes = ((quotesRes.data as any[]) || []).filter((q: any) => q.books);
    const dayKey = now.toISOString().slice(0, 10);
    const daySeed = dayKey.split('-').reduce((a, b) => a + parseInt(b), 0);
    const dailyQuote = quotes.length ? quotes[daySeed % quotes.length] : null;

    const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oldReads = readEntries.filter(e => new Date(e.added_at) < oneYearAgo && e.books);
    const pool = oldReads.length ? oldReads : readEntries.filter(e => e.books);
    const rediscover = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;

    const agenda: AgendaItem[] = [];
    for (const b of ((borrowsRes.data as any[]) || []) as Loan[]) {
      if (!b.due_date) continue;
      const due = new Date(b.due_date);
      if (due >= now && due <= weekAhead) {
        agenda.push({
          when: due, label: dayLabel(due),
          title: `Return ${b.books?.title || 'a book'}`,
          meta: 'loan due', link: '/loans',
        });
      }
    }
    for (const p of ((buddyReadsRes.data as any[]) || [])) {
      const br = p.buddy_reads;
      if (!br || br.status !== 'active' || !br.target_finish) continue;
      const tf = new Date(br.target_finish);
      if (tf >= now && tf <= weekAhead) {
        agenda.push({
          when: tf, label: dayLabel(tf),
          title: `Buddy read · ${br.books?.title || br.title}`,
          meta: 'target finish',
        });
      }
    }
    agenda.sort((a, b) => a.when.getTime() - b.when.getTime());

    const USED_FACTOR = 0.35;
    const bookValues = { retailTotal: 0, retailCount: 0, marketTotal: 0, marketCount: 0 };
    for (const v of valuationRows) {
      if (v.list_price != null) { bookValues.retailTotal += Number(v.list_price); bookValues.retailCount++; }
      if (v.avg_price   != null) { bookValues.marketTotal += Number(v.avg_price);   bookValues.marketCount++; }
      else if (v.list_price != null) { bookValues.marketTotal += Number(v.list_price) * USED_FACTOR; }
    }

    const allBorrows = ((borrowsRes.data as any[]) || []) as Loan[];
    const loans = {
      borrowing: allBorrows.filter(b => b.requester_id === userId),
      lending:   allBorrows.filter(b => b.owner_id === userId),
    };

    const clubs: Club[] = ((clubsRes.data as any[]) || [])
      .map((m: any) => ({
        ...m.book_clubs,
        _myRole: m.role,
        _memberCount: m.book_clubs?.book_club_members?.[0]?.count ?? 0,
      }))
      .filter((c: any) => c?.id);

    const shelves: Shelf[] = ((shelvesRes.data as any[]) || []).map((s: any) => ({
      ...s, _bookCount: s.shelf_books?.[0]?.count ?? 0,
    }));

    const allBooks = entries.filter(e => e.books).map(e => e.books!);
    const randomBook = allBooks.length ? allBooks[daySeed % allBooks.length] : null;

    setData({
      profile, entries, reading, want, readEntries,
      pagesThisWeek, streak, booksReadYear, counts, topGenres,
      goal, dispatches, hasFriends: friendIds.length > 0,
      dailyQuote, rediscover, agenda,
      recentlyAdded: entries.slice(0, 12),
      bookValues, myListings: ((myListingsRes.data as any[]) || []) as Listing[],
      loans,
      earnedBadgeCount: profile?.level_points ? Math.floor(profile.level_points / 50) : 0,
      clubs, shelves, randomBook,
    });
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAll();
  }, [fetchAll]);

  function moveCard(id: CardId, dir: -1 | 1) {
    const next = [...layout.order];
    const i = next.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    persist({ ...layout, order: next });
  }
  function hideCard(id: CardId) {
    if (!layout.order.includes(id)) return;
    persist({
      order: layout.order.filter(x => x !== id),
      hidden: [...layout.hidden, id],
    });
  }
  function showCard(id: CardId) {
    if (!layout.hidden.includes(id)) return;
    persist({
      order: [...layout.order, id],
      hidden: layout.hidden.filter(x => x !== id),
    });
  }
  function showAllHidden() {
    if (!layout.hidden.length) return;
    persist({ order: [...layout.order, ...layout.hidden], hidden: [] });
  }
  function resetLayout() {
    persist({ order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN });
  }

  if (loading || !data) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
        <Text style={styles.loaderText}>Loading your card catalog…</Text>
      </View>
    );
  }

  const greeting = greetingForHour(new Date().getHours(), data.profile?.username);
  const subline = data.profile?.username ? `${data.profile.username}'s card catalog` : 'Your card catalog';

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />}
      >
        {/* Greeting + edit toolbar */}
        <View style={styles.greetingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.subline}>{subline}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {editMode && (
              <TouchableOpacity onPress={() => setShowAddSheet(true)} style={styles.btnGhost}>
                <Text style={styles.btnGhostText}>+ Add</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => { setEditMode(v => !v); setShowAddSheet(false); }} style={editMode ? styles.btnPrimary : styles.btnGhost}>
              <Text style={editMode ? styles.btnPrimaryText : styles.btnGhostText}>{editMode ? 'Done' : '⚙ Customize'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Cards */}
        {layout.order.map((id, idx) => {
          const def = CARD_BY_ID[id];
          if (!def) return null;
          return (
            <CardFrame
              key={id}
              label={def.label}
              editMode={editMode}
              isFirst={idx === 0}
              isLast={idx === layout.order.length - 1}
              onMoveUp={() => moveCard(id, -1)}
              onMoveDown={() => moveCard(id, 1)}
              onHide={() => hideCard(id)}
            >
              {renderCardBody(id, data, router)}
            </CardFrame>
          );
        })}

        {layout.order.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Your card catalog is empty</Text>
            <Text style={styles.emptyMsg}>Add some cards to fill it up.</Text>
            <TouchableOpacity onPress={() => { setEditMode(true); setShowAddSheet(true); }} style={styles.btnPrimary}>
              <Text style={styles.btnPrimaryText}>+ Add card</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Add cards sheet */}
      <Modal
        visible={showAddSheet}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddSheet(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowAddSheet(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Add a card</Text>
              <TouchableOpacity onPress={() => setShowAddSheet(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.muted} />
              </TouchableOpacity>
            </View>
            {layout.hidden.length === 0 ? (
              <Text style={styles.emptyMsg}>All cards are already in your catalog.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 380 }}>
                {layout.hidden.map(id => {
                  const def = CARD_BY_ID[id];
                  if (!def) return null;
                  return (
                    <TouchableOpacity
                      key={id}
                      style={styles.sheetRow}
                      onPress={() => { showCard(id); }}
                    >
                      <Text style={styles.sheetRowLabel}>{def.label}</Text>
                      <Ionicons name="add-circle-outline" size={22} color={Colors.rust} />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.sheetActions}>
              <TouchableOpacity onPress={() => { showAllHidden(); }} style={styles.btnGhost} disabled={!layout.hidden.length}>
                <Text style={[styles.btnGhostText, !layout.hidden.length && { opacity: 0.4 }]}>Add all</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { resetLayout(); setShowAddSheet(false); }} style={styles.btnGhost}>
                <Text style={styles.btnGhostText}>Reset layout</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── CardFrame ────────────────────────────────────────────────────────────
interface CardFrameProps {
  label: string;
  editMode: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onHide: () => void;
  children: React.ReactNode;
}
function CardFrame({ label, editMode, isFirst, isLast, onMoveUp, onMoveDown, onHide, children }: CardFrameProps) {
  return (
    <View style={styles.cardFrame}>
      {children}
      {editMode && (
        <View style={styles.editChrome} pointerEvents="box-none">
          <View style={styles.editLabel}>
            <Text style={styles.editLabelText}>{label}</Text>
          </View>
          <View style={styles.editButtons}>
            <IconBtn onPress={onMoveUp} disabled={isFirst} icon="arrow-up" />
            <IconBtn onPress={onMoveDown} disabled={isLast} icon="arrow-down" />
            <IconBtn onPress={onHide} icon="close" danger />
          </View>
        </View>
      )}
    </View>
  );
}

function IconBtn({ onPress, disabled, icon, danger }: { onPress: () => void; disabled?: boolean; icon: any; danger?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.iconBtn,
        danger && styles.iconBtnDanger,
        disabled && { opacity: 0.3 },
      ]}
      hitSlop={6}
    >
      <Ionicons name={icon} size={16} color={danger ? '#fff' : Colors.ink} />
    </TouchableOpacity>
  );
}

// ── Render card body ─────────────────────────────────────────────────────
function renderCardBody(id: CardId, data: CatalogData, router: ReturnType<typeof useRouter>) {
  const open = (b: BookRef | null | undefined) => { if (b?.id) router.push(`/book/${b.id}`); };
  switch (id) {
    case 'continue-reading': return <HeroCard data={data} onOpen={open} />;
    case 'goal':             return <GoalCard data={data} onSet={() => router.push('/stats')} />;
    case 'stats':            return <StatsCard data={data} onPress={() => router.push('/stats')} />;
    case 'nightstand':       return <NightstandCard data={data} onOpen={open} />;
    case 'quote':            return <QuoteCard data={data} onOpen={open} />;
    case 'dispatches':       return <DispatchesCard data={data} onOpen={open} onProfile={(u) => router.push(`/profile/${u}`)} onFeed={() => router.push('/(tabs)/feed')} onFindFriends={() => router.push('/friends')} />;
    case 'this-week':        return <ThisWeekCard data={data} onLoans={() => router.push('/loans' as any)} />;
    case 'rediscover':       return <RediscoverCard data={data} onOpen={open} />;
    case 'recently-added':   return <RecentlyAddedCard data={data} onOpen={open} />;
    case 'top-genres':       return <TopGenresCard data={data} onPress={() => router.push('/stats')} />;
    case 'book-values':      return <BookValuesCard data={data} onPress={() => router.push('/valuation')} />;
    case 'library-count':    return <LibraryCountCard data={data} />;
    case 'random-book':      return <RandomBookCard data={data} onOpen={open} />;
    case 'want-to-read':     return <WantToReadCard data={data} onOpen={open} />;
    case 'marketplace':      return <MarketplaceCard data={data} onOpen={open} onSeeAll={() => router.push('/(tabs)/marketplace')} />;
    case 'loans':            return <LoansCard data={data} onSeeAll={() => router.push('/loans' as any)} />;
    case 'badges':           return <BadgesCard data={data} onPress={() => router.push('/badges')} />;
    case 'clubs':            return <ClubsCard data={data} onSeeAll={() => router.push('/clubs')} />;
    case 'my-shelves':       return <MyShelvesCard data={data} onSeeAll={() => router.push('/shelves')} />;
    default: return null;
  }
}

// ── Card primitives ──────────────────────────────────────────────────────
function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  return <Text style={[styles.eyebrow, color && { color }]}>{children}</Text>;
}

function SeeAll({ label = 'See all', onPress }: { label?: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={8}>
      <Text style={styles.seeAll}>{label} →</Text>
    </TouchableOpacity>
  );
}

function CardCover({ book, w = 44, h = 66 }: { book: BookRef; w?: number; h?: number }) {
  if (book.cover_image_url) {
    return <Image source={{ uri: book.cover_image_url }} style={{ width: w, height: h, borderRadius: 4 }} />;
  }
  return <FakeCover title={book.title} author={book.author} width={w} height={h} />;
}

function EmptyBlock({ icon, message, ctaLabel, onCta }: { icon: string; message: string; ctaLabel?: string; onCta?: () => void }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 12 }}>
      <Text style={{ fontSize: 22 }}>{icon}</Text>
      <Text style={{ fontSize: 12, color: Colors.muted, marginTop: 6, marginBottom: ctaLabel ? 10 : 0 }}>{message}</Text>
      {ctaLabel && onCta && (
        <TouchableOpacity onPress={onCta} style={styles.btnGhost}>
          <Text style={styles.btnGhostText}>{ctaLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────
function HeroCard({ data, onOpen }: { data: CatalogData; onOpen: (b: BookRef | null) => void }) {
  const lead = data.reading[0];
  const total = lead?.books?.pages || 0;
  const cur = lead?.current_page || 0;
  const pct = total ? Math.min(100, Math.round((cur / total) * 100)) : 0;
  return (
    <LinearGradient
      colors={['#1a1208', '#3a2010']}
      style={styles.hero}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        {lead?.books ? (
          <CardCover book={lead.books} w={70} h={104} />
        ) : (
          <View style={[styles.heroFallbackCover]}>
            <Text style={{ color: '#f5f0e8', fontSize: 28 }}>📖</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.heroEyebrow}>
            {lead ? 'PICK UP WHERE YOU LEFT OFF' : 'START SOMETHING NEW'}
          </Text>
          <Text style={styles.heroTitle} numberOfLines={2}>
            {lead?.books?.title || 'Add a book to get started'}
          </Text>
          {lead?.books?.author && (
            <Text style={styles.heroAuthor} numberOfLines={1}>{lead.books.author}</Text>
          )}
          {lead && total > 0 && (
            <View style={{ marginTop: 8 }}>
              <View style={styles.heroProgressRow}>
                <Text style={styles.heroProgressText}>page {cur} / {total}</Text>
                <Text style={styles.heroPct}>{pct}%</Text>
              </View>
              <View style={styles.heroBarBg}>
                <View style={[styles.heroBarFill, { width: `${pct}%` }]} />
              </View>
            </View>
          )}
        </View>
      </View>
      {lead?.books && (
        <TouchableOpacity onPress={() => onOpen(lead.books)} style={styles.heroBtn}>
          <Text style={styles.heroBtnText}>Continue →</Text>
        </TouchableOpacity>
      )}
    </LinearGradient>
  );
}

// ── Goal ────────────────────────────────────────────────────────────────
function GoalCard({ data, onSet }: { data: CatalogData; onSet: () => void }) {
  const yr = new Date().getFullYear();
  if (!data.goal) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>{yr} GOAL</Eyebrow>
        <EmptyBlock icon="🎯" message="Track your progress through the year." ctaLabel="Set goal →" onCta={onSet} />
      </View>
    );
  }
  const { target, current } = data.goal;
  const pct = Math.min(1, target ? current / target : 0);
  const dayOfYear = Math.floor((Date.now() - new Date(yr, 0, 0).getTime()) / 86400000);
  const expected = Math.round((dayOfYear / 365) * target);
  const ahead = current - expected;
  const remaining = Math.max(0, target - current);
  const onPace = dayOfYear > 0 ? Math.round((current / dayOfYear) * 365) : target;
  return (
    <View style={styles.cardBody}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Eyebrow>{yr} GOAL</Eyebrow>
        <View style={[styles.pill, { backgroundColor: ahead >= 0 ? 'rgba(90,122,90,0.15)' : 'rgba(184,134,11,0.15)' }]}>
          <Text style={{ fontSize: 9, fontWeight: '700', color: ahead >= 0 ? Colors.sage : Colors.gold, letterSpacing: 1.5 }}>
            {ahead >= 0 ? `+${ahead} AHEAD` : `${ahead} BEHIND`}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'center', paddingVertical: 8 }}>
        <View style={[styles.ringOuter, { borderColor: pct >= 1 ? Colors.sage : Colors.rust }]}>
          <Text style={styles.ringValue}>{current}</Text>
          <Text style={styles.ringTarget}>/ {target}</Text>
        </View>
        <Text style={styles.statTitle}>On pace for {onPace} books</Text>
        <Text style={styles.statSub}>{remaining > 0 ? `${remaining} more by Dec 31` : 'Goal reached 🎉'}</Text>
      </View>
    </View>
  );
}

// ── Stats ───────────────────────────────────────────────────────────────
function StatsCard({ data, onPress }: { data: CatalogData; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.cardBody}>
      <View style={styles.headerRow}>
        <Eyebrow>READING STATS</Eyebrow>
        <Text style={styles.seeAll}>Details →</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6 }}>
        <StatBlock value={data.streak} label="day streak" highlight />
        <StatBlock value={data.pagesThisWeek} label="pages this week" />
        <StatBlock value={data.booksReadYear} label={`books in ${new Date().getFullYear()}`} />
      </View>
    </TouchableOpacity>
  );
}
function StatBlock({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={[styles.bigStat, highlight && { color: Colors.rust }]}>{value}</Text>
      <Text style={styles.bigStatLabel}>{label}</Text>
    </View>
  );
}

// ── Nightstand ──────────────────────────────────────────────────────────
function NightstandCard({ data, onOpen }: { data: CatalogData; onOpen: (b: BookRef | null) => void }) {
  if (!data.reading.length) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>ON YOUR NIGHTSTAND</Eyebrow>
        <EmptyBlock icon="🌙" message="Nothing in progress yet." />
      </View>
    );
  }
  return (
    <View style={styles.cardBody}>
      <Eyebrow>ON YOUR NIGHTSTAND</Eyebrow>
      <View style={{ marginTop: 10 }}>
        {data.reading.slice(0, 4).map(e => {
          if (!e.books) return null;
          const total = e.books.pages || 0;
          const cur = e.current_page || 0;
          const pct = total ? Math.round((cur / total) * 100) : 0;
          return (
            <TouchableOpacity key={e.id} onPress={() => onOpen(e.books)} style={styles.bookRow}>
              <CardCover book={e.books} w={36} h={54} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.bookTitle} numberOfLines={1}>{e.books.title}</Text>
                {e.books.author && <Text style={styles.bookAuthor} numberOfLines={1}>{e.books.author}</Text>}
                {total > 0 && (
                  <View style={{ marginTop: 4 }}>
                    <View style={styles.barBg}>
                      <View style={[styles.barFill, { width: `${pct}%` }]} />
                    </View>
                    <Text style={styles.barLabel}>{pct}% · pg {cur}/{total}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── Quote ───────────────────────────────────────────────────────────────
function QuoteCard({ data, onOpen }: { data: CatalogData; onOpen: (b: BookRef | null) => void }) {
  if (!data.dailyQuote) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>QUOTE OF THE DAY</Eyebrow>
        <EmptyBlock icon="❝" message="Save quotes from your books to see them here." />
      </View>
    );
  }
  const q = data.dailyQuote;
  return (
    <TouchableOpacity onPress={() => onOpen(q.books)} activeOpacity={0.7} style={styles.cardBody}>
      <Eyebrow>QUOTE OF THE DAY</Eyebrow>
      <Text style={styles.quoteText} numberOfLines={5}>"{q.quote_text}"</Text>
      {q.books && (
        <Text style={styles.quoteSource} numberOfLines={1}>
          — {q.books.title}{q.books.author ? `, ${q.books.author}` : ''}
        </Text>
      )}
    </TouchableOpacity>
  );
}

// ── Dispatches ──────────────────────────────────────────────────────────
function DispatchesCard({ data, onOpen, onProfile, onFeed, onFindFriends }: {
  data: CatalogData; onOpen: (b: BookRef | null) => void;
  onProfile: (u: string) => void; onFeed: () => void; onFindFriends: () => void;
}) {
  if (!data.hasFriends) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>DISPATCHES</Eyebrow>
        <EmptyBlock icon="👥" message="Add friends to see their reading activity." ctaLabel="Find friends →" onCta={onFindFriends} />
      </View>
    );
  }
  if (!data.dispatches.length) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>DISPATCHES</Eyebrow>
        <EmptyBlock icon="📭" message="No recent activity from your friends." />
      </View>
    );
  }
  return (
    <View style={styles.cardBody}>
      <View style={styles.headerRow}>
        <Eyebrow>DISPATCHES</Eyebrow>
        <SeeAll label="Feed" onPress={onFeed} />
      </View>
      <View style={{ marginTop: 8 }}>
        {data.dispatches.slice(0, 4).map(d => {
          if (!d.book) return null;
          const verb = d.kind === 'post' ? (d.status === 'quote' ? 'shared a quote from' : 'posted about')
                     : d.status === 'reading' ? 'started reading'
                     : d.status === 'read'    ? 'finished'
                     : d.status === 'want'    ? 'wants to read'
                     : 'added';
          return (
            <View key={d.id} style={styles.dispatchRow}>
              <TouchableOpacity onPress={() => onOpen(d.book)}>
                <CardCover book={d.book} w={32} h={48} />
              </TouchableOpacity>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.dispatchLine} numberOfLines={2}>
                  <Text style={styles.dispatchUser} onPress={() => d.profile?.username && onProfile(d.profile.username)}>
                    {d.profile?.username || 'someone'}
                  </Text>
                  <Text style={{ color: Colors.muted }}> {verb} </Text>
                  <Text style={styles.dispatchBook} onPress={() => onOpen(d.book)}>{d.book.title}</Text>
                </Text>
                <Text style={styles.dispatchTime}>{timeAgo(d.date)}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── This Week ───────────────────────────────────────────────────────────
function ThisWeekCard({ data, onLoans }: { data: CatalogData; onLoans: () => void }) {
  if (!data.agenda.length) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>THIS WEEK</Eyebrow>
        <EmptyBlock icon="🗓" message="Nothing on your reading agenda this week." />
      </View>
    );
  }
  return (
    <View style={styles.cardBody}>
      <Eyebrow>THIS WEEK</Eyebrow>
      <View style={{ marginTop: 8 }}>
        {data.agenda.slice(0, 4).map((a, i) => (
          <TouchableOpacity key={i} onPress={a.link === '/loans' ? onLoans : undefined} style={styles.agendaRow}>
            <View style={styles.agendaDay}>
              <Text style={styles.agendaDayText}>{a.label}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.agendaTitle} numberOfLines={1}>{a.title}</Text>
              <Text style={styles.agendaMeta}>{a.meta}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Rediscover ──────────────────────────────────────────────────────────
function RediscoverCard({ data, onOpen }: { data: CatalogData; onOpen: (b: BookRef | null) => void }) {
  const r = data.rediscover;
  if (!r?.books) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow color={Colors.gold}>REDISCOVER</Eyebrow>
        <EmptyBlock icon="📚" message="Read some books to rediscover them here." />
      </View>
    );
  }
  return (
    <TouchableOpacity onPress={() => onOpen(r.books)} activeOpacity={0.7} style={styles.cardBody}>
      <Eyebrow color={Colors.gold}>REDISCOVER</Eyebrow>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 12 }}>
        <CardCover book={r.books!} w={50} h={75} />
        <View style={{ flex: 1 }}>
          <Text style={styles.bookTitle} numberOfLines={2}>{r.books!.title}</Text>
          {r.books!.author && <Text style={styles.bookAuthor} numberOfLines={1}>{r.books!.author}</Text>}
          <Text style={styles.bookMeta}>You read this · revisit?</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Recently Added ──────────────────────────────────────────────────────
function RecentlyAddedCard({ data, onOpen }: { data: CatalogData; onOpen: (b: BookRef | null) => void }) {
  if (!data.recentlyAdded.length) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>RECENTLY ADDED</Eyebrow>
        <EmptyBlock icon="📥" message="Add books to your library to see them here." />
      </View>
    );
  }
  return (
    <View style={styles.cardBody}>
      <Eyebrow>RECENTLY ADDED</Eyebrow>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
        {data.recentlyAdded.filter(e => e.books).slice(0, 12).map(e => (
          <TouchableOpacity key={e.id} onPress={() => onOpen(e.books)} style={{ marginRight: 10 }}>
            <CardCover book={e.books!} w={56} h={84} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// ── Top Genres ──────────────────────────────────────────────────────────
function TopGenresCard({ data, onPress }: { data: CatalogData; onPress: () => void }) {
  if (!data.topGenres.length) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>TOP GENRES</Eyebrow>
        <EmptyBlock icon="📊" message="Mark books with genres to see your top picks." />
      </View>
    );
  }
  const max = data.topGenres[0][1];
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.cardBody}>
      <View style={styles.headerRow}>
        <Eyebrow>TOP GENRES</Eyebrow>
        <Text style={styles.seeAll}>Stats →</Text>
      </View>
      <View style={{ marginTop: 10 }}>
        {data.topGenres.slice(0, 5).map(([g, c]) => (
          <View key={g} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
              <Text style={styles.genreLabel}>{g}</Text>
              <Text style={styles.genreCount}>{c}</Text>
            </View>
            <View style={styles.barBg}>
              <View style={[styles.barFill, { width: `${(c / max) * 100}%` }]} />
            </View>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );
}

// ── Book Values ─────────────────────────────────────────────────────────
function BookValuesCard({ data, onPress }: { data: CatalogData; onPress: () => void }) {
  const { retailTotal, retailCount, marketTotal } = data.bookValues;
  if (!retailCount) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.cardBody}>
        <Eyebrow>BOOK VALUES</Eyebrow>
        <EmptyBlock icon="💰" message="Run valuations to see your library's worth." ctaLabel="Open valuations →" onCta={onPress} />
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.cardBody}>
      <View style={styles.headerRow}>
        <Eyebrow>BOOK VALUES</Eyebrow>
        <Text style={styles.seeAll}>Details →</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 12 }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.bigStat}>${Math.round(retailTotal).toLocaleString()}</Text>
          <Text style={styles.bigStatLabel}>retail</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.bigStat, { color: Colors.sage }]}>${Math.round(marketTotal).toLocaleString()}</Text>
          <Text style={styles.bigStatLabel}>market</Text>
        </View>
      </View>
      <Text style={styles.bigStatLabel}>across {retailCount} books</Text>
    </TouchableOpacity>
  );
}

// ── Library Count ───────────────────────────────────────────────────────
function LibraryCountCard({ data }: { data: CatalogData }) {
  const { total, read, reading, want } = data.counts;
  return (
    <View style={styles.cardBody}>
      <Eyebrow>BOOKS IN LIBRARY</Eyebrow>
      <Text style={[styles.bigStat, { fontSize: 36, marginTop: 6 }]}>{total}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 8 }}>
        <CountBlock value={read}    label="read"    color={Colors.gold} />
        <CountBlock value={reading} label="reading" color={Colors.rust} />
        <CountBlock value={want}    label="want"    color={Colors.muted} />
      </View>
    </View>
  );
}
function CountBlock({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color, fontFamily: 'Georgia' }}>{value}</Text>
      <Text style={styles.bigStatLabel}>{label}</Text>
    </View>
  );
}

// ── Random Book ─────────────────────────────────────────────────────────
function RandomBookCard({ data, onOpen }: { data: CatalogData; onOpen: (b: BookRef | null) => void }) {
  if (!data.randomBook) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>RANDOM BOOK OF THE DAY</Eyebrow>
        <EmptyBlock icon="🎲" message="Add books to your library to see one here." />
      </View>
    );
  }
  return (
    <TouchableOpacity onPress={() => onOpen(data.randomBook)} activeOpacity={0.7} style={styles.cardBody}>
      <Eyebrow>RANDOM BOOK OF THE DAY</Eyebrow>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 12 }}>
        <CardCover book={data.randomBook} w={50} h={75} />
        <View style={{ flex: 1 }}>
          <Text style={styles.bookTitle} numberOfLines={2}>{data.randomBook.title}</Text>
          {data.randomBook.author && <Text style={styles.bookAuthor} numberOfLines={1}>{data.randomBook.author}</Text>}
          <Text style={styles.bookMeta}>From your library</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Want to Read ────────────────────────────────────────────────────────
function WantToReadCard({ data, onOpen }: { data: CatalogData; onOpen: (b: BookRef | null) => void }) {
  if (!data.want.length) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>WANT TO READ</Eyebrow>
        <EmptyBlock icon="🔖" message="Mark books as 'want to read' to build a queue." />
      </View>
    );
  }
  return (
    <View style={styles.cardBody}>
      <View style={styles.headerRow}>
        <Eyebrow>WANT TO READ</Eyebrow>
        <Text style={styles.eyebrowCount}>{data.want.length}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
        {data.want.slice(0, 12).map(e => e.books && (
          <TouchableOpacity key={e.id} onPress={() => onOpen(e.books)} style={{ marginRight: 10 }}>
            <CardCover book={e.books} w={56} h={84} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// ── Marketplace ─────────────────────────────────────────────────────────
function MarketplaceCard({ data, onOpen, onSeeAll }: {
  data: CatalogData; onOpen: (b: BookRef | null) => void; onSeeAll: () => void;
}) {
  if (!data.myListings.length) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>MARKETPLACE</Eyebrow>
        <EmptyBlock icon="🛒" message="List books for trade or sale." ctaLabel="Open marketplace →" onCta={onSeeAll} />
      </View>
    );
  }
  return (
    <View style={styles.cardBody}>
      <View style={styles.headerRow}>
        <Eyebrow>MY LISTINGS</Eyebrow>
        <SeeAll onPress={onSeeAll} />
      </View>
      <View style={{ marginTop: 10 }}>
        {data.myListings.slice(0, 3).map(l => l.books && (
          <TouchableOpacity key={l.id} onPress={() => onOpen(l.books)} style={styles.bookRow}>
            <CardCover book={l.books} w={36} h={54} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.bookTitle} numberOfLines={1}>{l.books.title}</Text>
              {l.condition && <Text style={styles.bookAuthor} numberOfLines={1}>{l.condition}</Text>}
            </View>
            {l.price != null && <Text style={styles.priceTag}>${Number(l.price).toFixed(0)}</Text>}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Loans ───────────────────────────────────────────────────────────────
function LoansCard({ data, onSeeAll }: { data: CatalogData; onSeeAll: () => void }) {
  const { borrowing, lending } = data.loans;
  if (!borrowing.length && !lending.length) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>LOANS</Eyebrow>
        <EmptyBlock icon="🤝" message="No active loans right now." ctaLabel="Open loans →" onCta={onSeeAll} />
      </View>
    );
  }
  return (
    <TouchableOpacity onPress={onSeeAll} activeOpacity={0.7} style={styles.cardBody}>
      <View style={styles.headerRow}>
        <Eyebrow>LOANS</Eyebrow>
        <Text style={styles.seeAll}>See all →</Text>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 10, gap: 12 }}>
        <View style={{ flex: 1, alignItems: 'center', padding: 10, backgroundColor: Colors.background, borderRadius: 8 }}>
          <Text style={styles.bigStat}>{borrowing.length}</Text>
          <Text style={styles.bigStatLabel}>borrowing</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', padding: 10, backgroundColor: Colors.background, borderRadius: 8 }}>
          <Text style={[styles.bigStat, { color: Colors.sage }]}>{lending.length}</Text>
          <Text style={styles.bigStatLabel}>lending</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Badges ──────────────────────────────────────────────────────────────
function BadgesCard({ data, onPress }: { data: CatalogData; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.cardBody}>
      <View style={styles.headerRow}>
        <Eyebrow>BADGES</Eyebrow>
        <Text style={styles.seeAll}>View all →</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 16 }}>
        <Text style={{ fontSize: 36 }}>🏅</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.bigStat}>Level {data.profile?.level ?? 1}</Text>
          <Text style={styles.bigStatLabel}>{data.profile?.level_points ?? 0} points earned</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Clubs ───────────────────────────────────────────────────────────────
function ClubsCard({ data, onSeeAll }: { data: CatalogData; onSeeAll: () => void }) {
  if (!data.clubs.length) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>BOOK CLUBS</Eyebrow>
        <EmptyBlock icon="📖" message="Join or create a book club to see them here." ctaLabel="Browse clubs →" onCta={onSeeAll} />
      </View>
    );
  }
  return (
    <View style={styles.cardBody}>
      <View style={styles.headerRow}>
        <Eyebrow>BOOK CLUBS</Eyebrow>
        <SeeAll onPress={onSeeAll} />
      </View>
      <View style={{ marginTop: 10 }}>
        {data.clubs.slice(0, 3).map(c => (
          <TouchableOpacity key={c.id} onPress={onSeeAll} style={styles.bookRow}>
            {c.books?.id ? (
              <CardCover book={c.books} w={36} h={54} />
            ) : (
              <View style={[styles.placeholderCover, { width: 36, height: 54 }]}><Text style={{ fontSize: 18 }}>📖</Text></View>
            )}
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.bookTitle} numberOfLines={1}>{c.name}</Text>
              {c.books?.title && <Text style={styles.bookAuthor} numberOfLines={1}>Reading: {c.books.title}</Text>}
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── My Shelves ──────────────────────────────────────────────────────────
function MyShelvesCard({ data, onSeeAll }: { data: CatalogData; onSeeAll: () => void }) {
  if (!data.shelves.length) {
    return (
      <View style={styles.cardBody}>
        <Eyebrow>MY SHELVES</Eyebrow>
        <EmptyBlock icon="📚" message="Create custom shelves to organize your library." ctaLabel="Open shelves →" onCta={onSeeAll} />
      </View>
    );
  }
  return (
    <View style={styles.cardBody}>
      <View style={styles.headerRow}>
        <Eyebrow>MY SHELVES</Eyebrow>
        <SeeAll onPress={onSeeAll} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {data.shelves.slice(0, 6).map(s => (
          <TouchableOpacity key={s.id} onPress={onSeeAll} style={[styles.shelfChip, { backgroundColor: s.color || Colors.background }]}>
            <Text style={styles.shelfChipText} numberOfLines={1}>{s.name}</Text>
            <Text style={styles.shelfChipCount}>{s._bookCount}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  loaderText: { marginTop: 12, color: Colors.muted, fontFamily: 'Georgia' },
  greetingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 8 },
  greeting: { fontFamily: 'Georgia', fontWeight: '700', fontSize: 20, color: Colors.ink, letterSpacing: -0.3 },
  subline: { fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 12, color: Colors.muted, marginTop: 2 },
  btnPrimary: { backgroundColor: Colors.rust, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8 },
  btnPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  btnGhost: { backgroundColor: 'transparent', paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  btnGhostText: { color: Colors.ink, fontSize: 12, fontWeight: '600' },

  cardFrame: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  cardBody: { padding: 14 },

  editChrome: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editLabel: {
    backgroundColor: Colors.background,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  editLabelText: { fontSize: 10, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700' },
  editButtons: { flexDirection: 'row', gap: 4 },
  iconBtn: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  iconBtnDanger: { backgroundColor: Colors.rust, borderColor: Colors.rust },

  eyebrow: { fontSize: 10, fontWeight: '700', color: Colors.muted, letterSpacing: 1.5 },
  eyebrowCount: { fontSize: 11, color: Colors.muted, fontWeight: '600' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seeAll: { fontSize: 11, color: Colors.rust, fontWeight: '600' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },

  bigStat: { fontFamily: 'Georgia', fontSize: 22, fontWeight: '700', color: Colors.ink },
  bigStatLabel: { fontSize: 10, color: Colors.muted, marginTop: 2, textAlign: 'center', textTransform: 'lowercase' },
  statTitle: { fontFamily: 'Georgia', fontWeight: '700', fontSize: 13, color: Colors.ink, marginTop: 8 },
  statSub: { fontSize: 11, color: Colors.muted, marginTop: 2 },

  // Hero
  hero: { padding: 16, borderRadius: 14, gap: 12 },
  heroFallbackCover: { width: 70, height: 104, borderRadius: 4, backgroundColor: 'rgba(245,240,232,0.1)', alignItems: 'center', justifyContent: 'center' },
  heroEyebrow: { fontSize: 9, fontWeight: '700', color: 'rgba(245,240,232,0.6)', letterSpacing: 2, marginBottom: 4 },
  heroTitle: { fontFamily: 'Georgia', fontWeight: '700', fontSize: 17, color: '#f5f0e8', lineHeight: 21 },
  heroAuthor: { fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 12, color: 'rgba(245,240,232,0.65)', marginTop: 2 },
  heroProgressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  heroProgressText: { fontSize: 10, color: 'rgba(245,240,232,0.7)', letterSpacing: 1, textTransform: 'uppercase' },
  heroPct: { fontFamily: 'Georgia', fontWeight: '700', fontSize: 14, color: '#f5f0e8' },
  heroBarBg: { height: 4, backgroundColor: 'rgba(245,240,232,0.15)', borderRadius: 999, overflow: 'hidden' },
  heroBarFill: { height: '100%', backgroundColor: Colors.rust, borderRadius: 999 },
  heroBtn: { alignSelf: 'flex-start', backgroundColor: '#f5f0e8', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  heroBtnText: { color: Colors.ink, fontWeight: '700', fontSize: 13 },

  // Ring
  ringOuter: { width: 90, height: 90, borderRadius: 45, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', borderWidth: 6 },
  ringValue: { fontFamily: 'Georgia', fontSize: 22, fontWeight: '700', color: Colors.ink },
  ringTarget: { fontSize: 10, color: Colors.muted, marginTop: -2 },

  // Generic book row
  bookRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  bookTitle: { fontFamily: 'Georgia', fontWeight: '700', fontSize: 13, color: Colors.ink },
  bookAuthor: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  bookMeta: { fontSize: 10, color: Colors.muted, marginTop: 4, fontStyle: 'italic' },
  barBg: { height: 4, backgroundColor: Colors.border, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: Colors.rust, borderRadius: 999 },
  barLabel: { fontSize: 10, color: Colors.muted, marginTop: 3 },
  priceTag: { fontFamily: 'Georgia', fontWeight: '700', fontSize: 14, color: Colors.sage },

  // Quote
  quoteText: { fontFamily: 'Georgia', fontSize: 14, fontStyle: 'italic', color: Colors.ink, lineHeight: 21, marginTop: 10 },
  quoteSource: { fontSize: 11, color: Colors.muted, marginTop: 8 },

  // Dispatch
  dispatchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  dispatchLine: { fontSize: 13, color: Colors.ink, lineHeight: 18 },
  dispatchUser: { fontWeight: '700', color: Colors.rust },
  dispatchBook: { fontStyle: 'italic', color: Colors.ink },
  dispatchTime: { fontSize: 10, color: Colors.muted, marginTop: 2 },

  // Agenda
  agendaRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 10 },
  agendaDay: { width: 64, alignItems: 'center', backgroundColor: Colors.background, paddingVertical: 6, borderRadius: 6 },
  agendaDayText: { fontFamily: 'Georgia', fontWeight: '700', fontSize: 11, color: Colors.rust },
  agendaTitle: { fontFamily: 'Georgia', fontWeight: '700', fontSize: 13, color: Colors.ink },
  agendaMeta: { fontSize: 10, color: Colors.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Genre
  genreLabel: { fontSize: 12, color: Colors.ink, fontWeight: '600' },
  genreCount: { fontSize: 12, color: Colors.muted },

  // Shelf chip
  shelfChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', minWidth: 80 },
  shelfChipText: { fontFamily: 'Georgia', fontWeight: '700', fontSize: 12, color: Colors.ink },
  shelfChipCount: { fontSize: 10, color: Colors.muted, marginTop: 2 },

  placeholderCover: { backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },

  // Empty state for whole catalog
  emptyState: { alignItems: 'center', padding: 24, backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed' },
  emptyTitle: { fontFamily: 'Georgia', fontWeight: '700', fontSize: 16, color: Colors.ink, marginBottom: 6 },
  emptyMsg: { fontSize: 12, color: Colors.muted, marginBottom: 12, textAlign: 'center' },

  // Sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 28 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { fontFamily: 'Georgia', fontWeight: '700', fontSize: 17, color: Colors.ink },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  sheetRowLabel: { fontFamily: 'Georgia', fontSize: 14, color: Colors.ink },
  sheetActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
});
