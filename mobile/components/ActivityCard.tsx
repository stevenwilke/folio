import { View, Text, StyleSheet, Platform } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  pagesRead: number;
  durationMin: number;
  speedPpm: number | null;
  startPage?: number;
  endPage?: number;
  totalPages?: number | null;
}

export default function ActivityCard({ pagesRead, durationMin, speedPpm, startPage, endPage, totalPages }: Props) {
  const durLabel = durationMin >= 60
    ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
    : `${durationMin} min`;
  const pct = totalPages && endPage ? Math.min(100, Math.round((endPage / totalPages) * 100)) : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerIcon}>📖</Text>
        <Text style={styles.headerText}>Reading Session</Text>
      </View>
      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{pagesRead}</Text>
          <Text style={styles.statLabel}>Pages</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{durLabel}</Text>
          <Text style={styles.statLabel}>Time</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{speedPpm ? `${speedPpm}` : '—'}</Text>
          <Text style={styles.statLabel}>Pages/min</Text>
        </View>
      </View>
      {pct != null && (
        <View style={styles.progressSection}>
          <View style={styles.progressLabels}>
            <Text style={styles.progressText}>p.{startPage} → p.{endPage}</Text>
            <Text style={styles.progressText}>{pct}% complete</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct}%` }]} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(90,122,90,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(90,122,90,0.12)',
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  headerIcon: { fontSize: 18 },
  headerText: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  statRow: { flexDirection: 'row', marginBottom: 10 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  statLabel: { fontSize: 10, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 },
  progressSection: { marginTop: 2 },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  progressText: { fontSize: 11, color: Colors.muted },
  track: { height: 6, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: Colors.sage, borderRadius: 3 },
});
