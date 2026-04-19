import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  RefreshControl,
  Image,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { BookCard, ReadStatus } from '../../components/BookCard';
import ReportModal from '../../components/ReportModal';
import { blockUser, unblockUser, isBlocked } from '../../lib/moderation';

interface Profile {
  id: string;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
}

interface CollectionEntry {
  id: string;
  book_id: string;
  read_status: ReadStatus;
  user_rating: number | null;
  books: {
    id: string;
    title: string;
    author: string | null;
    cover_image_url: string | null;
    format: string | null;
  };
}

type FriendshipStatus = 'none' | 'pending_out' | 'pending_in' | 'accepted';

function avatarColor(username: string): string {
  const colors = [Colors.rust, Colors.sage, Colors.gold, '#4a6fa5', '#7b5ea7'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash + username.charCodeAt(i)) % colors.length;
  }
  return colors[hash];
}

export default function UserProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [friendshipId, setFriendshipId] = useState<string | null>(null);
  const [friendship, setFriendship] = useState<FriendshipStatus>('none');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [acting, setActing] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const isOwnProfile = !!myUserId && !!profile && myUserId === profile.id;

  const fetchData = useCallback(async () => {
    if (!username) return;
    setNotFound(false);

    const { data: { user } } = await supabase.auth.getUser();
    setMyUserId(user?.id ?? null);

    const { data: prof } = await supabase
      .from('profiles')
      .select('id, username, bio, avatar_url, banner_url')
      .eq('username', username)
      .maybeSingle();

    if (!prof) {
      setProfile(null);
      setNotFound(true);
      setLoading(false);
      return;
    }

    setProfile(prof as Profile);

    // Books (exclude "want" from the main grid to match Library behavior)
    const { data: coll } = await supabase
      .from('collection_entries')
      .select('id, book_id, read_status, user_rating, books (id, title, author, cover_image_url, format)')
      .eq('user_id', prof.id)
      .neq('read_status', 'want')
      .order('added_at', { ascending: false });
    setEntries((coll ?? []) as unknown as CollectionEntry[]);

    // Friendship status + block status (if viewing someone else)
    if (user && user.id !== prof.id) {
      const [fsResult, blockedStatus] = await Promise.all([
        supabase
          .from('friendships')
          .select('id, requester_id, addressee_id, status')
          .or(`and(requester_id.eq.${user.id},addressee_id.eq.${prof.id}),and(requester_id.eq.${prof.id},addressee_id.eq.${user.id})`)
          .maybeSingle(),
        isBlocked(prof.id),
      ]);
      const fs = fsResult.data;
      if (fs) {
        setFriendshipId(fs.id);
        if (fs.status === 'accepted') setFriendship('accepted');
        else if (fs.requester_id === user.id) setFriendship('pending_out');
        else setFriendship('pending_in');
      } else {
        setFriendshipId(null);
        setFriendship('none');
      }
      setBlocked(blockedStatus);
    }

    setLoading(false);
  }, [username]);

  async function handleBlockToggle() {
    if (!profile) return;
    if (blocked) {
      Alert.alert('Unblock user?', `You'll start seeing ${profile.username}'s content again.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unblock', onPress: async () => {
          await unblockUser(profile.id);
          setBlocked(false);
        }},
      ]);
    } else {
      Alert.alert(
        'Block user?',
        `${profile.username} won't be able to see your content and you won't see theirs. You can unblock later from this screen.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Block', style: 'destructive', onPress: async () => {
            await blockUser(profile.id);
            setBlocked(true);
            if (friendship === 'accepted' && friendshipId) {
              await supabase.from('friendships').delete().eq('id', friendshipId);
              setFriendship('none');
              setFriendshipId(null);
            }
          }},
        ]
      );
    }
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchData();
    }, [fetchData]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  async function addFriend() {
    if (!myUserId || !profile) return;
    setActing(true);
    const { data, error } = await supabase
      .from('friendships')
      .insert({ requester_id: myUserId, addressee_id: profile.id, status: 'pending' })
      .select('id')
      .single();
    if (!error && data) {
      setFriendshipId(data.id);
      setFriendship('pending_out');
    } else if (error) {
      Alert.alert('Could not send request', error.message);
    }
    setActing(false);
  }

  async function cancelRequest() {
    if (!friendshipId) return;
    setActing(true);
    await supabase.from('friendships').delete().eq('id', friendshipId);
    setFriendshipId(null);
    setFriendship('none');
    setActing(false);
  }

  async function respondToRequest(accept: boolean) {
    if (!friendshipId) return;
    setActing(true);
    if (accept) {
      await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
      setFriendship('accepted');
    } else {
      await supabase.from('friendships').delete().eq('id', friendshipId);
      setFriendshipId(null);
      setFriendship('none');
    }
    setActing(false);
  }

  async function unfriend() {
    if (!friendshipId) return;
    Alert.alert('Remove friend?', `You'll no longer be connected to ${profile?.username}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setActing(true);
          await supabase.from('friendships').delete().eq('id', friendshipId);
          setFriendshipId(null);
          setFriendship('none');
          setActing(false);
        },
      },
    ]);
  }

  const stats = entries.reduce(
    (acc, e) => {
      acc.total++;
      if (e.read_status === 'read') acc.read++;
      else if (e.read_status === 'reading') acc.reading++;
      return acc;
    },
    { total: 0, read: 0, reading: 0 },
  );

  const initial = (profile?.username || '?').charAt(0).toUpperCase();
  const bgColor = profile?.username ? avatarColor(profile.username) : Colors.rust;

  if (loading) {
    return (
      <View style={styles.loader}>
        <Stack.Screen options={{ title: `@${username ?? ''}` }} />
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  if (notFound || !profile) {
    return (
      <View style={styles.loader}>
        <Stack.Screen options={{ title: 'Profile' }} />
        <Text style={styles.notFoundTitle}>Profile not found</Text>
        <Text style={styles.notFoundBody}>No user with that username.</Text>
      </View>
    );
  }

  const columns = 3;
  const gridPadding = 16;
  const gap = 10;
  const coverW = Math.floor((width - gridPadding * 2 - gap * (columns - 1)) / columns);
  const coverH = Math.round(coverW * 1.5);

  const ListHeader = () => (
    <View>
      {/* Banner / Hero */}
      <View style={styles.heroContainer}>
        {profile.banner_url ? (
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
        <View style={styles.bannerOverlay} pointerEvents="none" />

        <View style={styles.heroContent}>
          {profile.avatar_url ? (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setZoomedImage(profile.avatar_url!)}>
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            </TouchableOpacity>
          ) : (
            <View style={[styles.avatar, { backgroundColor: bgColor }]}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.username} numberOfLines={1}>@{profile.username}</Text>
            {!!profile.bio && <Text style={styles.bio} numberOfLines={3}>{profile.bio}</Text>}
          </View>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'Books', value: stats.total },
          { label: 'Read', value: stats.read },
          { label: 'Reading', value: stats.reading },
        ].map((s) => (
          <View key={s.label} style={styles.statCard}>
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Friendship action */}
      {!isOwnProfile && (
        <View style={styles.actionRow}>
          {friendship === 'none' && (
            <TouchableOpacity style={styles.primaryBtn} onPress={addFriend} disabled={acting}>
              <Text style={styles.primaryBtnText}>{acting ? 'Sending…' : '+ Add Friend'}</Text>
            </TouchableOpacity>
          )}
          {friendship === 'pending_out' && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={cancelRequest} disabled={acting}>
              <Text style={styles.secondaryBtnText}>{acting ? 'Cancelling…' : 'Request sent · Cancel'}</Text>
            </TouchableOpacity>
          )}
          {friendship === 'pending_in' && (
            <View style={{ flexDirection: 'row', gap: 8, flex: 1 }}>
              <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={() => respondToRequest(true)} disabled={acting}>
                <Text style={styles.primaryBtnText}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => respondToRequest(false)} disabled={acting}>
                <Text style={styles.secondaryBtnText}>Decline</Text>
              </TouchableOpacity>
            </View>
          )}
          {friendship === 'accepted' && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={unfriend} disabled={acting}>
              <Text style={styles.secondaryBtnText}>✓ Friends · Remove</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!isOwnProfile && profile && (
        <View style={styles.modActionRow}>
          <TouchableOpacity style={styles.modBtn} onPress={() => setShowReport(true)}>
            <Text style={styles.modBtnText}>Report</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modBtn} onPress={handleBlockToggle}>
            <Text style={[styles.modBtnText, blocked && { color: Colors.rust }]}>
              {blocked ? 'Unblock' : 'Block'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {profile && (
        <ReportModal
          visible={showReport}
          onClose={() => setShowReport(false)}
          contentType="profile"
          contentId={profile.id}
          reportedUserId={profile.id}
        />
      )}

      <Text style={styles.sectionLabel}>LIBRARY</Text>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: `@${profile.username ?? ''}` }} />
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        numColumns={columns}
        columnWrapperStyle={{ gap, paddingHorizontal: gridPadding }}
        contentContainerStyle={{ paddingBottom: 40, gap }}
        ListHeaderComponent={ListHeader}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push(`/book/${item.books.id}` as any)}
            style={{ width: coverW }}
          >
            <BookCard
              title={item.books.title}
              author={item.books.author}
              coverImageUrl={item.books.cover_image_url}
              status={item.read_status}
              width={coverW}
              height={coverH}
              showStatus
            />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyBooks}>
            <Text style={styles.emptyBooksText}>No books in this library yet.</Text>
          </View>
        }
      />

      {/* Image zoom */}
      <Modal
        visible={!!zoomedImage}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomedImage(null)}
      >
        <Pressable style={styles.zoomOverlay} onPress={() => setZoomedImage(null)}>
          {zoomedImage && <Image source={{ uri: zoomedImage }} style={styles.zoomImage} resizeMode="contain" />}
          <TouchableOpacity style={styles.zoomClose} onPress={() => setZoomedImage(null)} activeOpacity={0.7}>
            <Text style={styles.zoomCloseText}>✕</Text>
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </>
  );
}

const BANNER_HEIGHT = 160;

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
  },
  notFoundTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.ink,
    marginBottom: 6,
  },
  notFoundBody: {
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
  },
  heroContainer: {
    height: BANNER_HEIGHT,
    position: 'relative',
    marginBottom: 12,
  },
  bannerImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bannerPlaceholder: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#2c1f10' },
  bannerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,6,2,0.55)' },
  heroContent: { position: 'absolute', bottom: 14, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 3, borderColor: Colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '700', fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }) },
  username: { fontSize: 22, fontWeight: '700', color: '#fff', fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }) },
  bio: { fontSize: 13, color: 'rgba(255,255,255,0.88)', marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  statCard: {
    flex: 1, backgroundColor: Colors.card, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, paddingVertical: 12,
    alignItems: 'center',
  },
  statValue: { fontSize: 20, fontWeight: '700', color: Colors.rust, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }) },
  statLabel: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  actionRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 16 },
  primaryBtn: {
    flex: 1, backgroundColor: Colors.rust, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    flex: 1, backgroundColor: Colors.card,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    paddingVertical: 12, alignItems: 'center',
  },
  secondaryBtnText: { color: Colors.ink, fontSize: 14, fontWeight: '600' },
  modActionRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12,
  },
  modBtn: {
    flex: 1, paddingVertical: 8, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
  },
  modBtnText: { color: Colors.muted, fontSize: 13, fontWeight: '500' },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.muted,
    letterSpacing: 1, textTransform: 'uppercase',
    paddingHorizontal: 16, marginBottom: 8,
  },
  emptyBooks: { alignItems: 'center', paddingVertical: 32 },
  emptyBooksText: { fontSize: 13, color: Colors.muted },
  zoomOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  zoomImage: { width: '100%', height: '80%' },
  zoomClose: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 24,
    right: 20,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  zoomCloseText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
