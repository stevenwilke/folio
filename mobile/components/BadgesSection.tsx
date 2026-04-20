import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from 'react-native';
import { Colors } from '../constants/colors';

// ─── Badge definitions (mirrors src/lib/badges.js) ────────────────────────────

interface BadgeData {
  entries: any[];
  friendCount: number;
}

const readEntries   = (d: BadgeData) => d.entries.filter(e => e.read_status === 'read');
const reviewEntries = (d: BadgeData) => d.entries.filter(e => e.review_text);
const ratedEntries  = (d: BadgeData) => d.entries.filter(e => e.user_rating > 0);

function uniqueGenres(d: BadgeData) {
  return new Set(readEntries(d).map(e => e.books?.genre).filter(Boolean));
}
function totalPages(d: BadgeData) {
  return readEntries(d).reduce((sum: number, e: any) => sum + (e.books?.pages || 0), 0);
}
function longestBook(d: BadgeData) {
  const pages = readEntries(d).map((e: any) => e.books?.pages || 0);
  return pages.length ? Math.max(...pages) : 0;
}
function uniqueAuthors(d: BadgeData) {
  return new Set(readEntries(d).map(e => e.books?.author).filter(Boolean));
}
function seriesGroups(d: BadgeData) {
  const map: Record<string, number> = {};
  for (const e of readEntries(d)) {
    const s = e.books?.series_name;
    if (s) map[s] = (map[s] || 0) + 1;
  }
  return Object.values(map);
}
function activeMonths(d: BadgeData) {
  return new Set(d.entries.map((e: any) => e.added_at?.slice(0, 7)).filter(Boolean));
}

interface BadgeDef {
  id: string; emoji: string; name: string; desc: string;
  category: string; tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  check: (d: BadgeData) => boolean;
  progress: (d: BadgeData) => { value: number; max: number; label: string };
}

const BADGE_DEFS: BadgeDef[] = [
  // Reading Milestones
  { id: 'first_read',  emoji: '🌱', name: 'First Chapter',    desc: 'Finish your first book',      category: 'Reading Milestones', tier: 'bronze',
    check: d => readEntries(d).length >= 1,   progress: d => ({ value: readEntries(d).length,   max: 1,   label: 'books read' }) },
  { id: 'bookworm',    emoji: '📚', name: 'Bookworm',          desc: 'Read 10 books',               category: 'Reading Milestones', tier: 'bronze',
    check: d => readEntries(d).length >= 10,  progress: d => ({ value: readEntries(d).length,   max: 10,  label: 'books read' }) },
  { id: 'devoted',     emoji: '📖', name: 'Devoted Reader',    desc: 'Read 50 books',               category: 'Reading Milestones', tier: 'silver',
    check: d => readEntries(d).length >= 50,  progress: d => ({ value: readEntries(d).length,   max: 50,  label: 'books read' }) },
  { id: 'century',     emoji: '🏆', name: 'Century Club',      desc: 'Read 100 books',              category: 'Reading Milestones', tier: 'gold',
    check: d => readEntries(d).length >= 100, progress: d => ({ value: readEntries(d).length,   max: 100, label: 'books read' }) },
  { id: 'legendary',   emoji: '👑', name: 'Legendary',         desc: 'Read 500 books',              category: 'Reading Milestones', tier: 'platinum',
    check: d => readEntries(d).length >= 500, progress: d => ({ value: readEntries(d).length,   max: 500, label: 'books read' }) },
  // Pages
  { id: 'page_turner', emoji: '📄', name: 'Page Turner',       desc: 'Read 1,000 pages',            category: 'Pages Read', tier: 'bronze',
    check: d => totalPages(d) >= 1000,   progress: d => ({ value: totalPages(d), max: 1000,  label: 'pages' }) },
  { id: 'marathon',    emoji: '🏃', name: 'Marathon Reader',    desc: 'Read 10,000 pages',           category: 'Pages Read', tier: 'silver',
    check: d => totalPages(d) >= 10000,  progress: d => ({ value: totalPages(d), max: 10000, label: 'pages' }) },
  { id: 'page_legend', emoji: '🌋', name: 'Page Legend',        desc: 'Read 50,000 pages',           category: 'Pages Read', tier: 'gold',
    check: d => totalPages(d) >= 50000,  progress: d => ({ value: totalPages(d), max: 50000, label: 'pages' }) },
  // Deep Reads
  { id: 'deep_diver',  emoji: '🔍', name: 'Deep Diver',         desc: 'Finish a book over 500 pages', category: 'Deep Reads', tier: 'bronze',
    check: d => longestBook(d) >= 500,  progress: d => ({ value: Math.min(longestBook(d), 500),  max: 500,  label: 'pages in longest book' }) },
  { id: 'tome_tamer',  emoji: '🗿', name: 'Tome Tamer',          desc: 'Finish a book over 800 pages', category: 'Deep Reads', tier: 'silver',
    check: d => longestBook(d) >= 800,  progress: d => ({ value: Math.min(longestBook(d), 800),  max: 800,  label: 'pages in longest book' }) },
  { id: 'epic_reader', emoji: '⚔️', name: 'Epic Reader',         desc: 'Finish a book over 1,000 pages', category: 'Deep Reads', tier: 'gold',
    check: d => longestBook(d) >= 1000, progress: d => ({ value: Math.min(longestBook(d), 1000), max: 1000, label: 'pages in longest book' }) },
  // Genres
  { id: 'genre_curious', emoji: '🎨', name: 'Genre Curious',   desc: 'Read books in 3 genres',      category: 'Genres', tier: 'bronze',
    check: d => uniqueGenres(d).size >= 3,  progress: d => ({ value: uniqueGenres(d).size, max: 3,  label: 'genres' }) },
  { id: 'explorer',     emoji: '🎭', name: 'Genre Explorer',    desc: 'Read books in 5 genres',      category: 'Genres', tier: 'silver',
    check: d => uniqueGenres(d).size >= 5,  progress: d => ({ value: uniqueGenres(d).size, max: 5,  label: 'genres' }) },
  { id: 'omnivore',     emoji: '🌍', name: 'Genre Omnivore',    desc: 'Read books in 10 genres',     category: 'Genres', tier: 'gold',
    check: d => uniqueGenres(d).size >= 10, progress: d => ({ value: uniqueGenres(d).size, max: 10, label: 'genres' }) },
  // Reviews & Ratings
  { id: 'opinionated', emoji: '💬', name: 'Opinionated',        desc: 'Rate your first book',        category: 'Reviews & Ratings', tier: 'bronze',
    check: d => ratedEntries(d).length >= 1,  progress: d => ({ value: ratedEntries(d).length,  max: 1,  label: 'rated' }) },
  { id: 'critic',      emoji: '✍️', name: 'Critic',             desc: 'Write 10 reviews',            category: 'Reviews & Ratings', tier: 'silver',
    check: d => reviewEntries(d).length >= 10, progress: d => ({ value: reviewEntries(d).length, max: 10, label: 'reviews' }) },
  { id: 'chief_critic',emoji: '🎓', name: 'Chief Critic',       desc: 'Write 25 reviews',            category: 'Reviews & Ratings', tier: 'gold',
    check: d => reviewEntries(d).length >= 25, progress: d => ({ value: reviewEntries(d).length, max: 25, label: 'reviews' }) },
  // Social
  { id: 'connected',   emoji: '🤝', name: 'Connected',          desc: 'Add your first friend',       category: 'Social', tier: 'bronze',
    check: d => d.friendCount >= 1,  progress: d => ({ value: d.friendCount, max: 1,  label: 'friends' }) },
  { id: 'social',      emoji: '🦋', name: 'Social Butterfly',   desc: 'Make 10 friends',             category: 'Social', tier: 'silver',
    check: d => d.friendCount >= 10, progress: d => ({ value: d.friendCount, max: 10, label: 'friends' }) },
  { id: 'connector',   emoji: '🌐', name: 'Super Connector',    desc: 'Make 25 friends',             category: 'Social', tier: 'gold',
    check: d => d.friendCount >= 25, progress: d => ({ value: d.friendCount, max: 25, label: 'friends' }) },
  // Series
  { id: 'series_starter',  emoji: '📎', name: 'Series Starter',  desc: 'Read 2 books in same series',  category: 'Series', tier: 'bronze',
    check: d => seriesGroups(d).some(n => n >= 2), progress: d => ({ value: Math.max(0, ...seriesGroups(d), 0), max: 2, label: 'books in best series' }) },
  { id: 'series_devotee',  emoji: '🔗', name: 'Series Devotee',   desc: 'Read 5 books in same series',  category: 'Series', tier: 'silver',
    check: d => seriesGroups(d).some(n => n >= 5), progress: d => ({ value: Math.max(0, ...seriesGroups(d), 0), max: 5, label: 'books in best series' }) },
  // Collection & Habits
  { id: 'completionist', emoji: '🌟', name: 'Completionist',   desc: 'Books in all 4 statuses',     category: 'Collection & Habits', tier: 'silver',
    check: d => { const ss = new Set(d.entries.map(e => e.read_status)); return ['owned','reading','read','want'].every(s => ss.has(s)); },
    progress: d => { const ss = new Set(d.entries.map(e => e.read_status)); return { value: ['owned','reading','read','want'].filter(s => ss.has(s)).length, max: 4, label: 'statuses used' }; } },
  { id: 'collector',    emoji: '🗄️', name: 'Collector',         desc: 'Add 50 books to library',    category: 'Collection & Habits', tier: 'silver',
    check: d => d.entries.length >= 50,   progress: d => ({ value: d.entries.length, max: 50,  label: 'books in library' }) },
  { id: 'bibliophile',  emoji: '🏛️', name: 'Bibliophile',       desc: 'Add 200 books to library',   category: 'Collection & Habits', tier: 'gold',
    check: d => d.entries.length >= 200,  progress: d => ({ value: d.entries.length, max: 200, label: 'books in library' }) },
  { id: 'well_read',    emoji: '🧭', name: 'Well Read',          desc: 'Read books by 10 authors',   category: 'Collection & Habits', tier: 'silver',
    check: d => uniqueAuthors(d).size >= 10, progress: d => ({ value: uniqueAuthors(d).size, max: 10, label: 'authors read' }) },
  { id: 'monthly_habit',emoji: '📅', name: 'Monthly Habit',      desc: 'Add books in 6 different months', category: 'Collection & Habits', tier: 'bronze',
    check: d => activeMonths(d).size >= 6, progress: d => ({ value: activeMonths(d).size, max: 6, label: 'active months' }) },
];

const CATEGORIES = [
  'Reading Milestones', 'Pages Read', 'Deep Reads',
  'Genres', 'Reviews & Ratings', 'Social', 'Series', 'Collection & Habits',
];

const TIER: Record<string, { bg: string; border: string; text: string; label: string }> = {
  bronze:   { bg: 'rgba(180,100,40,0.12)',  border: 'rgba(180,100,40,0.35)',  text: '#a05a20', label: 'Bronze'   },
  silver:   { bg: 'rgba(120,120,140,0.12)', border: 'rgba(120,120,140,0.35)', text: '#6a6a88', label: 'Silver'   },
  gold:     { bg: 'rgba(184,134,11,0.14)',  border: 'rgba(184,134,11,0.40)',  text: '#a07808', label: 'Gold'     },
  platinum: { bg: 'rgba(80,160,160,0.12)',  border: 'rgba(80,160,160,0.35)', text: '#2a9090', label: 'Platinum' },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  entries: any[];
  friendCount: number;
}

export type ComputedBadge = BadgeDef & {
  earned: boolean;
  prog: { value: number; max: number; label: string };
  pct: number;
};

export function computeMobileBadges(entries: any[], friendCount: number): ComputedBadge[] {
  const data: BadgeData = { entries, friendCount };
  return BADGE_DEFS.map(b => {
    const earned = b.check(data);
    const prog   = b.progress(data);
    const pct    = Math.min(100, Math.round((prog.value / prog.max) * 100));
    return { ...b, earned, prog, pct };
  });
}

export default function BadgesSection({ entries, friendCount }: Props) {
  const [selected, setSelected] = useState<ComputedBadge | null>(null);

  const badges = useMemo<ComputedBadge[]>(
    () => computeMobileBadges(entries, friendCount),
    [entries, friendCount],
  );

  const earnedCount = badges.filter(b => b.earned).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headRow}>
        <Text style={styles.heading}>🏅 Badges & Trophies</Text>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{earnedCount} / {badges.length}</Text>
        </View>
      </View>

      <BadgeDetailModal badge={selected} onClose={() => setSelected(null)} />

      {CATEGORIES.map(cat => {
        const catBadges = badges.filter(b => b.category === cat);
        if (!catBadges.length) return null;
        return (
          <View key={cat} style={styles.category}>
            <Text style={styles.catLabel}>{cat}</Text>
            <View style={styles.grid}>
              {catBadges.map(b => {
                const ts = TIER[b.tier];
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setSelected(b)}
                    accessibilityRole="button"
                    accessibilityLabel={`${b.name} details`}
                    style={({ pressed }) => [
                      styles.card,
                      {
                        backgroundColor: b.earned ? ts.bg : 'rgba(240,236,230,0.5)',
                        borderColor:     b.earned ? ts.border : '#e0d8d0',
                        opacity:         pressed ? 0.6 : (b.earned ? 1 : 0.72),
                      },
                    ]}
                  >
                    <Text style={styles.emoji}>{b.earned ? b.emoji : '🔒'}</Text>
                    <Text style={styles.cardName}>{b.name}</Text>
                    <Text style={styles.cardDesc}>{b.desc}</Text>
                    {b.earned ? (
                      <View style={[styles.tierPill, { backgroundColor: ts.bg, borderColor: ts.border }]}>
                        <Text style={[styles.tierPillText, { color: ts.text }]}>{ts.label}</Text>
                      </View>
                    ) : (
                      <View style={styles.progressWrap}>
                        <View style={styles.progressBg}>
                          <View style={[styles.progressFill, { width: `${b.pct}%` as any, backgroundColor: ts.text }]} />
                        </View>
                        <Text style={styles.progressLabel}>
                          {b.prog.value.toLocaleString()} / {b.prog.max.toLocaleString()} {b.prog.label}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Badge detail modal ──────────────────────────────────────────────────────

function BadgeDetailModal({ badge, onClose }: { badge: ComputedBadge | null; onClose: () => void }) {
  const visible = !!badge;
  const ts = badge ? TIER[badge.tier] : TIER.bronze;
  const overflow = badge && badge.earned ? Math.max(0, badge.prog.value - badge.prog.max) : 0;
  const remaining = badge && !badge.earned ? Math.max(0, badge.prog.max - badge.prog.value) : 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={detailStyles.backdrop} onPress={onClose}>
        <Pressable style={detailStyles.sheet} onPress={() => {}}>
          {badge && (
            <ScrollView contentContainerStyle={detailStyles.scroll} showsVerticalScrollIndicator={false}>
              <Pressable onPress={onClose} style={detailStyles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={detailStyles.closeTxt}>×</Text>
              </Pressable>

              <View style={[
                detailStyles.emojiCircle,
                { backgroundColor: badge.earned ? ts.bg : '#f0ece6', borderColor: badge.earned ? ts.border : '#e0d8d0' },
              ]}>
                <Text style={detailStyles.bigEmoji}>{badge.earned ? badge.emoji : '🔒'}</Text>
              </View>

              <Text style={detailStyles.title}>{badge.name}</Text>

              <View style={detailStyles.pillRow}>
                <View style={[detailStyles.pill, { backgroundColor: ts.bg, borderColor: ts.border }]}>
                  <Text style={[detailStyles.pillTxt, { color: ts.text }]}>{ts.label}</Text>
                </View>
                <View style={[detailStyles.pill, { backgroundColor: '#f0ece6', borderColor: '#e0d8d0' }]}>
                  <Text style={[detailStyles.pillTxt, { color: '#8a7f72' }]}>{badge.category}</Text>
                </View>
              </View>

              <Text style={detailStyles.desc}>{badge.desc}</Text>

              <View style={detailStyles.progressBlock}>
                <Text style={detailStyles.progressHead}>
                  {badge.earned ? 'Earned' : 'Progress'}
                </Text>
                <View style={detailStyles.progressBarBg}>
                  <View style={[detailStyles.progressBarFill, { width: `${badge.pct}%` as any, backgroundColor: ts.text }]} />
                </View>
                <Text style={detailStyles.progressNums}>
                  <Text style={{ fontWeight: '700', color: '#2c1a0e' }}>{badge.prog.value.toLocaleString()}</Text>
                  <Text style={{ color: '#8a7f72' }}> / {badge.prog.max.toLocaleString()} {badge.prog.label}</Text>
                </Text>
                {badge.earned && overflow > 0 && (
                  <Text style={[detailStyles.progressNote, { color: ts.text }]}>
                    {overflow.toLocaleString()} beyond the requirement — nice.
                  </Text>
                )}
                {!badge.earned && remaining > 0 && (
                  <Text style={detailStyles.progressNote}>
                    {remaining.toLocaleString()} more {badge.prog.label} to unlock.
                  </Text>
                )}
              </View>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const detailStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  scroll: {
    padding: 24,
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 8,
    right: 12,
    padding: 6,
    zIndex: 2,
  },
  closeTxt: { fontSize: 26, lineHeight: 26, color: '#8a7f72' },
  emojiCircle: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  bigEmoji: { fontSize: 48, lineHeight: 56 },
  title: {
    fontFamily: 'Georgia',
    fontSize: 20,
    fontWeight: '700',
    color: '#2c1a0e',
    marginBottom: 8,
    textAlign: 'center',
  },
  pillRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 14,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillTxt: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  desc: {
    fontSize: 14,
    color: '#2c1a0e',
    lineHeight: 20,
    marginBottom: 18,
    textAlign: 'center',
  },
  progressBlock: {
    alignSelf: 'stretch',
    backgroundColor: '#f7f4ef',
    borderWidth: 1,
    borderColor: '#e0d8d0',
    borderRadius: 10,
    padding: 14,
  },
  progressHead: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#8a7f72',
    marginBottom: 8,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#e0d8d0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: { height: '100%', borderRadius: 3 },
  progressNums: { fontSize: 13 },
  progressNote: { fontSize: 12, color: '#8a7f72', marginTop: 6 },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0d8d0',
    padding: 18,
    marginBottom: 20,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  heading: {
    fontFamily: 'Georgia',
    fontSize: 18,
    fontWeight: '700',
    color: '#2c1a0e',
    flex: 1,
  },
  countPill: {
    backgroundColor: '#f0ece6',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  countPillText: {
    fontSize: 11,
    color: '#8a7f72',
  },

  category: { marginBottom: 20 },
  catLabel: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#8a7f72',
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    width: '47%',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    alignItems: 'center',
    gap: 3,
  },
  emoji: { fontSize: 26, lineHeight: 32 },
  cardName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2c1a0e',
    textAlign: 'center',
    lineHeight: 14,
  },
  cardDesc: {
    fontSize: 9,
    color: '#8a7f72',
    textAlign: 'center',
    lineHeight: 12,
  },
  tierPill: {
    marginTop: 4,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderWidth: 1,
  },
  tierPillText: {
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressWrap: { width: '100%', marginTop: 4 },
  progressBg: {
    height: 3,
    backgroundColor: '#e0d8d0',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 2,
  },
  progressFill: { height: '100%', borderRadius: 2 },
  progressLabel: {
    fontSize: 8,
    color: '#a09888',
    textAlign: 'center',
  },
});
