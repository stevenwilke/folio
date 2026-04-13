import { View, Text, StyleSheet, TouchableOpacity, Image, Platform } from 'react-native';
import { Colors } from '../constants/colors';
import { formatDistance } from '../lib/geo';

const CONDITION_LABELS: Record<string, string> = {
  like_new: 'Like New', very_good: 'Very Good', good: 'Good', acceptable: 'Acceptable',
};
const CONDITION_COLORS: Record<string, string> = {
  like_new: Colors.sage, very_good: Colors.sage, good: Colors.gold, acceptable: Colors.rust,
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface Props {
  drop: any;
  distanceKm: number | null;
  onPress: () => void;
}

export default function BookDropCard({ drop, distanceKm, onPress }: Props) {
  const book = drop.books;
  return (
    <TouchableOpacity onPress={onPress} style={styles.card} activeOpacity={0.7}>
      <View style={styles.coverWrap}>
        {book?.cover_image_url ? (
          <Image source={{ uri: book.cover_image_url }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, { backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontSize: 10, color: Colors.muted, textAlign: 'center', paddingHorizontal: 4 }}>{book?.title}</Text>
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{book?.title}</Text>
        <Text style={styles.author} numberOfLines={1}>{book?.author}</Text>
        <View style={[styles.condBadge, { backgroundColor: `${CONDITION_COLORS[drop.condition]}18` }]}>
          <Text style={[styles.condText, { color: CONDITION_COLORS[drop.condition] }]}>{CONDITION_LABELS[drop.condition]}</Text>
        </View>
        <Text style={styles.location} numberOfLines={1}>📍 {drop.location_name}</Text>
        <View style={styles.footer}>
          {distanceKm != null && <Text style={styles.meta}>{formatDistance(distanceKm)}</Text>}
          <Text style={styles.meta}>{timeAgo(drop.created_at)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 10,
  },
  coverWrap: { width: 70 },
  cover: { width: 70, height: 105 },
  info: { flex: 1, padding: 10, justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600', color: Colors.ink, lineHeight: 18 },
  author: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  condBadge: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, marginTop: 4 },
  condText: { fontSize: 10, fontWeight: '600' },
  location: { fontSize: 11, color: Colors.muted, marginTop: 4 },
  footer: { flexDirection: 'row', gap: 8, marginTop: 2 },
  meta: { fontSize: 10, color: Colors.muted },
});
