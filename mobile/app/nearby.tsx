import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, Platform, Alert, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
import { haversineKm, formatDistance } from '../lib/geo';
import BookDropCard from '../components/BookDropCard';

const RADIUS_OPTIONS = [5, 10, 25, 50, null] as const;
const RADIUS_LABELS: Record<string, string> = { '5': '5 km', '10': '10 km', '25': '25 km', '50': '50 km', 'null': 'Any' };

const CONDITION_LABELS: Record<string, string> = { like_new: 'Like New', very_good: 'Very Good', good: 'Good', acceptable: 'Acceptable' };
const CONDITION_COLORS: Record<string, string> = { like_new: Colors.sage, very_good: Colors.sage, good: Colors.gold, acceptable: Colors.rust };

export default function NearbyScreen() {
  const router = useRouter();
  const [drops, setDrops] = useState<any[]>([]);
  const [myDrops, setMyDrops] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'nearby' | 'my'>('nearby');
  const [radius, setRadius] = useState<number | null>(25);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [selectedDrop, setSelectedDrop] = useState<any>(null);

  async function fetchLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const loc = await Location.getCurrentPositionAsync({});
      setUserLat(loc.coords.latitude);
      setUserLng(loc.coords.longitude);
    }
  }

  async function fetchDrops() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: available }, { data: mine }] = await Promise.all([
      supabase.from('book_drops')
        .select('*, books(id, title, author, cover_image_url, genre), profiles:user_id(username)')
        .eq('status', 'available')
        .order('created_at', { ascending: false }),
      supabase.from('book_drops')
        .select('*, books(id, title, author, cover_image_url), claimer:claimed_by(username)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
    ]);
    setDrops(available || []);
    setMyDrops(mine || []);
  }

  useFocusEffect(useCallback(() => {
    setLoading(true);
    Promise.all([fetchLocation(), fetchDrops()]).finally(() => setLoading(false));
  }, []));

  async function onRefresh() {
    setRefreshing(true);
    await fetchDrops();
    setRefreshing(false);
  }

  const dropsWithDistance = drops.map(d => ({
    ...d,
    distanceKm: userLat != null ? haversineKm(userLat, userLng!, d.latitude, d.longitude) : null,
  }));

  const filtered = dropsWithDistance
    .filter(d => {
      if (radius == null) return true;
      if (d.distanceKm == null) return true;
      return d.distanceKm <= radius;
    })
    .sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));

  async function claimDrop(dropId: string) {
    setClaiming(dropId);
    const { error } = await supabase
      .from('book_drops')
      .update({ status: 'claimed', claimed_by: (await supabase.auth.getUser()).data.user?.id, claimed_at: new Date().toISOString() })
      .eq('id', dropId)
      .eq('status', 'available');
    if (!error) {
      const drop = drops.find(d => d.id === dropId);
      if (drop) {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: myProfile } = await supabase.from('profiles').select('username').eq('id', user?.id).single();
        await supabase.from('notifications').insert({
          user_id: drop.user_id,
          type: 'book_drop_claimed',
          title: `${myProfile?.username || 'Someone'} claimed "${drop.books?.title}"`,
          body: `Your book drop at ${drop.location_name} was claimed!`,
          link: '/nearby',
        });
      }
      setSelectedDrop(null);
      Alert.alert('Claimed!', 'The book is yours. Happy reading!');
      fetchDrops();
    }
    setClaiming(null);
  }

  if (loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.rust} /></View>;
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Nearby Books', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.ink }} />

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity onPress={() => setTab('nearby')} style={[styles.tab, tab === 'nearby' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'nearby' && styles.tabTextActive]}>Nearby</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('my')} style={[styles.tab, tab === 'my' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'my' && styles.tabTextActive]}>My Drops ({myDrops.length})</Text>
        </TouchableOpacity>
      </View>

      {tab === 'nearby' && (
        <>
          {/* Radius filter */}
          <View style={styles.filterRow}>
            {RADIUS_OPTIONS.map(r => (
              <TouchableOpacity
                key={String(r)}
                onPress={() => setRadius(r)}
                style={[styles.pill, radius === r && styles.pillActive]}
              >
                <Text style={[styles.pillText, radius === r && styles.pillTextActive]}>{RADIUS_LABELS[String(r)]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <BookDropCard drop={item} distanceKm={item.distanceKm} onPress={() => setSelectedDrop(item)} />
            )}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📍</Text>
                <Text style={styles.emptyTitle}>No books nearby</Text>
                <Text style={styles.emptyDesc}>Be the first to free a book in your area!</Text>
              </View>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />}
          />
        </>
      )}

      {tab === 'my' && (
        <FlatList
          data={myDrops}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <View style={styles.myRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.myTitle}>{item.books?.title}</Text>
                <Text style={styles.myMeta}>📍 {item.location_name}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: item.status === 'available' ? Colors.statusBg.owned : Colors.statusBg.read }]}>
                <Text style={[styles.statusText, { color: item.status === 'available' ? Colors.sage : Colors.gold }]}>
                  {item.status === 'available' ? 'Available' : item.status === 'claimed' ? `Claimed` : item.status}
                </Text>
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📚</Text>
              <Text style={styles.emptyTitle}>No drops yet</Text>
              <Text style={styles.emptyDesc}>Open a book and tap "Free Book Drop"</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />}
        />
      )}

      {/* Detail modal overlay */}
      {selectedDrop && (
        <View style={styles.overlay}>
          <View style={styles.detailCard}>
            <TouchableOpacity onPress={() => setSelectedDrop(null)} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
            <View style={styles.detailTop}>
              {selectedDrop.books?.cover_image_url && (
                <Image source={{ uri: selectedDrop.books.cover_image_url }} style={styles.detailCover} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.detailTitle}>{selectedDrop.books?.title}</Text>
                <Text style={styles.detailAuthor}>{selectedDrop.books?.author}</Text>
                <View style={[styles.condBadge, { backgroundColor: `${CONDITION_COLORS[selectedDrop.condition]}18` }]}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: CONDITION_COLORS[selectedDrop.condition] }}>
                    {CONDITION_LABELS[selectedDrop.condition]}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={styles.detailMeta}>📍 {selectedDrop.location_name}</Text>
            {selectedDrop.distanceKm != null && (
              <Text style={styles.detailMeta}>{formatDistance(selectedDrop.distanceKm)} from you</Text>
            )}
            <Text style={styles.detailMeta}>Freed by {selectedDrop.profiles?.username}</Text>
            {selectedDrop.note && <Text style={styles.detailNote}>"{selectedDrop.note}"</Text>}
            {selectedDrop.photo_url && <Image source={{ uri: selectedDrop.photo_url }} style={styles.detailPhoto} />}
            <TouchableOpacity
              onPress={() => claimDrop(selectedDrop.id)}
              disabled={claiming === selectedDrop.id}
              style={[styles.claimBtn, claiming === selectedDrop.id && { opacity: 0.6 }]}
            >
              <Text style={styles.claimText}>{claiming === selectedDrop.id ? 'Claiming...' : '🎉 Claim This Book'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.rust },
  tabText: { fontSize: 14, color: Colors.muted },
  tabTextActive: { color: Colors.rust, fontWeight: '600' },
  filterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  pill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  pillActive: { borderColor: Colors.rust, backgroundColor: '#fdf0ea' },
  pillText: { fontSize: 12, color: Colors.ink },
  pillTextActive: { color: Colors.rust, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.ink, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  emptyDesc: { fontSize: 14, color: Colors.muted, marginTop: 4 },
  myRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  myTitle: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  myMeta: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: '600' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 50 },
  detailCard: { backgroundColor: Colors.background, borderRadius: 16, padding: 20, width: '88%', maxHeight: '80%' },
  closeBtn: { position: 'absolute', top: 12, right: 12, zIndex: 1 },
  closeText: { fontSize: 18, color: Colors.muted },
  detailTop: { flexDirection: 'row', gap: 14, marginBottom: 12 },
  detailCover: { width: 70, height: 105, borderRadius: 6 },
  detailTitle: { fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), fontSize: 18, fontWeight: '700', color: Colors.ink, lineHeight: 22 },
  detailAuthor: { fontSize: 13, color: Colors.muted, marginTop: 4 },
  condBadge: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, marginTop: 6 },
  detailMeta: { fontSize: 13, color: Colors.muted, marginBottom: 4 },
  detailNote: { fontSize: 13, color: Colors.ink, fontStyle: 'italic', backgroundColor: Colors.card, padding: 10, borderRadius: 8, marginVertical: 8 },
  detailPhoto: { width: '100%', height: 150, borderRadius: 8, marginBottom: 8 },
  claimBtn: { backgroundColor: Colors.rust, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  claimText: { fontSize: 15, fontWeight: '700', color: Colors.white },
});
