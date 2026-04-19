import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
import { unblockUser } from '../lib/moderation';

interface BlockedUser {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

export default function BlockedUsersScreen() {
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setUsers([]); setLoading(false); return; }
    const { data } = await supabase
      .from('user_blocks')
      .select('blocked_id, profiles:blocked_id(id, username, avatar_url)')
      .eq('blocker_id', user.id)
      .order('created_at', { ascending: false });
    setUsers(((data || []) as any[]).map(r => r.profiles).filter(Boolean));
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  async function handleUnblock(u: BlockedUser) {
    Alert.alert(
      'Unblock user?',
      `${u.username || 'This user'} will be able to see your content and contact you again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unblock', onPress: async () => {
          setActing(u.id);
          await unblockUser(u.id);
          setActing(null);
          load();
        }},
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.loader}>
        <Stack.Screen options={{ title: 'Blocked Users' }} />
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Blocked Users', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.ink }} />
      <FlatList
        data={users}
        keyExtractor={item => item.id}
        contentContainerStyle={users.length === 0 && styles.emptyContainer}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🚫</Text>
            <Text style={styles.emptyTitle}>No blocked users</Text>
            <Text style={styles.emptySub}>Users you block will appear here. Block from any profile.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(item.username || '?').charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.username}>{item.username || 'Unknown'}</Text>
            <TouchableOpacity
              style={styles.unblockBtn}
              onPress={() => handleUnblock(item)}
              disabled={acting === item.id}
            >
              <Text style={styles.unblockBtnText}>{acting === item.id ? '…' : 'Unblock'}</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.background },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:  { alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: {
    fontSize: 18, fontWeight: '700', color: Colors.ink, marginBottom: 6,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  emptySub: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.rust,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  username: { flex: 1, fontSize: 15, color: Colors.ink, fontWeight: '600' },
  unblockBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  unblockBtnText: { color: Colors.ink, fontSize: 13, fontWeight: '600' },
});
