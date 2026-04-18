import React, { useCallback, useState, useRef } from 'react';
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
  TextInput,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { ReadStatus } from '../../components/BookCard';
import ActivityCard from '../../components/ActivityCard';
import SwipeTabNav from '../../components/SwipeTabNav';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BookRef {
  id: string;
  title: string;
  author: string | null;
  cover_image_url: string | null;
}

interface PostItem {
  id: string;
  user_id: string;
  username: string;
  content: string | null;
  image_url: string | null;
  book: BookRef | null;
  created_at: string;
  likes: string[];      // array of user_ids who liked
  commentCount: number;
  type: 'post';
}

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
  type: 'activity';
}

type FeedItem = PostItem | ActivityItem;

interface CommentItem {
  id: string;
  content: string;
  created_at: string;
  username: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function activityVerb(status: ReadStatus): string {
  switch (status) {
    case 'read':    return 'finished reading';
    case 'reading': return 'is reading';
    case 'want':    return 'wants to read';
    default:        return 'added to library';
  }
}

function avatarColor(username: string): string {
  const colors = [Colors.rust, Colors.sage, Colors.gold, '#4a6fa5', '#7b5ea7', '#2d7d6f'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash + username.charCodeAt(i)) % colors.length;
  return colors[hash];
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function FeedScreen() {
  const router  = useRouter();
  const [items, setItems]             = useState<FeedItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [tab, setTab]                 = useState<'posts' | 'activity'>('posts');

  // Compose modal
  const [showCompose, setShowCompose]   = useState(false);
  const [postText, setPostText]         = useState('');
  const [postImage, setPostImage]       = useState<{ uri: string; base64: string; type: string } | null>(null);
  const [posting, setPosting]           = useState(false);

  // Comments modal
  const [commentPost, setCommentPost]   = useState<PostItem | null>(null);
  const [comments, setComments]         = useState<CommentItem[]>([]);
  const [newComment, setNewComment]     = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);

  // User's books for later (not used here but available for tagging)
  const [myUsername, setMyUsername]     = useState('');

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchFeed().finally(() => setLoading(false));
    }, [])
  );

  async function fetchFeed() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentUserId(user.id);

    // Get profile
    const { data: profile } = await supabase
      .from('profiles').select('username').eq('id', user.id).maybeSingle();
    setMyUsername(profile?.username || '');

    // Get friends
    const { data: friendships } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    const friendIds = (friendships || []).map((f: any) =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id
    );

    const allIds = [user.id, ...friendIds];

    // Fetch posts + activity in parallel
    const [postsRes, activitiesRes, sessionsRes] = await Promise.all([
      supabase
        .from('reading_posts')
        .select(`
          id, user_id, content, image_url, post_type, session_data, created_at,
          books ( id, title, author, cover_image_url ),
          profiles!reading_posts_user_id_fkey ( username ),
          post_likes ( user_id ),
          post_comments ( id )
        `)
        .in('user_id', allIds)
        .order('created_at', { ascending: false })
        .limit(40),

      friendIds.length
        ? supabase
            .from('collection_entries')
            .select(`id, user_id, read_status, user_rating, review_text, added_at, books(id, title, author, cover_image_url), profiles(username)`)
            .in('user_id', friendIds)
            .order('added_at', { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [] }),

      // Friend reading sessions
      friendIds.length
        ? supabase
            .from('reading_sessions')
            .select('id, user_id, book_id, ended_at, pages_read, started_at, books(id, title, author, cover_image_url), profiles(username)')
            .in('user_id', friendIds)
            .eq('status', 'completed')
            .not('pages_read', 'is', null)
            .order('ended_at', { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [] }),
    ]);

    const posts: PostItem[] = ((postsRes.data as any[]) || []).map(p => ({
      id:           p.id,
      user_id:      p.user_id,
      username:     p.profiles?.username ?? 'Unknown',
      content:      p.content,
      image_url:    p.image_url,
      book:         p.books ?? null,
      created_at:   p.created_at,
      likes:        (p.post_likes || []).map((l: any) => l.user_id),
      commentCount: (p.post_comments || []).length,
      type:         'post',
    }));

    const activities: ActivityItem[] = ((activitiesRes.data as any[]) || []).map(e => ({
      id:          e.id,
      userId:      e.user_id,
      username:    e.profiles?.username ?? 'Unknown',
      status:      e.read_status as ReadStatus,
      bookId:      e.books?.id ?? null,
      bookTitle:   e.books?.title ?? 'Unknown book',
      bookCover:   e.books?.cover_image_url ?? null,
      bookAuthor:  e.books?.author ?? null,
      rating:      e.user_rating ?? null,
      review:      e.review_text ?? null,
      addedAt:     e.added_at,
      type:        'activity',
    }));

    // Add reading sessions as activity items
    const sessionActivities: ActivityItem[] = ((sessionsRes.data as any[]) || []).map(s => {
      const durationMin = s.started_at && s.ended_at
        ? Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)
        : null;
      const durLabel = durationMin
        ? durationMin >= 60 ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m` : `${durationMin} min`
        : null;
      return {
        id:          s.id,
        userId:      s.user_id,
        username:    (s as any).profiles?.username ?? 'Unknown',
        status:      'reading' as ReadStatus,
        bookId:      s.books?.id ?? null,
        bookTitle:   s.books?.title ?? 'Unknown book',
        bookCover:   s.books?.cover_image_url ?? null,
        bookAuthor:  s.books?.author ?? null,
        rating:      null,
        review:      `⏱ Read ${s.pages_read} pages${durLabel ? ` in ${durLabel}` : ''}`,
        addedAt:     s.ended_at,
        type:        'activity' as const,
      };
    });

    const allActivities = [...activities, ...sessionActivities]
      .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
      .slice(0, 50);

    setItems([...posts, ...allActivities] as FeedItem[]);
  }

  async function toggleLike(postId: string) {
    if (!currentUserId) return;
    setItems(prev => prev.map(item => {
      if (item.type !== 'post' || item.id !== postId) return item;
      const liked = item.likes.includes(currentUserId);
      return {
        ...item,
        likes: liked
          ? item.likes.filter(id => id !== currentUserId)
          : [...item.likes, currentUserId],
      };
    }));

    const post = items.find(i => i.type === 'post' && i.id === postId) as PostItem | undefined;
    if (!post) return;
    const liked = post.likes.includes(currentUserId);
    if (liked) {
      await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', currentUserId);
    } else {
      await supabase.from('post_likes').insert({ post_id: postId, user_id: currentUserId });
    }
  }

  async function pickImage() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Photo access required', 'Enable photo library access in Settings to attach an image.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setPostImage({
          uri: asset.uri,
          base64: asset.base64 || '',
          type: asset.mimeType || 'image/jpeg',
        });
      }
    } catch (err: any) {
      Alert.alert('Could not pick image', err?.message ?? 'Please try again.');
    }
  }

  async function submitPost() {
    if (!postText.trim() && !postImage) return;
    if (!currentUserId) return;
    setPosting(true);

    try {
      let imageUrl: string | null = null;

      if (postImage?.base64) {
        const ext  = postImage.type.includes('png') ? 'png' : 'jpg';
        const path = `${currentUserId}/${Date.now()}.${ext}`;
        const bytes = Uint8Array.from(atob(postImage.base64), c => c.charCodeAt(0));
        const { error: upErr } = await supabase.storage
          .from('post-images')
          .upload(path, bytes, { contentType: postImage.type, upsert: true });
        if (upErr) {
          setPosting(false);
          Alert.alert('Could not upload image', upErr.message);
          return;
        }
        const { data: urlData } = supabase.storage.from('post-images').getPublicUrl(path);
        imageUrl = urlData.publicUrl;
      }

      const { data, error } = await supabase
        .from('reading_posts')
        .insert({
          user_id:   currentUserId,
          content:   postText.trim() || null,
          image_url: imageUrl,
        })
        .select('id, user_id, content, image_url, created_at')
        .single();

      if (error || !data) {
        setPosting(false);
        Alert.alert('Could not post', error?.message ?? 'Please try again.');
        return;
      }

      const newPost: PostItem = {
        id:           (data as any).id,
        user_id:      (data as any).user_id,
        username:     myUsername,
        content:      (data as any).content,
        image_url:    (data as any).image_url,
        book:         null,
        created_at:   (data as any).created_at,
        likes:        [],
        commentCount: 0,
        type:         'post',
      };
      setItems(prev => [newPost, ...prev]);

      setPostText('');
      setPostImage(null);
      setShowCompose(false);
      setTab('posts');
    } catch (err: any) {
      Alert.alert('Could not post', err?.message ?? 'Please try again.');
    } finally {
      setPosting(false);
    }
  }

  async function openComments(post: PostItem) {
    setCommentPost(post);
    setCommentsLoading(true);
    const { data } = await supabase
      .from('post_comments')
      .select(`id, content, created_at, profiles!post_comments_user_id_fkey(username)`)
      .eq('post_id', post.id)
      .order('created_at', { ascending: true });
    setComments(((data as any[]) || []).map(c => ({
      id:         c.id,
      content:    c.content,
      created_at: c.created_at,
      username:   c.profiles?.username ?? 'Unknown',
    })));
    setCommentsLoading(false);
  }

  async function submitComment() {
    if (!newComment.trim() || !commentPost || !currentUserId) return;
    setSavingComment(true);
    const { data } = await supabase
      .from('post_comments')
      .insert({ post_id: commentPost.id, user_id: currentUserId, content: newComment.trim() })
      .select(`id, content, created_at, profiles!post_comments_user_id_fkey(username)`)
      .single();
    if (data) {
      setComments(prev => [...prev, {
        id:         (data as any).id,
        content:    (data as any).content,
        created_at: (data as any).created_at,
        username:   (data as any).profiles?.username ?? '',
      }]);
      // Update comment count in items
      setItems(prev => prev.map(i =>
        i.type === 'post' && i.id === commentPost.id
          ? { ...i, commentCount: i.commentCount + 1 }
          : i
      ));
    }
    setNewComment('');
    setSavingComment(false);
  }

  function onRefresh() {
    setRefreshing(true);
    fetchFeed().finally(() => setRefreshing(false));
  }

  // Split by type
  const posts      = items.filter(i => i.type === 'post') as PostItem[];
  const activities = items.filter(i => i.type === 'activity') as ActivityItem[];

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  return (
    <SwipeTabNav current="feed">
    <View style={styles.root}>
      {/* ── Tab bar ── */}
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tab, tab === 'posts' && styles.tabActive]} onPress={() => setTab('posts')}>
          <Text style={[styles.tabText, tab === 'posts' && styles.tabTextActive]}>📸 Posts</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'activity' && styles.tabActive]} onPress={() => setTab('activity')}>
          <Text style={[styles.tabText, tab === 'activity' && styles.tabTextActive]}>📚 Activity</Text>
        </TouchableOpacity>
      </View>

      {tab === 'posts' ? (
        <FlatList
          data={posts}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />}
          contentContainerStyle={[styles.list, posts.length === 0 && styles.listEmpty]}
          ListHeaderComponent={
            /* Quick compose row */
            <TouchableOpacity style={styles.composeRow} onPress={() => setShowCompose(true)}>
              <View style={[styles.avatar, { backgroundColor: avatarColor(myUsername || 'u') }]}>
                <Text style={styles.avatarText}>{(myUsername || '?').charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={styles.composePlaceholder}>What are you reading?</Text>
              <Text style={styles.composePostBtn}>Post</Text>
            </TouchableOpacity>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📸</Text>
              <Text style={styles.emptyTitle}>No posts yet</Text>
              <Text style={styles.emptySubtitle}>Share your first reading update!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <PostCard
              post={item as PostItem}
              currentUserId={currentUserId}
              onLike={() => toggleLike(item.id)}
              onComments={() => openComments(item as PostItem)}
              onBookPress={bookId => bookId && router.push(`/book/${bookId}`)}
            />
          )}
        />
      ) : (
        <FlatList
          data={activities}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />}
          contentContainerStyle={[styles.list, activities.length === 0 && styles.listEmpty]}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📖</Text>
              <Text style={styles.emptyTitle}>No activity yet</Text>
              <Text style={styles.emptySubtitle}>Add friends to see their reading activity.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.activityCard}
              activeOpacity={0.75}
              onPress={() => (item as ActivityItem).bookId && router.push(`/book/${(item as ActivityItem).bookId}`)}
            >
              <View style={[styles.avatar, { backgroundColor: avatarColor((item as ActivityItem).username) }]}>
                <Text style={styles.avatarText}>{(item as ActivityItem).username.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.activityContent}>
                <Text style={styles.activityText}>
                  <Text style={styles.bold}>{(item as ActivityItem).username}</Text>
                  {' '}<Text style={styles.italic}>{activityVerb((item as ActivityItem).status)}</Text>
                  {' '}<Text style={styles.bookTitle}>{(item as ActivityItem).bookTitle}</Text>
                </Text>
                {(item as ActivityItem).bookAuthor ? <Text style={styles.muted}>by {(item as ActivityItem).bookAuthor}</Text> : null}
                {(item as ActivityItem).rating ? <Text style={styles.stars}>{'★'.repeat((item as ActivityItem).rating!)}{'☆'.repeat(5 - (item as ActivityItem).rating!)} {(item as ActivityItem).rating}/5</Text> : null}
                {(item as ActivityItem).review ? <Text style={styles.reviewText} numberOfLines={2}>"{(item as ActivityItem).review}"</Text> : null}
                <Text style={styles.timeText}>{timeAgo((item as ActivityItem).addedAt)}</Text>
              </View>
              {(item as ActivityItem).bookCover ? (
                <Image source={{ uri: (item as ActivityItem).bookCover! }} style={styles.coverThumb} resizeMode="cover" />
              ) : null}
            </TouchableOpacity>
          )}
        />
      )}

      {/* ── FAB compose button ── */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowCompose(true)}>
        <Text style={styles.fabText}>✏️</Text>
      </TouchableOpacity>

      {/* ── Compose Modal ── */}
      <Modal visible={showCompose} animationType="slide" onRequestClose={() => setShowCompose(false)}>
        <KeyboardAvoidingView style={styles.composeModal} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
          <View style={styles.composeHeader}>
            <TouchableOpacity onPress={() => { setShowCompose(false); setPostText(''); setPostImage(null); }}>
              <Text style={styles.cancelBtn}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.composeTitle}>Reading Update</Text>
            <TouchableOpacity
              onPress={submitPost}
              disabled={posting || (!postText.trim() && !postImage)}
              style={[styles.postBtn, { opacity: posting || (!postText.trim() && !postImage) ? 0.4 : 1 }]}
            >
              <Text style={styles.postBtnText}>{posting ? '…' : 'Post'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <View style={styles.composeBody}>
              <View style={[styles.avatar, { backgroundColor: avatarColor(myUsername || 'u'), marginTop: 4 }]}>
                <Text style={styles.avatarText}>{(myUsername || '?').charAt(0).toUpperCase()}</Text>
              </View>
              <TextInput
                value={postText}
                onChangeText={setPostText}
                placeholder="What are you reading? Share your thoughts…"
                placeholderTextColor={Colors.muted}
                multiline
                autoFocus
                style={styles.composeInput}
              />
            </View>

            {postImage && (
              <View style={{ position: 'relative', marginHorizontal: 16, marginBottom: 12 }}>
                <Image source={{ uri: postImage.uri }} style={styles.composeImagePreview} resizeMode="cover" />
                <TouchableOpacity
                  onPress={() => setPostImage(null)}
                  style={styles.removeImageBtn}>
                  <Text style={{ color: 'white', fontSize: 14, fontWeight: '700' }}>×</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          {/* Toolbar */}
          <View style={styles.composeTool}>
            <TouchableOpacity onPress={pickImage} style={styles.toolBtn}>
              <Text style={[styles.toolBtnText, postImage ? { color: Colors.rust } : {}]}>📷 Photo</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Comments Modal ── */}
      <Modal visible={!!commentPost} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setCommentPost(null); setComments([]); }}>
        <KeyboardAvoidingView style={styles.composeModal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.composeHeader}>
            <TouchableOpacity onPress={() => { setCommentPost(null); setComments([]); }}>
              <Text style={styles.cancelBtn}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.composeTitle}>Comments</Text>
            <View style={{ width: 60 }} />
          </View>

          <FlatList
            data={comments}
            keyExtractor={c => c.id}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            ListEmptyComponent={
              commentsLoading
                ? <ActivityIndicator color={Colors.rust} style={{ marginTop: 32 }} />
                : <Text style={[styles.muted, { textAlign: 'center', marginTop: 32, fontStyle: 'italic' }]}>No comments yet. Be the first!</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.commentRow}>
                <View style={[styles.commentAvatar, { backgroundColor: avatarColor(item.username) }]}>
                  <Text style={styles.commentAvatarText}>{item.username.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.commentBubble}>
                  <Text style={styles.commentUsername}>{item.username} </Text>
                  <Text style={styles.commentContent}>{item.content}</Text>
                  <Text style={styles.commentTime}>{timeAgo(item.created_at)}</Text>
                </View>
              </View>
            )}
          />

          <View style={styles.commentInputRow}>
            <TextInput
              value={newComment}
              onChangeText={setNewComment}
              placeholder="Add a comment…"
              placeholderTextColor={Colors.muted}
              style={styles.commentInput}
              returnKeyType="send"
              onSubmitEditing={submitComment}
            />
            <TouchableOpacity
              onPress={submitComment}
              disabled={savingComment || !newComment.trim()}
              style={[styles.sendBtn, { opacity: !newComment.trim() ? 0.4 : 1 }]}>
              <Text style={styles.sendBtnText}>→</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </SwipeTabNav>
  );
}

// ─── Post Card Component ──────────────────────────────────────────────────────

function PostCard({ post, currentUserId, onLike, onComments, onBookPress }: {
  post: PostItem;
  currentUserId: string | null;
  onLike: () => void;
  onComments: () => void;
  onBookPress: (bookId: string | null) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const liked = currentUserId ? post.likes.includes(currentUserId) : false;

  return (
    <View style={styles.postCard}>
      {/* Header */}
      <View style={styles.postHeader}>
        <View style={[styles.avatar, { backgroundColor: avatarColor(post.username) }]}>
          <Text style={styles.avatarText}>{post.username.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bold}>{post.username}</Text>
          <Text style={styles.timeText}>{timeAgo(post.created_at)}</Text>
        </View>
      </View>

      {/* Tagged book */}
      {post.book && (
        <TouchableOpacity
          style={styles.taggedBook}
          onPress={() => onBookPress(post.book?.id ?? null)}
          activeOpacity={0.75}>
          <View style={styles.taggedBookCover}>
            {post.book.cover_image_url
              ? <Image source={{ uri: post.book.cover_image_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              : <Text style={{ fontSize: 18 }}>📖</Text>
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.taggedBookTitle}>{post.book.title}</Text>
            {post.book.author ? <Text style={styles.muted}>{post.book.author}</Text> : null}
          </View>
          <Text style={[styles.muted, { fontSize: 12 }]}>View →</Text>
        </TouchableOpacity>
      )}

      {/* Activity card (Strava-style) */}
      {post.post_type === 'activity' && post.session_data ? (
        <ActivityCard
          pagesRead={post.session_data.pages_read}
          durationMin={post.session_data.duration_min}
          speedPpm={post.session_data.speed_ppm}
          startPage={post.session_data.start_page}
          endPage={post.session_data.end_page}
          totalPages={post.session_data.total_pages}
        />
      ) : null}

      {/* Quote post */}
      {post.post_type === 'quote' && post.content ? (
        <View style={{ borderLeftWidth: 3, borderLeftColor: Colors.gold, paddingLeft: 14, marginHorizontal: 16, marginBottom: 8 }}>
          <Text style={{ fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), fontStyle: 'italic', fontSize: 15, lineHeight: 22, color: Colors.ink }}>
            {post.content}
          </Text>
        </View>
      ) : null}

      {/* Text */}
      {post.content && post.post_type !== 'quote' && post.post_type !== 'activity' ? (
        <Text style={styles.postContent}>{post.content}</Text>
      ) : null}

      {/* Image */}
      {post.image_url && !imgError ? (
        <Image
          source={{ uri: post.image_url }}
          style={styles.postImage}
          resizeMode="cover"
          onError={() => setImgError(true)}
        />
      ) : null}

      {/* Actions */}
      <View style={styles.postActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={onLike}>
          <Text style={[styles.actionText, liked && { color: '#e0055a' }]}>
            {liked ? '❤️' : '🤍'} {post.likes.length > 0 ? `${post.likes.length} ` : ''}
            {post.likes.length === 1 ? 'Like' : 'Likes'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={onComments}>
          <Text style={styles.actionText}>
            💬 {post.commentCount > 0 ? `${post.commentCount} ` : ''}
            {post.commentCount === 1 ? 'Comment' : 'Comments'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: Colors.background },
  loader:     { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  list:       { padding: 12 },
  listEmpty:  { flexGrow: 1 },

  // Tabs
  tabBar:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.card },
  tab:          { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive:    { borderBottomWidth: 2, borderBottomColor: Colors.rust },
  tabText:      { fontSize: 14, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  tabTextActive:{ color: Colors.rust, fontWeight: '600' },

  // Quick compose row
  composeRow:        { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 12, padding: 12, marginBottom: 12, gap: 10, borderWidth: 1, borderColor: Colors.border },
  composePlaceholder:{ flex: 1, fontSize: 14, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  composePostBtn:    { fontSize: 13, color: Colors.rust, fontWeight: '600' },

  // FAB
  fab:     { position: 'absolute', right: 20, bottom: 24, width: 54, height: 54, borderRadius: 27, backgroundColor: Colors.rust, justifyContent: 'center', alignItems: 'center', shadowColor: Colors.rust, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  fabText: { fontSize: 20 },

  // Avatar
  avatar:     { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarText: { color: Colors.white, fontSize: 16, fontWeight: '700', fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },

  // Post card
  postCard:    { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 12, overflow: 'hidden' },
  postHeader:  { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  postContent: { fontSize: 14, color: Colors.ink, lineHeight: 21, paddingHorizontal: 12, paddingBottom: 10, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  postImage:   { width: '100%', height: 300 },
  postActions: { flexDirection: 'row', gap: 16, padding: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  actionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText:  { fontSize: 13, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  // Tagged book in post
  taggedBook:      { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 12, marginTop: 0, padding: 10, backgroundColor: Colors.background, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  taggedBookCover: { width: 34, height: 48, borderRadius: 4, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.border, flexShrink: 0 },
  taggedBookTitle: { fontSize: 13, fontWeight: '600', color: Colors.ink, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },

  // Activity card
  activityCard:    { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 10, gap: 10 },
  activityContent: { flex: 1, gap: 3 },
  activityText:    { fontSize: 14, color: Colors.ink, lineHeight: 20, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  coverThumb:      { width: 36, height: 52, borderRadius: 3, flexShrink: 0 },

  // Text styles
  bold:       { fontWeight: '700', color: Colors.ink, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  italic:     { color: Colors.muted, fontStyle: 'italic', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  bookTitle:  { fontWeight: '600', color: Colors.rust, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  muted:      { fontSize: 12, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  stars:      { fontSize: 13, color: Colors.gold, marginTop: 2 },
  reviewText: { fontSize: 12, color: Colors.ink, fontStyle: 'italic', lineHeight: 17, marginTop: 3, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: Colors.border },
  timeText:   { fontSize: 11, color: Colors.muted, marginTop: 2, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  // Compose modal
  composeModal:   { flex: 1, backgroundColor: Colors.background },
  composeHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: Platform.OS === 'ios' ? 56 : 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  composeTitle:   { fontSize: 16, fontWeight: '700', color: Colors.ink, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  cancelBtn:      { fontSize: 14, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  postBtn:        { backgroundColor: Colors.rust, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7 },
  postBtnText:    { color: Colors.white, fontWeight: '700', fontSize: 14 },
  composeBody:    { flexDirection: 'row', padding: 16, gap: 12, alignItems: 'flex-start' },
  composeInput:   { flex: 1, fontSize: 15, color: Colors.ink, minHeight: 100, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }), lineHeight: 22 },
  composeImagePreview: { width: '100%', height: 250, borderRadius: 12 },
  removeImageBtn: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 15, width: 30, height: 30, justifyContent: 'center', alignItems: 'center' },
  composeTool:    { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: Colors.border, gap: 8 },
  toolBtn:        { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  toolBtnText:    { fontSize: 13, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  // Comments
  commentRow:        { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  commentAvatar:     { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  commentAvatarText: { color: Colors.white, fontSize: 13, fontWeight: '700' },
  commentBubble:     { flex: 1, backgroundColor: Colors.border, borderRadius: 10, padding: 8 },
  commentUsername:   { fontWeight: '700', fontSize: 12, color: Colors.ink },
  commentContent:    { fontSize: 13, color: Colors.ink, lineHeight: 18 },
  commentTime:       { fontSize: 10, color: Colors.muted, marginTop: 3 },
  commentInputRow:   { flexDirection: 'row', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: Colors.border, alignItems: 'center' },
  commentInput:      { flex: 1, fontSize: 14, color: Colors.ink, backgroundColor: Colors.card, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: Colors.border },
  sendBtn:           { backgroundColor: Colors.rust, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  sendBtnText:       { color: Colors.white, fontWeight: '700', fontSize: 15 },

  // Empty state
  empty:        { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyIcon:    { fontSize: 48, marginBottom: 12 },
  emptyTitle:   { fontSize: 18, fontWeight: '700', color: Colors.ink, textAlign: 'center', fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), marginBottom: 8 },
  emptySubtitle:{ fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
});
