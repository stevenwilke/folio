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
  Alert,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { BookCard, ReadStatus } from '../../components/BookCard';
import GoodreadsImportModal from '../../components/GoodreadsImportModal';

interface Profile {
  id: string;
  username: string | null;
  bio: string | null;
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showImport, setShowImport] = useState(false);

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
        .select('id, username, bio')
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
            cover_image_url
          )
        `)
        .eq('user_id', user.id)
        .order('added_at', { ascending: false }),
    ]);

    if (profileData) setProfile(profileData);
    if (entriesData) setEntries(entriesData as unknown as CollectionEntry[]);
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchProfile().finally(() => setLoading(false));
    }, [])
  );

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

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  const username = profile?.username ?? 'Reader';
  const initial = username.charAt(0).toUpperCase();
  const bgColor = avatarColor(username);

  const stats = {
    total: entries.length,
    read: entries.filter((e) => e.read_status === 'read').length,
    reading: entries.filter((e) => e.read_status === 'reading').length,
    want: entries.filter((e) => e.read_status === 'want').length,
  };

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
      {/* Profile header */}
      <View style={styles.profileHeader}>
        <View style={[styles.avatar, { backgroundColor: bgColor }]}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.username}>{username}</Text>
          {profile?.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : null}
        </View>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        {[
          { label: 'Books', value: stats.total },
          { label: 'Read', value: stats.read },
          { label: 'Reading', value: stats.reading },
          { label: 'Want', value: stats.want },
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

      <TouchableOpacity style={styles.editProfileBtn} onPress={() => router.push('/edit-profile' as any)}>
        <Text style={styles.editProfileBtnText}>✏️  Edit Profile</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.editProfileBtn} onPress={() => setShowImport(true)}>
        <Text style={styles.editProfileBtnText}>📥  Import from Goodreads</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.editProfileBtn} onPress={() => router.push('/stats' as any)}>
        <Text style={styles.editProfileBtnText}>📊  My Stats</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.editProfileBtn} onPress={() => router.push('/shelves' as any)}>
        <Text style={styles.editProfileBtnText}>📚  My Shelves</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.editProfileBtn} onPress={() => router.push('/polls' as any)}>
        <Text style={styles.editProfileBtnText}>🗳️  Reading Polls</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.editProfileBtn} onPress={() => router.push('/clubs' as any)}>
        <Text style={styles.editProfileBtnText}>💬  Book Clubs</Text>
        <Text style={styles.friendsBtnArrow}>›</Text>
      </TouchableOpacity>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>My Collection</Text>
      </View>
    </View>
  );

  const ListFooter = () => (
    <View style={styles.signOutWrapper}>
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <FlatList
        data={entries}
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
    </>
  );
}

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
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: Colors.white,
    fontSize: 28,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  profileInfo: {
    flex: 1,
    gap: 4,
  },
  username: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  bio: {
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 18,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
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
  friendsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  friendsBtnText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.ink,
  },
  friendsBtnArrow: {
    fontSize: 20,
    color: Colors.muted,
    lineHeight: 22,
  },
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  editProfileBtnText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.ink,
  },
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
});
