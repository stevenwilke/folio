import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Platform,
  RefreshControl,
  Image,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { ReadStatus } from '../../components/BookCard';

interface ActivityItem {
  id: string;
  userId: string;
  username: string;
  status: ReadStatus;
  bookId: string | null;
  bookTitle: string;
  bookCover: string | null;
  bookAuthor: string | null;
  rating: number | null;
  review: string | null;
  addedAt: string;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function activityVerb(status: ReadStatus): string {
  switch (status) {
    case 'read':
      return 'finished reading';
    case 'reading':
      return 'is reading';
    case 'want':
      return 'wants to read';
    case 'owned':
    default:
      return 'added to library';
  }
}

function avatarInitial(username: string): string {
  return username.trim().charAt(0).toUpperCase() || '?';
}

function avatarColor(username: string): string {
  const colors = [
    Colors.rust,
    Colors.sage,
    Colors.gold,
    '#4a6fa5',
    '#7b5ea7',
    '#2d7d6f',
  ];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash + username.charCodeAt(i)) % colors.length;
  }
  return colors[hash];
}

export default function FeedScreen() {
  const router = useRouter();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasFriends, setHasFriends] = useState(false);

  async function fetchFeed() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get accepted friends
    const { data: friendships } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    if (!friendships || friendships.length === 0) {
      setHasFriends(false);
      setActivities([]);
      return;
    }

    setHasFriends(true);

    // Collect friend IDs
    const friendIds = friendships.map((f) =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id
    );

    // Fetch their recent entries with book and profile data
    const { data: entries } = await supabase
      .from('collection_entries')
      .select(`
        id,
        user_id,
        read_status,
        user_rating,
        review_text,
        added_at,
        books (
          id,
          title,
          author,
          cover_image_url
        ),
        profiles (
          username
        )
      `)
      .in('user_id', friendIds)
      .order('added_at', { ascending: false })
      .limit(50);

    if (entries) {
      const items: ActivityItem[] = entries.map((e: any) => ({
        id: e.id,
        userId: e.user_id,
        username: e.profiles?.username ?? 'Unknown user',
        status: e.read_status as ReadStatus,
        bookId: e.books?.id ?? null,
        bookTitle: e.books?.title ?? 'Unknown book',
        bookCover: e.books?.cover_image_url ?? null,
        bookAuthor: e.books?.author ?? null,
        rating: e.user_rating ?? null,
        review: e.review_text ?? null,
        addedAt: e.added_at,
      }));
      setActivities(items);
    }
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchFeed().finally(() => setLoading(false));
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchFeed();
    setRefreshing(false);
  }

  function renderItem({ item }: { item: ActivityItem }) {
    const bgColor = avatarColor(item.username);
    const initial = avatarInitial(item.username);

    return (
      <TouchableOpacity
        style={styles.activityCard}
        activeOpacity={0.75}
        onPress={() => item.bookId && router.push(`/book/${item.bookId}`)}
      >
        {/* Avatar */}
        <View style={[styles.avatar, { backgroundColor: bgColor }]}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>

        {/* Content */}
        <View style={styles.activityContent}>
          <Text style={styles.activityText}>
            <Text style={styles.activityUsername}>{item.username}</Text>
            {' '}
            <Text style={styles.activityVerb}>{activityVerb(item.status)}</Text>
            {' '}
            <Text style={styles.activityBook}>{item.bookTitle}</Text>
          </Text>
          {item.bookAuthor ? (
            <Text style={styles.activityAuthor}>by {item.bookAuthor}</Text>
          ) : null}
          {item.rating ? (
            <Text style={styles.activityRating}>
              {'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)} {item.rating}/5
            </Text>
          ) : null}
          {item.review ? (
            <Text style={styles.activityReview} numberOfLines={3}>"{item.review}"</Text>
          ) : null}
          <Text style={styles.activityTime}>
            {timeAgo(item.addedAt)}{item.bookId ? '  ·  Tap to view & borrow' : ''}
          </Text>
        </View>

        {/* Book cover thumbnail */}
        {item.bookCover ? (
          <Image source={{ uri: item.bookCover }} style={styles.coverThumb} resizeMode="cover" />
        ) : null}
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  if (!hasFriends) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>👥</Text>
        <Text style={styles.emptyTitle}>No friends yet</Text>
        <Text style={styles.emptySubtitle}>
          Connect with friends to see what they're reading and discover new books.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={activities}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      contentContainerStyle={[
        styles.listContent,
        activities.length === 0 && styles.listContentEmpty,
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={Colors.rust}
        />
      }
      style={styles.root}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📖</Text>
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptySubtitle}>
            Your friends haven't added any books recently.
          </Text>
        </View>
      }
    />
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
  listContent: {
    padding: 16,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  avatarText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  activityContent: {
    flex: 1,
    gap: 4,
  },
  activityText: {
    fontSize: 14,
    color: Colors.ink,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  activityUsername: {
    fontWeight: '700',
    color: Colors.ink,
  },
  activityVerb: {
    color: Colors.muted,
    fontStyle: 'italic',
  },
  activityBook: {
    fontWeight: '600',
    color: Colors.rust,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  activityAuthor: {
    fontSize: 12,
    color: Colors.muted,
    fontStyle: 'italic',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  activityRating: {
    fontSize: 13,
    color: Colors.gold,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  activityReview: {
    fontSize: 12,
    color: Colors.ink,
    fontStyle: 'italic',
    lineHeight: 17,
    marginTop: 4,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: Colors.border,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  activityTime: {
    fontSize: 11,
    color: Colors.muted,
    marginTop: 4,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  coverThumb: {
    width: 36,
    height: 52,
    borderRadius: 3,
    flexShrink: 0,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.ink,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});
