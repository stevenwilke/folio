import { View, Text, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';

interface Entry {
  has_read?: boolean;
  read_status?: string;
  updated_at?: string;
  from_import?: boolean;
  books?: { title?: string; author?: string | null; genre?: string | null; pages?: number | null } | null;
}

interface Session {
  status?: string;
  ended_at?: string | null;
  started_at?: string | null;
  pages_read?: number | null;
}

interface Props {
  entries: Entry[];
  sessions: Session[];
  year: number;
}

export default function ReadingWrapped({ entries, sessions, year }: Props) {
  const readEntries = entries.filter(e => {
    if (e.from_import) return false;
    if (!e.has_read && e.read_status !== 'read') return false;
    return new Date(e.updated_at || '').getFullYear() === year;
  });

  const yearSessions = sessions.filter(s => {
    if (s.status !== 'completed' || !s.ended_at) return false;
    return new Date(s.ended_at).getFullYear() === year;
  });

  const totalBooks = readEntries.length;
  if (totalBooks === 0) return null;

  const totalPages = readEntries.reduce((sum, e) => sum + (e.books?.pages || 0), 0);
  const totalMinutes = yearSessions.reduce((sum, s) => {
    if (!s.started_at || !s.ended_at) return sum;
    return sum + (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000;
  }, 0);
  const totalHours = Math.round(totalMinutes / 60);

  const genreMap: Record<string, number> = {};
  readEntries.forEach(e => {
    const g = e.books?.genre || 'Unknown';
    genreMap[g] = (genreMap[g] || 0) + 1;
  });
  const favGenre = Object.entries(genreMap).sort((a, b) => b[1] - a[1])[0];

  const authorMap: Record<string, number> = {};
  readEntries.forEach(e => {
    const a = e.books?.author || 'Unknown';
    authorMap[a] = (authorMap[a] || 0) + 1;
  });
  const favAuthor = Object.entries(authorMap).sort((a, b) => b[1] - a[1])[0];

  const topGenres = Object.entries(genreMap).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g);
  const personality = topGenres.length >= 2
    ? `The ${topGenres[0]} & ${topGenres[1]} Enthusiast`
    : topGenres.length === 1 ? `The ${topGenres[0]} Devotee` : 'The Explorer';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerIcon}>📖</Text>
        <View>
          <Text style={styles.headerTitle}>{year} Reading Wrapped</Text>
          <Text style={styles.personality}>{personality}</Text>
        </View>
      </View>

      <View style={styles.statRow}>
        <StatBox value={String(totalBooks)} label="Books" />
        <StatBox value={totalPages.toLocaleString()} label="Pages" />
        <StatBox value={String(totalHours)} label="Hours" />
        <StatBox value={String(Object.keys(genreMap).length)} label="Genres" />
      </View>

      <View style={styles.detailRow}>
        {favGenre && (
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Top Genre</Text>
            <Text style={styles.detailValue}>{favGenre[0]}</Text>
            <Text style={styles.detailSub}>{favGenre[1]} books</Text>
          </View>
        )}
        {favAuthor && (
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Top Author</Text>
            <Text style={styles.detailValue} numberOfLines={1}>{favAuthor[0]}</Text>
            <Text style={styles.detailSub}>{favAuthor[1]} books</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 18,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  headerIcon: { fontSize: 24 },
  headerTitle: { fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), fontSize: 18, fontWeight: '700', color: Colors.ink },
  personality: { fontSize: 13, color: Colors.gold, fontWeight: '600', fontStyle: 'italic', marginTop: 2 },
  statRow: { flexDirection: 'row', marginBottom: 14 },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), fontSize: 24, fontWeight: '700', color: Colors.ink },
  statLabel: { fontSize: 10, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 },
  detailRow: { flexDirection: 'row', gap: 10 },
  detailCard: { flex: 1, backgroundColor: Colors.background, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Colors.border },
  detailLabel: { fontSize: 10, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  detailValue: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  detailSub: { fontSize: 12, color: Colors.muted, marginTop: 2 },
});
