import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  Alert,
  RefreshControl,
  Image,
  Linking,
  Share,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { BookCard, ReadStatus } from '../../components/BookCard';
import GoodreadsImportModal from '../../components/GoodreadsImportModal';
import LevelAvatar from '../../components/LevelAvatar';
import { getLevelInfo } from '../../lib/level';

interface Profile {
  id: string;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  level?: number | null;
  level_points?: number | null;
}

interface CollectionEntry {
  id: string;
  book_id: string;
  read_status: ReadStatus;
  books: {
    id: string;
    title: string;
    author: string | null;
    cover_image_url: string | null;
    format: string | null;
  };
}

function avatarColor(username: string): string {
  const colors = [Colors.rust, Colors.sage, Colors.gold, '#4a6fa5', '#7b5ea7'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash + username.charCodeAt(i)) % colors.length;
  }
  return colors[hash];
}

export default function ProfileScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [profile,       setProfile]       = useState<Profile | null>(null);
  const [entries,       setEntries]        = useState<CollectionEntry[]>([]);
  const [loading,       setLoading]        = useState(true);
  const [zoomedImage,   setZoomedImage]    = useState<string | null>(null);
  const [refreshing,    setRefreshing]     = useState(false);
  const [showImport,    setShowImport]     = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [refreshingValues, setRefreshingValues] = useState(false);

  const COLUMNS = 2;
  const HORIZONTAL_PADDING = 16;
  const GAP = 10;
  const cardWidth = Math.floor((width - HORIZONTAL_PADDING * 2 - GAP) / COLUMNS);

  async function fetchProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: profileData }, { data: entriesData }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, bio, avatar_url, banner_url, level, level_points')
        .eq('id', user.id)
        .single(),
      supabase
        .from('collection_entries')
        .select(`
          id,
          book_id,
          read_status,
          books (
            id,
            title,
            author,
            cover_image_url,
            format
          )
        `)
        .eq('user_id', user.id)
        .order('added_at', { ascending: false }),
    ]);

    if (profileData) setProfile(prev => {
      if (prev && JSON.stringify(prev) === JSON.stringify(profileData)) return prev;
      return profileData;
    });
    if (entriesData) setEntries(prev => {
      // Only update if entries changed — prevents image flash
      if (prev.length === entriesData.length && prev.length > 0) {
        const prevIds = prev.map(e => e.id).join(',');
        const newIds = (entriesData as any[]).map(e => e.id).join(',');
        if (prevIds === newIds) return prev;
      }
      return entriesData as unknown as CollectionEntry[];
    });
  }

  const initialLoadDone = React.useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!initialLoadDone.current) setLoading(true);
      fetchProfile().finally(() => { setLoading(false); initialLoadDone.current = true; });
    }, [])
  );

  // If the screen mounts before Supabase has finished restoring the auth
  // session from secure storage, the initial fetchProfile() bails on the
  // null user and the screen sits blank — useFocusEffect won't re-run while
  // we stay on the same tab. Subscribe to auth state changes so we refetch
  // the moment the user becomes available.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        fetchProfile().finally(() => { setLoading(false); initialLoadDone.current = true; });
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
  }

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace('/auth');
        },
      },
    ]);
  }

  async function handleBannerUpload() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 1],
      quality: 0.85,
    });
    if (result.canceled || !profile) return;

    setUploadingBanner(true);
    try {
      const uri   = result.assets[0].uri;
      const ext   = uri.split('.').pop() ?? 'jpg';
      const path  = `${profile.id}/banner.${ext}`;
      const resp  = await fetch(uri);
      const blob  = await resp.blob();

      const { error: uploadErr } = await supabase.storage
        .from('banners')
        .upload(path, blob, { upsert: true, contentType: `image/${ext}` });
      if (uploadErr) throw uploadErr;

      const { data: { publicUrl } } = supabase.storage.from('banners').getPublicUrl(path);
      await supabase.from('profiles').update({ banner_url: publicUrl }).eq('id', profile.id);
      setProfile(prev => prev ? { ...prev, banner_url: publicUrl } : prev);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not upload banner.');
    } finally {
      setUploadingBanner(false);
    }
  }

  async function handleRemoveBanner() {
    if (!profile) return;
    await supabase.from('profiles').update({ banner_url: null }).eq('id', profile.id);
    setProfile(prev => prev ? { ...prev, banner_url: null } : prev);
  }

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  const username = profile?.username ?? 'Reader';
  const initial  = username.charAt(0).toUpperCase();
  const bgColor  = avatarColor(username);

  const stats = {
    total:   entries.length,
    read:    entries.filter((e) => e.read_status === 'read').length,
    reading: entries.filter((e) => e.read_status === 'reading').length,
    want:    entries.filter((e) => e.read_status === 'want').length,
  };

  const ebooks = entries.filter(
    (e) => e.books?.format === 'eBook' || e.books?.format === 'Audiobook'
  );

  const renderItem = ({ item, index }: { item: CollectionEntry; index: number }) => {
    const isLeft = index % 2 === 0;
    return (
      <View style={[styles.gridItem, isLeft ? { marginRight: GAP / 2 } : { marginLeft: GAP / 2 }]}>
        <BookCard
          id={item.book_id}
          title={item.books.title}
          author={item.books.author}
          coverImageUrl={item.books.cover_image_url}
          status={item.read_status}
          cardWidth={cardWidth}
          onPress={() => router.push(`/book/${item.book_id}`)}
        />
      </View>
    );
  };

  const ListHeader = () => (
    <View>
      {/* ── Banner / Hero ── */}
      <View style={styles.heroContainer}>
        {profile?.banner_url ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setZoomedImage(profile.banner_url!)}
            style={StyleSheet.absoluteFill}
          >
            <Image source={{ uri: profile.banner_url }} style={styles.bannerImage} resizeMode="cover" />
          </TouchableOpacity>
        ) : (
          <View style={styles.bannerPlaceholder} />
        )}
        {/* Dark overlay */}
        <View style={styles.bannerOverlay} pointerEvents="none" />

        {/* Avatar + name sit on top of banner */}
        <View style={styles.heroContent}>
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={!profile?.avatar_url}
            onPress={() => profile?.avatar_url && setZoomedImage(profile.avatar_url)}
          >
            <LevelAvatar
              src={profile?.avatar_url}
              name={username || '?'}
              size={80}
              level={profile?.level ?? 1}
              points={profile?.level_points ?? 0}
            />
          </TouchableOpacity>
          <View style={styles.profileInfo}>
            <Text style={styles.username}>{username}</Text>
            {(() => {
              const lvl = getLevelInfo(profile?.level ?? 1, profile?.level_points ?? 0);
              return (
                <View style={[styles.levelPill, { backgroundColor: lvl.ring }]}>
                  <Text style={styles.levelPillText}>Level {lvl.level} · {lvl.title}</Text>
                </View>
              );
            })()}
            {profile?.bio ? (
              <Text style={styles.bio}>{profile.bio}</Text>
            ) : null}
          </View>
        </View>

        {/* Banner editing moved to edit-profile screen */}
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        {[
          { label: 'Books',   value: stats.total },
          { label: 'Read',    value: stats.read },
          { label: 'Reading', value: stats.reading },
          { label: 'Want',    value: stats.want },
        ].map((stat) => (
          <View key={stat.label} style={styles.statCard}>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Friends button */}
      <TouchableOpacity style={styles.friendsBtn} onPress={() => router.push('/friends' as any)}>
        <Text style={styles.friendsBtnText}>👥  My Friends</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuBtn} onPress={() => router.push('/edit-profile' as any)}>
        <Text style={styles.menuBtnText}>✏️  Edit Profile</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuBtn} onPress={() => setShowImport(true)}>
        <Text style={styles.menuBtnText}>📥  Import from Goodreads</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuBtn} onPress={() => router.push('/stats' as any)}>
        <Text style={styles.menuBtnText}>📊  My Stats</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuBtn} onPress={() => router.push('/badges' as any)}>
        <Text style={styles.menuBtnText}>🏅  My Badges</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuBtn} onPress={() => router.push('/shelves' as any)}>
        <Text style={styles.menuBtnText}>📚  My Shelves</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuBtn} onPress={() => router.push('/polls' as any)}>
        <Text style={styles.menuBtnText}>🗳️  Reading Polls</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuBtn} onPress={() => router.push('/clubs' as any)}>
        <Text style={styles.menuBtnText}>💬  Book Clubs</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuBtn} onPress={() => router.push('/blocked-users' as any)}>
        <Text style={styles.menuBtnText}>🚫  Blocked Users</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      {/* ── Get Physical ── */}
      {ebooks.length > 0 && (
        <View style={styles.getPhysicalSection}>
          <Text style={styles.getPhysicalLabel}>GET PHYSICAL</Text>
          <Text style={styles.getPhysicalSubtitle}>
            You have digital copies of these books — grab a physical edition!
          </Text>
          {ebooks.map((entry) => {
            const title = entry.books?.title ?? '';
            const author = entry.books?.author ?? '';
            const cover = entry.books?.cover_image_url;
            const searchQuery = encodeURIComponent(`${title} ${author}`.trim());
            return (
              <View key={entry.id} style={styles.getPhysicalCard}>
                {cover ? (
                  <Image source={{ uri: cover }} style={styles.getPhysicalCover} />
                ) : (
                  <View style={[styles.getPhysicalCover, { backgroundColor: Colors.border }]} />
                )}
                <View style={styles.getPhysicalInfo}>
                  <Text style={styles.getPhysicalTitle} numberOfLines={2}>{title}</Text>
                  {author ? (
                    <Text style={styles.getPhysicalAuthor} numberOfLines={1}>{author}</Text>
                  ) : null}
                  <View style={styles.getPhysicalLinks}>
                    <TouchableOpacity
                      style={[styles.purchasePill, { backgroundColor: '#2a7a2a' }]}
                      onPress={() => Linking.openURL(`https://bookshop.org/search?keywords=${searchQuery}`)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.purchasePillText}>Bookshop.org</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.purchasePill, { backgroundColor: '#d97706' }]}
                      onPress={() => Linking.openURL(`https://www.amazon.com/s?k=${searchQuery}`)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.purchasePillText}>Amazon</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.purchasePill, { backgroundColor: '#7c3aed' }]}
                      onPress={() => Linking.openURL(`https://www.thriftbooks.com/browse/?b.search=${searchQuery}`)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.purchasePillText}>ThriftBooks</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Legal */}
      <View style={styles.legalRow}>
        <TouchableOpacity onPress={() => Linking.openURL('https://getfolio.app/privacy')}>
          <Text style={styles.legalLink}>Privacy Policy</Text>
        </TouchableOpacity>
        <Text style={styles.legalSep}>·</Text>
        <TouchableOpacity onPress={() => Linking.openURL('https://getfolio.app/terms')}>
          <Text style={styles.legalLink}>Terms of Service</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.sectionTitle}>Recent Books</Text>
          {entries.length > 6 && (
            <TouchableOpacity onPress={() => router.push('/')} activeOpacity={0.7}>
              <Text style={{ fontSize: 13, color: Colors.rust, fontWeight: '600' }}>View Library →</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Share wishlist */}
      {entries.some(e => (e as any).read_status === 'want') && (
        <TouchableOpacity
          style={{ marginHorizontal: 16, marginBottom: 12, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: Colors.gold, borderRadius: 8, alignSelf: 'flex-start' }}
          onPress={() => Share.share({ message: `Check out my reading wishlist on Ex Libris! https://exlibrisomnium.com/share/${profile?.username}/wishlist` })}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.gold }}>🔗 Share Wishlist</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  async function handleRefreshValues() {
    setRefreshingValues(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: ce } = await supabase
        .from('collection_entries')
        .select('book_id')
        .eq('user_id', user.id);
      const bookIds = (ce || []).map((e: any) => e.book_id).filter(Boolean);
      if (bookIds.length) {
        await supabase.from('valuations')
          .update({ fetched_at: '2000-01-01T00:00:00Z' })
          .in('book_id', bookIds);
      }
      Alert.alert('Values Reset', 'Your book prices will refresh the next time you open your library.');
    } catch {
      Alert.alert('Error', 'Could not reset values. Please try again.');
    }
    setRefreshingValues(false);
  }

  const ListFooter = () => (
    <View style={styles.signOutWrapper}>
      <TouchableOpacity
        style={[styles.signOutButton, { borderColor: Colors.border, marginBottom: 10 }]}
        onPress={handleRefreshValues}
        disabled={refreshingValues}
        activeOpacity={0.7}
      >
        <Text style={{ color: Colors.ink, fontSize: 15, fontWeight: '600', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) }}>
          {refreshingValues ? 'Resetting…' : 'Refresh Book Values'}
        </Text>
        <Text style={{ color: Colors.muted, fontSize: 12, marginTop: 2, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) }}>
          Re-fetch current retail and used prices
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.signOutButton, { borderColor: Colors.border, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
        onPress={async () => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const newVal = !profile?.weekly_report_enabled;
          await supabase.from('profiles').update({ weekly_report_enabled: newVal }).eq('id', user.id);
          setProfile((prev: any) => prev ? { ...prev, weekly_report_enabled: newVal } : prev);
          Alert.alert(newVal ? 'Weekly Report Enabled' : 'Weekly Report Disabled',
            newVal ? 'You\'ll receive a weekly reading summary by email.' : 'Weekly reports have been turned off.');
        }}
        activeOpacity={0.7}
      >
        <View>
          <Text style={{ color: Colors.ink, fontSize: 15, fontWeight: '600' }}>Weekly Reading Report</Text>
          <Text style={{ color: Colors.muted, fontSize: 12, marginTop: 2 }}>Email summary of your reading activity</Text>
        </View>
        <Text style={{ fontSize: 13, fontWeight: '700', color: profile?.weekly_report_enabled ? Colors.sage : Colors.muted }}>
          {profile?.weekly_report_enabled ? 'ON' : 'OFF'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.signOutButton, { borderColor: Colors.border, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
        onPress={async () => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const newVal = profile?.price_alerts_enabled === false;
          await supabase.from('profiles').update({ price_alerts_enabled: newVal }).eq('id', user.id);
          setProfile((prev: any) => prev ? { ...prev, price_alerts_enabled: newVal } : prev);
        }}
        activeOpacity={0.7}
      >
        <View>
          <Text style={{ color: Colors.ink, fontSize: 15, fontWeight: '600' }}>Price Alerts</Text>
          <Text style={{ color: Colors.muted, fontSize: 12, marginTop: 2 }}>Notify when book values increase 20%+</Text>
        </View>
        <Text style={{ fontSize: 13, fontWeight: '700', color: profile?.price_alerts_enabled !== false ? Colors.sage : Colors.muted }}>
          {profile?.price_alerts_enabled !== false ? 'ON' : 'OFF'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <FlatList
        data={entries.slice(0, 6)}
        numColumns={COLUMNS}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.gridContent}
        style={styles.root}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.rust}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyBooks}>
            <Text style={styles.emptyBooksText}>No books in your collection yet.</Text>
          </View>
        }
      />
      <GoodreadsImportModal
        visible={showImport}
        onClose={() => setShowImport(false)}
        onImported={() => {
          setShowImport(false);
          fetchProfile();
          router.replace('/(tabs)');
        }}
      />

      {/* Image zoom lightbox */}
      <Modal
        visible={!!zoomedImage}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomedImage(null)}
      >
        <Pressable style={styles.zoomOverlay} onPress={() => setZoomedImage(null)}>
          {zoomedImage && (
            <Image source={{ uri: zoomedImage }} style={styles.zoomImage} resizeMode="contain" />
          )}
          <TouchableOpacity
            style={styles.zoomClose}
            onPress={() => setZoomedImage(null)}
            activeOpacity={0.7}
          >
            <Text style={styles.zoomCloseText}>✕</Text>
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </>
  );
}

const BANNER_HEIGHT = 160;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },

  // ── Hero / Banner ──
  heroContainer: {
    height: BANNER_HEIGHT,
    position: 'relative',
    marginBottom: 12,
  },
  bannerImage: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  bannerPlaceholder: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#2c1f10',
  },
  bannerOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(10,6,2,0.55)',
  },
  heroContent: {
    position: 'absolute',
    bottom: 14,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  bannerActions: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    gap: 6,
  },
  bannerBtn: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 36,
    alignItems: 'center',
  },
  bannerBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  bannerRemoveBtn: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerRemoveBtnText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },

  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  avatarText: {
    color: Colors.white,
    fontSize: 24,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  profileInfo: {
    flex: 1,
    gap: 3,
  },
  username: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  bio: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 17,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  levelPill: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 2,
  },
  levelPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // ── Stats ──
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.rust,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  statLabel: {
    fontSize: 10,
    color: Colors.muted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // ── Menu buttons ──
  friendsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: Colors.rust,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  friendsBtnText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  friendsBtnArrow: {
    fontSize: 20,
    color: Colors.muted,
    lineHeight: 22,
  },
  menuBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuBtnText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.ink,
  },

  // ── Get Physical ──
  getPhysicalSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 16,
  },
  getPhysicalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.muted,
    letterSpacing: 1.2,
    marginBottom: 4,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  getPhysicalSubtitle: {
    fontSize: 13,
    color: Colors.muted,
    marginBottom: 14,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  getPhysicalCard: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    marginBottom: 10,
    gap: 10,
  },
  getPhysicalCover: {
    width: 44,
    height: 66,
    borderRadius: 4,
  },
  getPhysicalInfo: {
    flex: 1,
    justifyContent: 'center' as const,
    gap: 2,
  },
  getPhysicalTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  getPhysicalAuthor: {
    fontSize: 12,
    color: Colors.muted,
    marginBottom: 4,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  getPhysicalLinks: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 2,
  },
  purchasePill: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  purchasePillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // ── Legal ──
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 8,
  },
  legalLink: {
    fontSize: 12,
    color: Colors.muted,
    textDecorationLine: 'underline',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  legalSep: {
    fontSize: 12,
    color: Colors.muted,
  },

  // ── Collection section ──
  sectionHeader: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  gridContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  gridItem: {
    flex: 1,
  },
  emptyBooks: {
    paddingTop: 32,
    alignItems: 'center',
  },
  emptyBooksText: {
    fontSize: 14,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  signOutWrapper: {
    padding: 16,
    paddingTop: 24,
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  signOutText: {
    color: Colors.error,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  zoomOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomImage: {
    width: '100%',
    height: '80%',
  },
  zoomClose: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 24,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomCloseText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});
