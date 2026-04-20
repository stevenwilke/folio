import React, { useCallback, useState } from 'react';
import {
  View,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
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
        <BadgesSection entries={entries} friendCount={friendCount} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
});
