import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Platform,
} from 'react-native';
import { Stack } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
import BadgesSection, { computeMobileBadges } from '../components/BadgesSection';
import { computeLevelFromBadges } from '../lib/level';

export default function BadgesScreen() {
  const [entries, setEntries] = useState<any[]>([]);
  const [friendCount, setFriendCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: entriesData }, { count: fc }, { data: prof }] = await Promise.all([
      supabase
        .from('collection_entries')
        .select('*, books(*)')
        .eq('user_id', user.id),
      supabase
        .from('friendships')
        .select('id', { count: 'exact', head: true })
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq('status', 'accepted'),
      supabase.from('profiles').select('level, level_points').eq('id', user.id).maybeSingle(),
    ]);

    const rows = entriesData || [];
    setEntries(rows);
    setFriendCount(fc || 0);

    const badges = computeMobileBadges(rows, fc || 0);
    const info = computeLevelFromBadges(badges);
    if (prof?.level !== info.level || prof?.level_points !== info.points) {
      await supabase
        .from('profiles')
        .update({ level: info.level, level_points: info.points })
        .eq('id', user.id);
    }
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchData().finally(() => setLoading(false));
    }, [])
  );

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'My Badges' }} />
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.rust} />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'My Badges' }} />
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }}
            tintColor={Colors.rust}
          />
        }
      >
        <ReaderLevelCard entries={entries} friendCount={friendCount} />
        <BadgesSection entries={entries} friendCount={friendCount} />
      </ScrollView>
    </>
  );
}

function ReaderLevelCard({ entries, friendCount }: { entries: any[]; friendCount: number }) {
  const lvl = useMemo(
    () => computeLevelFromBadges(computeMobileBadges(entries, friendCount)),
    [entries, friendCount],
  );
  const toNext = lvl.isMax ? 0 : (lvl.nextLevelAt as number) - lvl.points;

  return (
    <View style={cardStyles.box}>
      <Text style={cardStyles.heading}>⭐️ Reader Level</Text>
      <View style={cardStyles.row}>
        <View style={[cardStyles.numberCircle, { backgroundColor: lvl.ring }]}>
          <Text style={cardStyles.numberText}>{lvl.level}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={cardStyles.title}>{lvl.title}</Text>
          <Text style={cardStyles.subtitle}>
            {lvl.points.toLocaleString()} points
            {lvl.isMax ? ' · max level reached 👑' : ` · ${toNext.toLocaleString()} until Level ${lvl.level + 1}`}
          </Text>
          <View style={cardStyles.barBg}>
            <View style={[cardStyles.barFill, { width: `${lvl.progressPct}%`, backgroundColor: lvl.ring }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  box: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0d8d0',
    padding: 18,
    marginBottom: 20,
  },
  heading: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontSize: 18,
    fontWeight: '700',
    color: '#2c1a0e',
    marginBottom: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  numberCircle: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  numberText: { fontSize: 24, fontWeight: '800', color: '#fff' },
  title: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontSize: 16,
    fontWeight: '700',
    color: '#2c1a0e',
  },
  subtitle: { fontSize: 11, color: '#8a7f72', marginTop: 2 },
  barBg: {
    height: 6,
    backgroundColor: '#e0d8d0',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 8,
  },
  barFill: { height: '100%', borderRadius: 3 },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
});
