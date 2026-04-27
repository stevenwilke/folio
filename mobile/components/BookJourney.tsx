import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
import { haversineKm, formatDistance } from '../lib/geo';
import { useUnits } from '../lib/units';

const STATUS_COLORS: Record<string, string> = {
  available: Colors.sage, claimed: Colors.gold, collected: Colors.rust, expired: Colors.muted,
};
const STATUS_LABELS: Record<string, string> = {
  available: 'Available', claimed: 'Claimed', collected: 'Collected', expired: 'Expired',
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface Props {
  bookId: string;
}

export default function BookJourney({ bookId }: Props) {
  const [units] = useUnits();
  const [drops, setDrops] = useState<any[]>([]);

  useEffect(() => {
    if (!bookId) return;
    (async () => {
      const { data } = await supabase
        .from('book_drops')
        .select('*, profiles:user_id(username), claimer:claimed_by(username)')
        .eq('book_id', bookId)
        .order('created_at', { ascending: true });
      setDrops(data || []);
    })();
  }, [bookId]);

  if (drops.length === 0) return null;

  let totalKm = 0;
  for (let i = 1; i < drops.length; i++) {
    totalKm += haversineKm(drops[i - 1].latitude, drops[i - 1].longitude, drops[i].latitude, drops[i].longitude);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerIcon}>🗺️</Text>
        <View>
          <Text style={styles.headerTitle}>Book Journey</Text>
          <Text style={styles.headerSub}>
            {drops.length} location{drops.length !== 1 ? 's' : ''}
            {totalKm > 0 ? ` · Traveled ${formatDistance(totalKm, units)}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.timeline}>
        {drops.map((drop, i) => {
          const dist = i > 0 ? haversineKm(drops[i - 1].latitude, drops[i - 1].longitude, drop.latitude, drop.longitude) : null;
          return (
            <View key={drop.id} style={styles.node}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLORS[drop.status] || Colors.muted }]} />
              {dist != null && dist > 0 && (
                <Text style={styles.distLabel}>↳ {formatDistance(dist, units)}</Text>
              )}
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <Text style={styles.location}>📍 {drop.location_name}</Text>
                  <View style={[styles.badge, { backgroundColor: `${STATUS_COLORS[drop.status]}18` }]}>
                    <Text style={[styles.badgeText, { color: STATUS_COLORS[drop.status] }]}>
                      {STATUS_LABELS[drop.status]}
                    </Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  Freed by {drop.profiles?.username || 'unknown'} · {timeAgo(drop.created_at)}
                </Text>
                {drop.claimer?.username && (
                  <Text style={styles.claimed}>Claimed by {drop.claimer.username}</Text>
                )}
                {drop.note && <Text style={styles.note}>"{drop.note}"</Text>}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  headerIcon: { fontSize: 20 },
  headerTitle: { fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), fontSize: 17, fontWeight: '700', color: Colors.ink },
  headerSub: { fontSize: 12, color: Colors.muted },
  timeline: { paddingLeft: 16, borderLeftWidth: 2, borderLeftColor: Colors.border },
  node: { position: 'relative', marginBottom: 16 },
  dot: { position: 'absolute', left: -22, top: 4, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: Colors.background },
  distLabel: { fontSize: 10, color: Colors.muted, fontStyle: 'italic', marginBottom: 4 },
  card: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 10 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  location: { fontSize: 13, fontWeight: '600', color: Colors.ink, flex: 1 },
  badge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: '600' },
  meta: { fontSize: 12, color: Colors.muted, marginTop: 4 },
  claimed: { fontSize: 12, color: Colors.gold, marginTop: 2 },
  note: { fontSize: 12, color: Colors.muted, marginTop: 4, fontStyle: 'italic' },
});
