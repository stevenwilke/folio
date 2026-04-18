import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
// BadgesSection moved to dedicated /badges screen
import { computeReadingSpeeds, formatDuration, ReadingSpeeds } from '../lib/readingSpeed';
import { computeChallengeProgress, generateMonthlyChallenges } from '../lib/challenges';
import ChallengeCard from '../components/ChallengeCard';
import NewChallengeModal from '../components/NewChallengeModal';
import ReadingHeatmap from '../components/ReadingHeatmap';
import ReadingWrapped from '../components/ReadingWrapped';

// ---- Types ----

interface StatsData {
  totalBooks: number;
  booksRead: number;
  totalPages: number;
  avgRating: number | null;
  booksByYear: { year: number; count: number }[];
  topGenres: { genre: string; count: number }[];
  mostReadAuthor: { name: string; count: number } | null;
  longestBookRead: { title: string; pages: number } | null;
  currentYearCount: number;
  readingSpeeds: ReadingSpeeds | null;
  totalReadingMinutes: number;
  totalSessions: number;
  totalListValue: number;
  totalMarketValue: number;
  listValueCount: number;
  topGenresByValue: { genre: string; value: number }[];
  topBooksByValue: { title: string; price: number }[];
  valueByStatus: Record<string, number>;
}

// ---- Stat card ----

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={sc.card}>
      <Text style={sc.value}>{value}</Text>
      <Text style={sc.label}>{label}</Text>
      {sub ? <Text style={sc.sub}>{sub}</Text> : null}
    </View>
  );
}
const sc = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    minWidth: 80,
  },
  value: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.rust,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  label: {
    fontSize: 10,
    color: Colors.muted,
    marginTop: 3,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  sub: {
    fontSize: 10,
    color: Colors.muted,
    fontStyle: 'italic',
    marginTop: 1,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});

// ---- Section wrapper ----

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sec.box}>
      <Text style={sec.title}>{title}</Text>
      {children}
    </View>
  );
}
const sec = StyleSheet.create({
  box: { marginBottom: 28 },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 14,
  },
});

// ---- Bar chart row ----

function BarRow({ year, count, maxCount }: { year: number; count: number; maxCount: number }) {
  const pct = maxCount > 0 ? count / maxCount : 0;
  return (
    <View style={bar.row}>
      <Text style={bar.yearLabel}>{year}</Text>
      <View style={bar.track}>
        <View style={[bar.fill, { flex: pct }]} />
        <View style={{ flex: 1 - pct }} />
      </View>
      <Text style={bar.count}>{count}</Text>
    </View>
  );
}
const bar = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  yearLabel: {
    width: 42,
    fontSize: 13,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
    textAlign: 'right',
  },
  track: { flex: 1, height: 14, flexDirection: 'row', backgroundColor: Colors.border, borderRadius: 7, overflow: 'hidden' },
  fill: { backgroundColor: Colors.rust, borderRadius: 7 },
  count: {
    width: 28,
    fontSize: 12,
    color: Colors.ink,
    fontWeight: '600',
    textAlign: 'right',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});

// ---- Highlight row ----

function Highlight({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={hl.row}>
      <Text style={hl.icon}>{icon}</Text>
      <View style={hl.info}>
        <Text style={hl.label}>{label}</Text>
        <Text style={hl.value}>{value}</Text>
      </View>
    </View>
  );
}
const hl = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  icon: { fontSize: 24 },
  info: { flex: 1, gap: 2 },
  label: {
    fontSize: 11,
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  value: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
});

// ---- Main screen ----

export default function StatsScreen() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rawEntries, setRawEntries] = useState<any[]>([]);
  const [friendCount, setFriendCount] = useState(0);
  const [challenges, setChallenges] = useState<any[]>([]);
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [sessionDates, setSessionDates] = useState<string[]>([]);
  const [showNewChallenge, setShowNewChallenge] = useState(false);

  async function fetchStats() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: entries }, { count: fc }] = await Promise.all([
      supabase
        .from('collection_entries')
        .select(`
          id, read_status, user_rating, review_text, added_at,
          books ( id, title, author, genre, pages, published_year, series_name )
        `)
        .eq('user_id', user.id),
      supabase
        .from('friendships')
        .select('id', { count: 'exact', head: true })
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq('status', 'accepted'),
    ]);

    setRawEntries(entries || []);
    setFriendCount(fc || 0);

    if (!entries) return;

    const all = entries as any[];
    const readEntries = all.filter((e) => e.read_status === 'read');

    // Total pages (read books with page count)
    const totalPages = readEntries.reduce((sum, e) => sum + (e.books?.pages ?? 0), 0);

    // Avg rating
    const rated = all.filter((e) => e.user_rating != null);
    const avgRating =
      rated.length > 0
        ? Math.round((rated.reduce((s, e) => s + e.user_rating, 0) / rated.length) * 10) / 10
        : null;

    // Books by year (year they were added)
    const byYear: Record<number, number> = {};
    readEntries.forEach((e) => {
      const y = new Date(e.added_at).getFullYear();
      byYear[y] = (byYear[y] ?? 0) + 1;
    });
    const booksByYear = Object.entries(byYear)
      .map(([year, count]) => ({ year: parseInt(year), count }))
      .sort((a, b) => a.year - b.year);

    // Top genres
    const genreMap: Record<string, number> = {};
    all.forEach((e) => {
      if (e.books?.genre) {
        genreMap[e.books.genre] = (genreMap[e.books.genre] ?? 0) + 1;
      }
    });
    const topGenres = Object.entries(genreMap)
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Most-read author
    const authorMap: Record<string, number> = {};
    all.forEach((e) => {
      if (e.books?.author) {
        authorMap[e.books.author] = (authorMap[e.books.author] ?? 0) + 1;
      }
    });
    const topAuthorEntry = Object.entries(authorMap).sort((a, b) => b[1] - a[1])[0];
    const mostReadAuthor = topAuthorEntry
      ? { name: topAuthorEntry[0], count: topAuthorEntry[1] }
      : null;

    // Longest book read
    const withPages = readEntries.filter((e) => e.books?.pages > 0);
    withPages.sort((a, b) => (b.books?.pages ?? 0) - (a.books?.pages ?? 0));
    const longestBookRead =
      withPages.length > 0
        ? { title: withPages[0].books.title, pages: withPages[0].books.pages }
        : null;

    // Current year progress — exclude imports since their dates aren't real.
    const currentYear = new Date().getFullYear();
    const currentYearCount = readEntries.filter(
      (e) => !e.from_import && new Date(e.added_at).getFullYear() === currentYear
    ).length;

    // Reading sessions
    let readingSpeeds: ReadingSpeeds | null = null;
    let totalReadingMinutes = 0;
    let totalSessions = 0;
    const { data: sessions } = await supabase
      .from('reading_sessions')
      .select('started_at, ended_at, pages_read, is_fiction')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .not('pages_read', 'is', null);
    if (sessions?.length) {
      readingSpeeds = computeReadingSpeeds(sessions);
      totalSessions = sessions.length;
      totalReadingMinutes = Math.round(sessions.reduce((sum: number, s: any) => {
        if (!s.started_at || !s.ended_at) return sum;
        return sum + (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000;
      }, 0));
    }

    setAllSessions(sessions || []);
    setSessionDates((sessions || []).map((s: any) => s.ended_at?.slice(0, 10)).filter(Boolean));

    // Challenges
    const { data: challengeData } = await supabase
      .from('reading_challenges')
      .select('*')
      .eq('user_id', user.id)
      .eq('year', new Date().getFullYear())
      .order('created_at', { ascending: false });
    setChallenges(challengeData || []);

    // Valuations
    const bookIds = all.map((e: any) => e.book_id).filter(Boolean);
    let totalListValue = 0, totalMarketValue = 0, listValueCount = 0;
    const gvMap: Record<string, number> = {};
    const svMap: Record<string, number> = {};
    const bvArr: { title: string; price: number }[] = [];
    if (bookIds.length) {
      const { data: vals } = await supabase.from('valuations').select('book_id, list_price, avg_price').in('book_id', bookIds);
      const vm: Record<string, any> = {};
      (vals || []).forEach((v: any) => { vm[v.book_id] = v; });
      for (const e of all) {
        const v = vm[(e as any).book_id];
        if (!v?.list_price) continue;
        const p = Number(v.list_price);
        totalListValue += p; listValueCount++;
        if (v.avg_price) totalMarketValue += Number(v.avg_price);
        const g = (e as any).books?.genre || 'Unknown';
        gvMap[g] = (gvMap[g] || 0) + p;
        const st = (e as any).read_status || 'owned';
        svMap[st] = (svMap[st] || 0) + p;
        bvArr.push({ title: (e as any).books?.title || 'Unknown', price: p });
      }
    }
    const topGenresByValue = Object.entries(gvMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([genre, value]) => ({ genre, value }));
    const topBooksByValue = bvArr.sort((a, b) => b.price - a.price).slice(0, 5);

    setStats({
      totalBooks: all.length,
      booksRead: readEntries.length,
      totalPages,
      avgRating,
      booksByYear,
      topGenres,
      mostReadAuthor,
      longestBookRead,
      currentYearCount,
      readingSpeeds,
      totalReadingMinutes,
      totalSessions,
      totalListValue,
      totalMarketValue,
      listValueCount,
      topGenresByValue,
      topBooksByValue,
      valueByStatus: svMap,
    });
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchStats().finally(() => setLoading(false));
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  if (!stats) {
    return (
      <View style={styles.loader}>
        <Text style={styles.errorText}>Could not load stats.</Text>
      </View>
    );
  }

  const maxBarCount = Math.max(...stats.booksByYear.map((b) => b.count), 1);
  const currentYear = new Date().getFullYear();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />
      }
    >
      {/* Stats cards */}
      <View style={styles.statsRow}>
        <StatCard label="Total Books" value={String(stats.totalBooks)} />
        <StatCard label="Books Read" value={String(stats.booksRead)} />
        <StatCard
          label="Total Pages"
          value={stats.totalPages > 0 ? stats.totalPages.toLocaleString() : '—'}
        />
        <StatCard
          label="Avg Rating"
          value={stats.avgRating != null ? `${stats.avgRating}/5` : '—'}
        />
      </View>

      {/* Collection value */}
      {stats.listValueCount > 0 && (
        <>
          <View style={styles.statsRow}>
            <StatCard label="Retail Value" value={`$${Math.round(stats.totalListValue).toLocaleString()}`} sub={`${stats.listValueCount} books`} />
            <StatCard label="Used Value" value={stats.totalMarketValue > 0 ? `$${Math.round(stats.totalMarketValue).toLocaleString()}` : '—'} sub="market avg" />
          </View>
          <Section title="Worth Breakdown">
            {stats.topGenresByValue.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>By Genre</Text>
                {stats.topGenresByValue.map((g) => (
                  <View key={g.genre} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12, color: Colors.ink, width: 100 }} numberOfLines={1}>{g.genre}</Text>
                    <View style={{ flex: 1, height: 10, backgroundColor: Colors.border, borderRadius: 5, overflow: 'hidden' }}>
                      <View style={{ height: '100%', backgroundColor: Colors.sage, borderRadius: 5, width: `${Math.round((g.value / stats.topGenresByValue[0].value) * 100)}%` }} />
                    </View>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.sage, width: 55, textAlign: 'right' }}>${Math.round(g.value)}</Text>
                  </View>
                ))}
              </View>
            )}
            {stats.topBooksByValue.length > 0 && (
              <View>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Most Valuable</Text>
                {stats.topBooksByValue.map((b, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12, color: Colors.muted, fontWeight: '600', width: 18 }}>{i + 1}.</Text>
                    <Text style={{ fontSize: 12, color: Colors.ink, flex: 1 }} numberOfLines={1}>{b.title}</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.sage }}>${b.price.toFixed(2)}</Text>
                  </View>
                ))}
              </View>
            )}
          </Section>
        </>
      )}

      {/* Books per year */}
      {stats.booksByYear.length > 0 && (
        <Section title="Books Read Per Year">
          {stats.booksByYear.map((b) => (
            <BarRow key={b.year} year={b.year} count={b.count} maxCount={maxBarCount} />
          ))}
        </Section>
      )}

      {/* Top genres */}
      {stats.topGenres.length > 0 && (
        <Section title="Top Genres">
          <View style={styles.genreRow}>
            {stats.topGenres.map((g) => (
              <View key={g.genre} style={styles.genreChip}>
                <Text style={styles.genreText}>
                  {g.genre}
                  <Text style={styles.genreCount}>  {g.count}</Text>
                </Text>
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* Reading speed */}
      {stats.readingSpeeds && (stats.readingSpeeds.fiction || stats.readingSpeeds.nonfiction) && (
        <Section title="Reading Speed">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
            <StatCard
              label="Fiction"
              value={stats.readingSpeeds.fiction ? `${stats.readingSpeeds.fiction.toFixed(1)}` : '—'}
              sub="pages/min"
            />
            <StatCard
              label="Nonfiction"
              value={stats.readingSpeeds.nonfiction ? `${stats.readingSpeeds.nonfiction.toFixed(1)}` : '—'}
              sub="pages/min"
            />
            <StatCard
              label="Time Tracked"
              value={formatDuration(stats.totalReadingMinutes)}
              sub="total"
            />
            <StatCard
              label="Sessions"
              value={String(stats.totalSessions)}
              sub="logged"
            />
          </View>
          <Text style={{ fontSize: 12, color: Colors.muted, fontStyle: 'italic' }}>
            Speed improves with more reading sessions
          </Text>
        </Section>
      )}

      {/* Reading Challenges */}
      <Section title="Challenges">
        <View style={{ gap: 10 }}>
          {challenges.filter(c => c.status === 'active').map(c => (
            <ChallengeCard
              key={c.id}
              challenge={c}
              progress={computeChallengeProgress(c, rawEntries, allSessions)}
              onDelete={async () => {
                await supabase.from('reading_challenges').delete().eq('id', c.id);
                setChallenges(prev => prev.filter(x => x.id !== c.id));
              }}
            />
          ))}
          {challenges.length === 0 && (
            <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center', paddingVertical: 12 }}>
              No challenges yet
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 4 }}>
            <TouchableOpacity
              onPress={() => setShowNewChallenge(true)}
              style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: Colors.rust }}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.white }}>+ New Challenge</Text>
            </TouchableOpacity>
            {challenges.filter(c => c.is_system && c.month === new Date().getMonth() + 1).length === 0 && rawEntries.length > 0 && (
              <TouchableOpacity
                onPress={async () => {
                  const { data: { user } } = await supabase.auth.getUser();
                  if (!user) return;
                  const suggestions = generateMonthlyChallenges(rawEntries, allSessions);
                  for (const s of suggestions) {
                    await supabase.from('reading_challenges').insert({ user_id: user.id, ...s });
                  }
                  const { data } = await supabase.from('reading_challenges').select('*').eq('user_id', user.id).eq('year', new Date().getFullYear()).order('created_at', { ascending: false });
                  setChallenges(data || []);
                }}
                style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: Colors.border }}
              >
                <Text style={{ fontSize: 12, color: Colors.rust }}>Auto-Generate</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Section>
      <NewChallengeModal
        visible={showNewChallenge}
        onClose={() => setShowNewChallenge(false)}
        onSave={async (challenge) => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          await supabase.from('reading_challenges').insert({ user_id: user.id, ...challenge });
          const { data } = await supabase.from('reading_challenges').select('*').eq('user_id', user.id).eq('year', new Date().getFullYear()).order('created_at', { ascending: false });
          setChallenges(data || []);
        }}
      />

      {/* Reading Activity Heatmap */}
      {sessionDates.length > 0 && (
        <Section title="Reading Activity">
          <ReadingHeatmap activityDates={[
            ...sessionDates,
            ...rawEntries.filter((e: any) => e.read_status === 'read' || e.read_status === 'reading').map((e: any) => e.added_at?.slice(0, 10)).filter(Boolean),
          ]} />
        </Section>
      )}

      {/* Reading Wrapped */}
      <ReadingWrapped entries={rawEntries} sessions={allSessions} year={new Date().getFullYear()} />

      {/* Reading highlights */}
      <Section title="Reading Highlights">
        <Highlight
          icon="📅"
          label={`${currentYear} Progress`}
          value={`${stats.currentYearCount} book${stats.currentYearCount !== 1 ? 's' : ''} read`}
        />
        {stats.mostReadAuthor && (
          <Highlight
            icon="✍️"
            label="Most-read Author"
            value={`${stats.mostReadAuthor.name} (${stats.mostReadAuthor.count} book${stats.mostReadAuthor.count !== 1 ? 's' : ''})`}
          />
        )}
        {stats.longestBookRead && (
          <Highlight
            icon="📖"
            label="Longest Book Read"
            value={`${stats.longestBookRead.title} — ${stats.longestBookRead.pages.toLocaleString()} pages`}
          />
        )}
      </Section>

      {stats.totalBooks === 0 && (
        <View style={styles.emptyHint}>
          <Text style={styles.emptyHintText}>
            Add books to your library and mark them as Read to build up your stats!
          </Text>
        </View>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  errorText: {
    fontSize: 15,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 28,
  },
  genreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genreChip: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  genreText: {
    fontSize: 13,
    color: Colors.ink,
    fontWeight: '500',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  genreCount: {
    fontSize: 12,
    color: Colors.rust,
    fontWeight: '700',
  },
  emptyHint: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginTop: 8,
  },
  emptyHintText: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});
