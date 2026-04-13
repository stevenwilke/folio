import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

const TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  books_count: 'book',
  pages_count: 'book-outline',
  genre_diversity: 'color-palette',
  streak_days: 'flame',
};

interface Props {
  challenge: {
    id: string;
    title: string;
    description?: string | null;
    challenge_type: string;
    target_value: number;
    status: string;
  };
  progress: { currentValue: number; isComplete: boolean };
  onDelete?: () => void;
}

export default function ChallengeCard({ challenge, progress, onDelete }: Props) {
  const { currentValue, isComplete } = progress;
  const pct = Math.min(100, Math.round((currentValue / challenge.target_value) * 100));

  return (
    <View style={[styles.card, isComplete && styles.cardComplete]}>
      <View style={styles.header}>
        <Ionicons
          name={TYPE_ICONS[challenge.challenge_type] || 'flag'}
          size={20}
          color={isComplete ? Colors.sage : Colors.rust}
        />
        <View style={styles.headerText}>
          <Text style={styles.title}>
            {challenge.title}
            {isComplete && <Text style={styles.check}> ✓</Text>}
          </Text>
          {challenge.description ? (
            <Text style={styles.desc}>{challenge.description}</Text>
          ) : null}
        </View>
        {onDelete && (
          <TouchableOpacity onPress={onDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={16} color={Colors.muted} />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: isComplete ? Colors.sage : Colors.rust }]} />
      </View>
      <View style={styles.footer}>
        <Text style={styles.fraction}>{currentValue} / {challenge.target_value}</Text>
        <Text style={[styles.pct, { color: isComplete ? Colors.sage : Colors.rust }]}>{pct}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
  },
  cardComplete: { borderColor: Colors.sage },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  headerText: { flex: 1 },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  check: { color: Colors.sage },
  desc: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  track: { height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  fraction: { fontSize: 11, color: Colors.muted },
  pct: { fontSize: 11, fontWeight: '600' },
});
