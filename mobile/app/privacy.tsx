import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Switch, Alert, ScrollView, Platform,
} from 'react-native';
import { Stack } from 'expo-router';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';

export default function PrivacyScreen() {
  const [loading, setLoading]   = useState(true);
  const [isPrivate, setPrivate] = useState(false);
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from('profiles')
      .select('is_private')
      .eq('id', user.id)
      .maybeSingle();
    setPrivate(!!data?.is_private);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setMode(wantPrivate: boolean) {
    setSaving(true);
    const { data, error } = await supabase.rpc('set_private_mode', { p_private: wantPrivate });
    setSaving(false);
    if (error) {
      Alert.alert('Could not update privacy', error.message || 'Please try again.');
      return;
    }
    setPrivate(wantPrivate);
    if (wantPrivate && data) {
      const parts: string[] = [];
      if (data.clubs_demoted)             parts.push(`${data.clubs_demoted} club admin role${data.clubs_demoted === 1 ? '' : 's'} transferred`);
      if (data.clubs_disbanded)           parts.push(`${data.clubs_disbanded} solo club${data.clubs_disbanded === 1 ? '' : 's'} disbanded`);
      if (data.friend_requests_cancelled) parts.push(`${data.friend_requests_cancelled} friend request${data.friend_requests_cancelled === 1 ? '' : 's'} cancelled`);
      if (data.buddy_invites_declined)    parts.push(`${data.buddy_invites_declined} buddy-read invite${data.buddy_invites_declined === 1 ? '' : 's'} declined`);
      if (parts.length) {
        Alert.alert('Private mode enabled', parts.join('\n'));
      }
    }
  }

  function handleToggle(val: boolean) {
    if (!val) {
      // Going public — no confirmation needed
      setMode(false);
      return;
    }
    Alert.alert(
      'Enable private mode?',
      [
        'Going private will:',
        '• Hide your profile, library, posts, quotes, and book drops from everyone',
        '• Remove you from search, leaderboards, and activity feeds',
        '• Block you from posting, commenting, recommending, or joining clubs',
        '• Cancel pending friend requests and buddy-read invites',
        '• Step you down as admin where you’re the sole admin (or disband solo clubs)',
        '',
        'Your library, badges, and reading log are preserved — just invisible. You can turn this off anytime.',
      ].join('\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go private', style: 'destructive', onPress: () => setMode(true) },
      ],
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Privacy', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.ink }} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.rust} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.title}>Private mode</Text>
                <Text style={styles.subtitle}>
                  Hide your profile, library, posts, and quotes from everyone. You won't appear in search, leaderboards, or activity feeds — and you won't be able to post, comment, recommend books, or send/accept friend requests.
                </Text>
              </View>
              <Switch
                value={isPrivate}
                onValueChange={handleToggle}
                disabled={saving}
                trackColor={{ false: Colors.border, true: Colors.rust }}
                thumbColor={Platform.OS === 'android' ? (isPrivate ? '#fff' : '#f4f3f4') : undefined}
              />
            </View>
          </View>

          <Text style={styles.foot}>
            You can turn this off anytime. Your library, badges, and reading log are preserved while private — they just become invisible to others.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.background },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 80 },
  card: {
    backgroundColor: Colors.card,
    borderColor: Colors.border, borderWidth: 1,
    borderRadius: 12, padding: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
  title: {
    fontSize: 15, fontWeight: '700', color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13, color: Colors.muted, lineHeight: 19,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  foot: {
    fontSize: 12, color: Colors.muted, marginTop: 14, paddingHorizontal: 4, lineHeight: 18,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});
