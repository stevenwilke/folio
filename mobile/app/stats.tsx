import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';

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

  async function fetchStats() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: entries } = await supabase
      .from('collection_entries')
      .select(`
        id, read_status, user_rating, added_at,
        books ( id, title, author, genre, pages, published_year )
      `)
      .eq('user_id', user.id);

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

    // Current year progress
    const currentYear = new Date().getFullYear();
    const currentYearCount = readEntries.filter(
      (e) => new Date(e.added_at).getFullYear() === currentYear
    ).length;

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
