import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  stars_1?: number;
  stars_2?: number;
  stars_3?: number;
  stars_4?: number;
  stars_5?: number;
}

export default function RatingDistribution({ stars_1 = 0, stars_2 = 0, stars_3 = 0, stars_4 = 0, stars_5 = 0 }: Props) {
  const bars = [
    { label: '5', count: stars_5 },
    { label: '4', count: stars_4 },
    { label: '3', count: stars_3 },
    { label: '2', count: stars_2 },
    { label: '1', count: stars_1 },
  ];
  const maxCount = Math.max(...bars.map(b => b.count), 1);

  return (
    <View style={styles.container}>
      {bars.map(({ label, count }) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: count > 0 ? `${Math.max(4, (count / maxCount) * 100)}%` : '0%' }]} />
          </View>
          <Text style={styles.count}>{count}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 3, marginTop: 6, maxWidth: 180 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { fontSize: 10, color: Colors.muted, width: 10, textAlign: 'right' },
  track: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: Colors.gold, borderRadius: 3 },
  count: { fontSize: 10, color: Colors.muted, width: 16 },
});
