import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter, Stack } from 'expo-router';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
import NotificationRow from '../components/NotificationRow';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchNotifications() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifications(data || []);
  }

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchNotifications().finally(() => setLoading(false));
  }, []));

  async function onRefresh() {
    setRefreshing(true);
    await fetchNotifications();
    setRefreshing(false);
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  }

  async function markAllRead() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  }

  const unreadCount = notifications.filter(n => !n.is_read).length;

  function handleNotifPress(n: Notification) {
    markRead(n.id);
    if (n.link) {
      // Convert web links to mobile routes
      if (n.link.startsWith('/profile/')) router.push(n.link as any);
      else if (n.link === '/loans') router.push('/(tabs)/loans');
      else if (n.link === '/nearby') router.push('/nearby' as any);
      else if (n.link.startsWith('/?book=')) router.push(`/book/${n.link.split('=')[1]}`);
      else router.push('/(tabs)');
    }
  }

  if (loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.rust} /></View>;
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Notifications', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.ink }} />
      {unreadCount > 0 && (
        <TouchableOpacity onPress={markAllRead} style={styles.markAllBtn}>
          <Text style={styles.markAllText}>Mark all as read ({unreadCount})</Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={notifications}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <NotificationRow
            notification={item}
            onPress={() => handleNotifPress(item)}
            onDismiss={() => markRead(item.id)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptyDesc}>No notifications to show right now.</Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  markAllBtn: { alignSelf: 'flex-end', paddingHorizontal: 16, paddingVertical: 10 },
  markAllText: { fontSize: 12, color: Colors.rust, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.ink, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), marginBottom: 4 },
  emptyDesc: { fontSize: 14, color: Colors.muted },
});
