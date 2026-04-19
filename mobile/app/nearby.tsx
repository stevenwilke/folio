import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, Platform, Alert, Image, Modal, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
import { haversineKm, formatDistance } from '../lib/geo';
import { fetchBlockedUserIds } from '../lib/moderation';
import BookDropCard from '../components/BookDropCard';
import AddLibraryModal from '../components/AddLibraryModal';
import ScanLibraryModal from '../components/ScanLibraryModal';

const RADIUS_OPTIONS = [5, 10, 25, 50, null] as const;
const RADIUS_LABELS: Record<string, string> = { '5': '5 km', '10': '10 km', '25': '25 km', '50': '50 km', 'null': 'Any' };

const CONDITION_LABELS: Record<string, string> = { like_new: 'Like New', very_good: 'Very Good', good: 'Good', acceptable: 'Acceptable' };
const CONDITION_COLORS: Record<string, string> = { like_new: Colors.sage, very_good: Colors.sage, good: Colors.gold, acceptable: Colors.rust };

const TEAL = '#2a9d8f';

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function NearbyScreen() {
  const router = useRouter();
  const [drops, setDrops] = useState<any[]>([]);
  const [myDrops, setMyDrops] = useState<any[]>([]);
  const [libraries, setLibraries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'nearby' | 'libraries' | 'my'>('nearby');
  const [view, setView] = useState<'map' | 'list'>('list');
  const [radius, setRadius] = useState<number | null>(25);
  const mapRef = useRef<MapView | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [selectedDrop, setSelectedDrop] = useState<any>(null);
  const [selectedLibrary, setSelectedLibrary] = useState<any>(null);
  const [showAddLibrary, setShowAddLibrary] = useState(false);
  const [showScanLibrary, setShowScanLibrary] = useState<any>(null);
  const [userId, setUserId] = useState<string | null>(null);

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
    setUserId(user.id);
    const blockedIds = await fetchBlockedUserIds(user.id);
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
    const blockedSet = new Set(blockedIds);
    setDrops((available || []).filter((d: any) => !blockedSet.has(d.user_id)));
    setMyDrops(mine || []);
  }

  async function fetchLibraries() {
    const { data, error } = await supabase
      .from('little_libraries')
      .select('*, little_library_scans(id, books_found, photo_url, created_at, user_id)')
      .order('created_at', { ascending: false });
    if (error) { console.error('fetchLibraries error:', error); return; }
    setLibraries((data || []).map((lib: any) => ({
      ...lib,
      latest_scan: lib.little_library_scans
        ?.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())?.[0] || null,
    })));
  }

  useFocusEffect(useCallback(() => {
    setLoading(true);
    Promise.all([fetchLocation(), fetchDrops(), fetchLibraries()]).finally(() => setLoading(false));
  }, []));

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([fetchDrops(), fetchLibraries()]);
    setRefreshing(false);
  }

  // Drops with distance
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

  // Libraries with distance
  const librariesWithDistance = libraries.map(lib => ({
    ...lib,
    distanceKm: userLat != null ? haversineKm(userLat, userLng!, lib.latitude, lib.longitude) : null,
  }));

  const filteredLibraries = librariesWithDistance
    .filter(lib => {
      if (radius == null) return true;
      if (lib.distanceKm == null) return true;
      return lib.distanceKm <= radius;
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
        <TouchableOpacity onPress={() => setTab('libraries')} style={[styles.tab, tab === 'libraries' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'libraries' && styles.tabTextActive]}>Libraries ({libraries.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('my')} style={[styles.tab, tab === 'my' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'my' && styles.tabTextActive]}>My Drops ({myDrops.length})</Text>
        </TouchableOpacity>
      </View>

      {/* Nearby tab */}
      {tab === 'nearby' && (
        <>
          {/* Radius filter + view toggle */}
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
            <ViewToggle view={view} onChange={setView} />
          </View>

          {view === 'map' ? (
            <MapPanel
              mapRef={mapRef}
              userLat={userLat}
              userLng={userLng}
              markers={filtered
                .filter(d => d.latitude != null && d.longitude != null)
                .map(d => ({
                  id: d.id,
                  lat: d.latitude,
                  lng: d.longitude,
                  title: d.books?.title || 'Book drop',
                  subtitle: d.location_name,
                  color: Colors.rust,
                  onPress: () => setSelectedDrop(d),
                }))}
            />
          ) : (
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
          )}
        </>
      )}

      {/* Libraries tab */}
      {tab === 'libraries' && (
        <>
          {/* Radius filter + Add button + view toggle */}
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
            <TouchableOpacity onPress={() => setShowAddLibrary(true)} style={styles.addLibBtn}>
              <Text style={styles.addLibText}>+ Add</Text>
            </TouchableOpacity>
            <ViewToggle view={view} onChange={setView} />
          </View>

          {view === 'map' ? (
            <MapPanel
              mapRef={mapRef}
              userLat={userLat}
              userLng={userLng}
              markers={filteredLibraries
                .filter(l => l.latitude != null && l.longitude != null)
                .map(l => ({
                  id: l.id,
                  lat: l.latitude,
                  lng: l.longitude,
                  title: l.name || 'Little Library',
                  subtitle: l.location_name,
                  color: TEAL,
                  onPress: () => setSelectedLibrary(l),
                }))}
            />
          ) : (
          <FlatList
            data={filteredLibraries}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setSelectedLibrary(item)}
                style={styles.libRow}
                activeOpacity={0.7}
              >
                {(item.photo_url || item.latest_scan?.photo_url) && (
                  <Image
                    source={{ uri: item.latest_scan?.photo_url || item.photo_url }}
                    style={styles.libThumb}
                  />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.libName} numberOfLines={1}>{item.name || 'Little Library'}</Text>
                  <Text style={styles.libLocation} numberOfLines={1}>📍 {item.location_name}</Text>
                  {item.latest_scan && (
                    <Text style={styles.libScan}>
                      📷 {item.latest_scan.books_found?.length || 0} books found · {timeAgo(item.latest_scan.created_at)}
                    </Text>
                  )}
                </View>
                {item.distanceKm != null && (
                  <Text style={styles.libDist}>{formatDistance(item.distanceKm)}</Text>
                )}
              </TouchableOpacity>
            )}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📚</Text>
                <Text style={styles.emptyTitle}>No Little Libraries nearby</Text>
                <Text style={styles.emptyDesc}>Know of one? Add it to the map!</Text>
              </View>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />}
          />
          )}
        </>
      )}

      {/* My Drops tab */}
      {tab === 'my' && (
        <FlatList
          data={myDrops}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <View style={styles.myRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.myTitle}>{item.books?.title}</Text>
                <Text style={styles.myMeta}>📍 {item.location_name} · {timeAgo(item.created_at)}</Text>
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

      {/* Drop detail modal overlay */}
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
            <Text style={styles.detailMeta}>Freed by {selectedDrop.profiles?.username} · {timeAgo(selectedDrop.created_at)}</Text>
            {selectedDrop.note && <Text style={styles.detailNote}>"{selectedDrop.note}"</Text>}
            {selectedDrop.photo_url && <Image source={{ uri: selectedDrop.photo_url }} style={styles.detailPhoto} />}

            {/* Own-drop guard: don't show claim button for user's own drops */}
            {selectedDrop.user_id === userId ? (
              <Text style={styles.ownDropText}>This is your book drop</Text>
            ) : (
              <TouchableOpacity
                onPress={() => claimDrop(selectedDrop.id)}
                disabled={claiming === selectedDrop.id}
                style={[styles.claimBtn, claiming === selectedDrop.id && { opacity: 0.6 }]}
              >
                <Text style={styles.claimText}>{claiming === selectedDrop.id ? 'Claiming...' : '🎉 Claim This Book'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Library detail modal overlay */}
      {selectedLibrary && (
        <View style={styles.overlay}>
          <View style={styles.detailCard}>
            <TouchableOpacity onPress={() => setSelectedLibrary(null)} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>

            <ScrollView style={{ maxHeight: '100%' }} showsVerticalScrollIndicator={false}>
              <Text style={styles.libDetailTitle}>📚 {selectedLibrary.name || 'Little Library'}</Text>
              <Text style={styles.detailMeta}>
                📍 {selectedLibrary.location_name}
                {selectedLibrary.distanceKm != null && ` · ${formatDistance(selectedLibrary.distanceKm)}`}
              </Text>
              <Text style={styles.detailMeta}>Added {timeAgo(selectedLibrary.created_at)}</Text>

              {selectedLibrary.photo_url && (
                <Image source={{ uri: selectedLibrary.photo_url }} style={styles.detailPhoto} />
              )}

              {/* Latest scan */}
              {selectedLibrary.latest_scan ? (
                <View style={styles.scanSection}>
                  <Text style={styles.scanHeader}>📷 Latest Inventory · {timeAgo(selectedLibrary.latest_scan.created_at)}</Text>
                  {selectedLibrary.latest_scan.photo_url && (
                    <Image source={{ uri: selectedLibrary.latest_scan.photo_url }} style={styles.scanPhoto} />
                  )}
                  {selectedLibrary.latest_scan.books_found?.length > 0 ? (
                    <View>
                      {selectedLibrary.latest_scan.books_found.map((b: any, i: number) => (
                        <View key={i} style={styles.bookItem}>
                          <Text style={styles.bookTitle}>{b.title}</Text>
                          {b.author && <Text style={styles.bookAuthor}> by {b.author}</Text>}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.noBooks}>No books identified in last scan</Text>
                  )}
                </View>
              ) : (
                <Text style={styles.noScans}>No inventory scans yet -- be the first!</Text>
              )}

              <TouchableOpacity
                onPress={() => { setShowScanLibrary(selectedLibrary); setSelectedLibrary(null); }}
                style={styles.scanBtn}
              >
                <Text style={styles.scanBtnText}>📷 Update Inventory</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      )}

      {/* Add Library Modal */}
      {showAddLibrary && (
        <AddLibraryModal
          onClose={() => setShowAddLibrary(false)}
          onSuccess={() => { setShowAddLibrary(false); fetchLibraries(); }}
        />
      )}

      {/* Scan Library Modal */}
      {showScanLibrary && (
        <ScanLibraryModal
          library={showScanLibrary}
          onClose={() => setShowScanLibrary(null)}
          onSuccess={() => { setShowScanLibrary(null); fetchLibraries(); }}
        />
      )}
    </View>
  );
}

// ── View toggle (Map / List) ─────────────────────────────────────────────────
function ViewToggle({ view, onChange }: { view: 'map' | 'list'; onChange: (v: 'map' | 'list') => void }) {
  return (
    <View style={styles.viewToggle}>
      <TouchableOpacity
        onPress={() => onChange('map')}
        style={[styles.viewToggleBtn, view === 'map' && styles.viewToggleBtnActive]}
      >
        <Text style={[styles.viewToggleText, view === 'map' && styles.viewToggleTextActive]}>🗺️</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onChange('list')}
        style={[styles.viewToggleBtn, view === 'list' && styles.viewToggleBtnActive]}
      >
        <Text style={[styles.viewToggleText, view === 'list' && styles.viewToggleTextActive]}>☰</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Map panel ────────────────────────────────────────────────────────────────
interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  color: string;
  onPress: () => void;
}
function MapPanel({
  mapRef, userLat, userLng, markers,
}: {
  mapRef: React.MutableRefObject<MapView | null>;
  userLat: number | null;
  userLng: number | null;
  markers: MapMarker[];
}) {
  const initialRegion = {
    latitude:  userLat ?? markers[0]?.lat ?? 39.5,
    longitude: userLng ?? markers[0]?.lng ?? -98.35,
    latitudeDelta:  userLat != null ? 0.2 : 30,
    longitudeDelta: userLng != null ? 0.2 : 30,
  };
  return (
    <View style={styles.mapWrap}>
      <MapView
        ref={(r) => { mapRef.current = r; }}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton
      >
        {markers.map((m) => (
          <Marker
            key={m.id}
            coordinate={{ latitude: m.lat, longitude: m.lng }}
            title={m.title}
            description={m.subtitle}
            pinColor={m.color}
            onCalloutPress={m.onPress}
            onPress={Platform.OS === 'android' ? undefined : () => { /* tap callout on iOS */ }}
          />
        ))}
      </MapView>
      {markers.length === 0 && (
        <View style={styles.mapEmpty} pointerEvents="none">
          <Text style={styles.mapEmptyText}>No pins in this radius</Text>
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
  tabText: { fontSize: 13, color: Colors.muted },
  tabTextActive: { color: Colors.rust, fontWeight: '600' },
  filterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
  pill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  pillActive: { borderColor: Colors.rust, backgroundColor: '#fdf0ea' },
  pillText: { fontSize: 12, color: Colors.ink },
  pillTextActive: { color: Colors.rust, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.ink, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  emptyDesc: { fontSize: 14, color: Colors.muted, marginTop: 4 },

  // My Drops
  myRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  myTitle: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  myMeta: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: '600' },

  // Libraries list
  libRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  libThumb: { width: 48, height: 48, borderRadius: 8 },
  libName: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  libLocation: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  libScan: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  libDist: { fontSize: 12, color: Colors.muted },
  addLibBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, backgroundColor: TEAL, marginLeft: 'auto' },
  addLibText: { fontSize: 12, fontWeight: '600', color: Colors.white },

  // Detail overlay
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
  ownDropText: { fontSize: 12, color: Colors.muted, textAlign: 'center', marginTop: 12, fontStyle: 'italic' },

  // Library detail
  libDetailTitle: { fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), fontSize: 18, fontWeight: '700', color: Colors.ink, marginBottom: 4 },
  scanSection: { backgroundColor: Colors.card, borderRadius: 10, padding: 14, marginBottom: 14 },
  scanHeader: { fontSize: 13, fontWeight: '600', color: Colors.ink, marginBottom: 8 },
  scanPhoto: { width: '100%', height: 150, borderRadius: 8, marginBottom: 10 },
  bookItem: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 3 },
  bookTitle: { fontSize: 13, fontWeight: '600', color: Colors.ink },
  bookAuthor: { fontSize: 13, color: Colors.muted },
  noBooks: { fontSize: 13, color: Colors.muted },
  noScans: { fontSize: 13, color: Colors.muted, fontStyle: 'italic', textAlign: 'center', marginBottom: 14 },
  scanBtn: { backgroundColor: TEAL, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 8, marginBottom: 8 },
  scanBtnText: { fontSize: 15, fontWeight: '700', color: Colors.white },

  // Map view
  mapWrap: { flex: 1, marginHorizontal: 16, marginBottom: 80, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  map: { flex: 1 },
  mapEmpty: { position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: Colors.card, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: Colors.border },
  mapEmptyText: { fontSize: 12, color: Colors.muted },

  // View toggle
  viewToggle: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  viewToggleBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: Colors.card },
  viewToggleBtnActive: { backgroundColor: Colors.rust },
  viewToggleText: { fontSize: 14 },
  viewToggleTextActive: { color: '#fff' },
});
