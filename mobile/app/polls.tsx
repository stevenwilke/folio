import React, { useCallback, useState, useEffect, useRef } from 'react';
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
  Modal,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../constants/colors';
import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BookOption {
  id: string;
  title: string;
  author: string | null;
  cover_image_url: string | null;
  isbn_13: string | null;
  isbn_10: string | null;
}

interface PollOption {
  id: string;
  book_id: string;
  books: BookOption;
}

interface PollVote {
  user_id: string;
  option_id: string;
}

interface Profile {
  username: string;
  avatar_url: string | null;
}

interface Poll {
  id: string;
  question: string;
  expires_at: string;
  created_at: string;
  user_id: string;
  profiles: Profile | null;
  poll_options: PollOption[];
  poll_votes: PollVote[];
}

interface Friend {
  id: string;
  username: string;
  avatar_url: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeRemaining(expiresAt: string): string | null {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return null;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}

function coverUri(book: BookOption): string | null {
  if (book.cover_image_url) return book.cover_image_url;
  const isbn = book.isbn_13 || book.isbn_10;
  if (isbn) return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
  return null;
}

function avatarColor(username: string): string {
  const palette = [Colors.rust, Colors.sage, Colors.gold, '#4a6fa5', '#7b5ea7', '#2d7d6f'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash + username.charCodeAt(i)) % palette.length;
  }
  return palette[hash];
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ profile, size = 36 }: { profile: Profile | null; size?: number }) {
  const username = profile?.username ?? '?';
  const initial = username.charAt(0).toUpperCase();
  const bg = avatarColor(username);

  if (profile?.avatar_url) {
    return (
      <Image
        source={{ uri: profile.avatar_url }}
        style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.38) }]}>{initial}</Text>
    </View>
  );
}

// ─── Book Cover ───────────────────────────────────────────────────────────────

function BookCover({ book, width = 50, height = 70 }: { book: BookOption; width?: number; height?: number }) {
  const uri = coverUri(book);
  const palette = ['#7b4f3a', '#4a6b8a', '#5a7a5a', '#2c3e50', '#8b2500', '#3d5a5a'];
  const bg = palette[book.title.charCodeAt(0) % palette.length];

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width, height, borderRadius: 4 }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 4,
        backgroundColor: bg,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 4,
      }}
    >
      <Text style={{ color: Colors.white, fontSize: 9, textAlign: 'center', fontWeight: '600' }} numberOfLines={3}>
        {book.title}
      </Text>
    </View>
  );
}

// ─── Poll Card ────────────────────────────────────────────────────────────────

interface PollCardProps {
  poll: Poll;
  userId: string;
  onVote: (pollId: string, optionId: string) => Promise<void>;
  onClosePoll: (pollId: string) => Promise<void>;
}

function PollCard({ poll, userId, onVote, onClosePoll }: PollCardProps) {
  const [voting, setVoting] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const myVote = (poll.poll_votes || []).find((v) => v.user_id === userId);
  const hasVoted = !!myVote;
  const isOwner = poll.user_id === userId;
  const totalVotes = (poll.poll_votes || []).length;
  const remaining = timeRemaining(poll.expires_at);
  const isClosed = !remaining;

  async function handleVote(optionId: string) {
    if (hasVoted || isClosed || voting) return;
    setSelectedOption(optionId);
    setVoting(true);
    await onVote(poll.id, optionId);
    setVoting(false);
  }

  async function handleClose() {
    Alert.alert('Close Poll', 'Close this poll early?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close',
        style: 'destructive',
        onPress: () => onClosePoll(poll.id),
      },
    ]);
  }

  const maxVotes =
    totalVotes > 0
      ? Math.max(
          ...(poll.poll_options || []).map(
            (o) => (poll.poll_votes || []).filter((v) => v.option_id === o.id).length
          )
        )
      : 0;

  return (
    <View style={styles.pollCard}>
      {/* Header */}
      <View style={styles.pollHeader}>
        <Avatar profile={poll.profiles} size={36} />
        <View style={styles.pollHeaderInfo}>
          <Text style={styles.pollAuthorLine}>
            <Text style={styles.pollAuthorName}>{poll.profiles?.username ?? 'Someone'}</Text>
            <Text style={styles.pollAsksText}> asks:</Text>
          </Text>
          <Text style={styles.pollQuestion}>{poll.question}</Text>
        </View>
        <View style={styles.pollBadgeCol}>
          {isClosed ? (
            <View style={styles.badgeClosed}>
              <Text style={styles.badgeClosedText}>Closed</Text>
            </View>
          ) : (
            <View style={styles.badgeOpen}>
              <Text style={styles.badgeOpenText}>{remaining}</Text>
            </View>
          )}
          {isOwner && !isClosed && (
            <TouchableOpacity onPress={handleClose} style={styles.closeEarlyBtn}>
              <Text style={styles.closeEarlyText}>Close early</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Options */}
      <View style={styles.optionsList}>
        {(poll.poll_options || []).map((opt) => {
          const book = opt.books;
          const optVotes = (poll.poll_votes || []).filter((v) => v.option_id === opt.id).length;
          const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
          const isMyChoice = (myVote?.option_id === opt.id) || (!hasVoted && selectedOption === opt.id);
          const isLeading = hasVoted && optVotes === maxVotes && maxVotes > 0;
          const barColor = isLeading ? Colors.rust : Colors.sage;
          const tappable = !hasVoted && !isClosed;

          return (
            <TouchableOpacity
              key={opt.id}
              activeOpacity={tappable ? 0.7 : 1}
              onPress={() => tappable && handleVote(opt.id)}
              style={[
                styles.optionBtn,
                isMyChoice && styles.optionBtnSelected,
              ]}
            >
              <View style={styles.optionInner}>
                <BookCover book={book} width={50} height={70} />
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle} numberOfLines={2}>{book.title}</Text>
                  {book.author ? (
                    <Text style={styles.optionAuthor} numberOfLines={1}>{book.author}</Text>
                  ) : null}
                  {isMyChoice && hasVoted ? (
                    <Text style={styles.yourVoteLabel}>Your vote</Text>
                  ) : null}
                </View>
                {hasVoted && (
                  <Text style={styles.pctLabel}>{pct}%</Text>
                )}
              </View>
              {/* Vote bar */}
              {hasVoted && (
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${pct}%` as any, backgroundColor: barColor },
                    ]}
                  />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Footer */}
      <View style={styles.pollFooter}>
        <Text style={styles.voteTotal}>
          {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
        </Text>
        {voting && <ActivityIndicator size="small" color={Colors.rust} style={{ marginLeft: 8 }} />}
        {hasVoted && !isClosed ? (
          <View style={styles.votedBadge}>
            <Text style={styles.votedBadgeText}>✓ Voted</Text>
          </View>
        ) : isClosed ? null : null}
        <Text style={styles.pollTime}>{timeAgo(poll.created_at)}</Text>
      </View>
    </View>
  );
}

// ─── Create Poll Modal ────────────────────────────────────────────────────────

const EXPIRY_OPTIONS = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
];

interface CreatePollModalProps {
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}

function CreatePollModal({ userId, onClose, onCreated }: CreatePollModalProps) {
  const [question, setQuestion] = useState("What should I read next?");
  const [bookSearch, setBookSearch] = useState('');
  const [searchResults, setSearchResults] = useState<BookOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState<BookOption[]>([]);
  const [shareAll, setShareAll] = useState(true);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [expiryDays, setExpiryDays] = useState(3);
  const [saving, setSaving] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchFriends();
  }, []);

  async function fetchFriends() {
    const { data: friendships } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

    const ids = (friendships || []).map((f: any) =>
      f.requester_id === userId ? f.addressee_id : f.requester_id
    );
    if (!ids.length) return;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', ids);

    setFriends(profiles || []);
  }

  async function searchBooks(q: string) {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from('collection_entries')
      .select('books(id, title, author, cover_image_url, isbn_13, isbn_10)')
      .eq('user_id', userId)
      .eq('read_status', 'want')
      .ilike('books.title', `%${q}%`)
      .limit(10);

    const books = ((data || []) as any[]).map((e: any) => e.books).filter(Boolean);
    const seen = new Set<string>();
    const unique = books.filter((b: BookOption) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });
    setSearchResults(unique);
    setSearching(false);
  }

  function onSearchChange(text: string) {
    setBookSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchBooks(text), 300);
  }

  function toggleBook(book: BookOption) {
    setSelectedBooks((prev) => {
      if (prev.find((b) => b.id === book.id)) return prev.filter((b) => b.id !== book.id);
      if (prev.length >= 6) return prev;
      return [...prev, book];
    });
  }

  function toggleFriend(id: string) {
    setSelectedFriends((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  }

  async function handleSubmit() {
    if (selectedBooks.length < 2 || saving) return;
    setSaving(true);

    const expires_at = new Date(Date.now() + expiryDays * 86400000).toISOString();

    const { data: poll, error: pollErr } = await supabase
      .from('polls')
      .insert({ user_id: userId, question, expires_at })
      .select()
      .single();

    if (pollErr || !poll) {
      setSaving(false);
      Alert.alert('Error', 'Failed to create poll. Please try again.');
      return;
    }

    await supabase.from('poll_options').insert(
      selectedBooks.map((b) => ({ poll_id: poll.id, book_id: b.id }))
    );

    const recipientIds = shareAll ? friends.map((f) => f.id) : selectedFriends;
    if (recipientIds.length) {
      await supabase.from('poll_recipients').insert(
        recipientIds.map((rid) => ({ poll_id: poll.id, recipient_id: rid }))
      );
    }

    setSaving(false);
    onCreated();
  }

  const canPost = selectedBooks.length >= 2 && !saving;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalContainer}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} style={styles.modalCancelBtn}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Poll</Text>
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={!canPost}
              style={[styles.modalPostBtn, !canPost && styles.modalPostBtnDisabled]}
            >
              <Text style={[styles.modalPostText, !canPost && styles.modalPostTextDisabled]}>
                {saving ? 'Posting…' : 'Post'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {/* Question */}
            <Text style={styles.fieldLabel}>Poll question</Text>
            <TextInput
              style={styles.textInput}
              value={question}
              onChangeText={setQuestion}
              maxLength={120}
              placeholder="What should I read next?"
              placeholderTextColor={Colors.muted}
            />

            {/* Book search */}
            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>
              Choose 2–6 books from your Want to Read list
            </Text>
            <TextInput
              style={styles.textInput}
              value={bookSearch}
              onChangeText={onSearchChange}
              placeholder="Search want-to-read books…"
              placeholderTextColor={Colors.muted}
              autoCorrect={false}
            />

            {/* Search results */}
            {bookSearch.length > 0 && (
              <View style={styles.searchResultsList}>
                {searching ? (
                  <View style={styles.searchHint}>
                    <ActivityIndicator size="small" color={Colors.rust} />
                  </View>
                ) : searchResults.length === 0 ? (
                  <View style={styles.searchHint}>
                    <Text style={styles.searchHintText}>No want-to-read books match "{bookSearch}"</Text>
                  </View>
                ) : (
                  searchResults.map((book) => {
                    const isSelected = !!selectedBooks.find((b) => b.id === book.id);
                    return (
                      <TouchableOpacity
                        key={book.id}
                        onPress={() => toggleBook(book)}
                        style={[styles.searchResultRow, isSelected && styles.searchResultRowSelected]}
                        activeOpacity={0.7}
                      >
                        <BookCover book={book} width={32} height={48} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.searchResultTitle} numberOfLines={1}>{book.title}</Text>
                          {book.author ? (
                            <Text style={styles.searchResultAuthor} numberOfLines={1}>{book.author}</Text>
                          ) : null}
                        </View>
                        <Text style={[styles.searchResultAction, isSelected && { color: Colors.rust }]}>
                          {isSelected ? '✓ Added' : '+ Add'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )}

            {/* Selected books chips */}
            {selectedBooks.length > 0 && (
              <View style={styles.selectedChipsRow}>
                {selectedBooks.map((book) => (
                  <TouchableOpacity
                    key={book.id}
                    onPress={() => toggleBook(book)}
                    style={styles.chip}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.chipText} numberOfLines={1}>{book.title}</Text>
                    <Text style={styles.chipRemove}> ✕</Text>
                  </TouchableOpacity>
                ))}
                <Text style={styles.chipCount}>{selectedBooks.length}/6</Text>
              </View>
            )}

            {/* Expiry */}
            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Expires in</Text>
            <View style={styles.expiryRow}>
              {EXPIRY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.days}
                  onPress={() => setExpiryDays(opt.days)}
                  style={[styles.expiryChip, expiryDays === opt.days && styles.expiryChipActive]}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.expiryChipText,
                      expiryDays === opt.days && styles.expiryChipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Share with */}
            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Share with</Text>
            <View style={styles.shareRow}>
              <TouchableOpacity
                onPress={() => setShareAll(true)}
                style={[styles.shareOption, shareAll && styles.shareOptionActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.shareOptionText, shareAll && styles.shareOptionTextActive]}>
                  All friends ({friends.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShareAll(false)}
                style={[styles.shareOption, !shareAll && styles.shareOptionActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.shareOptionText, !shareAll && styles.shareOptionTextActive]}>
                  Specific friends
                </Text>
              </TouchableOpacity>
            </View>

            {!shareAll && friends.length > 0 && (
              <View style={styles.friendList}>
                {friends.map((f) => {
                  const checked = selectedFriends.includes(f.id);
                  return (
                    <TouchableOpacity
                      key={f.id}
                      onPress={() => toggleFriend(f.id)}
                      style={styles.friendRow}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.checkBox,
                          checked && styles.checkBoxChecked,
                        ]}
                      >
                        {checked && <Text style={styles.checkMark}>✓</Text>}
                      </View>
                      <Avatar profile={{ username: f.username, avatar_url: f.avatar_url }} size={28} />
                      <Text style={styles.friendName}>{f.username}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {!shareAll && friends.length === 0 && (
              <Text style={styles.noFriendsText}>No friends to share with yet.</Text>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

type TabKey = 'active' | 'mine' | 'past';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'mine', label: 'My Polls' },
  { key: 'past', label: 'Past' },
];

export default function PollsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('active');
  const [showCreate, setShowCreate] = useState(false);

  // Resolve session once
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  async function fetchPolls(uid: string) {
    const { data: recipientRows } = await supabase
      .from('poll_recipients')
      .select('poll_id')
      .eq('recipient_id', uid);

    const sharedIds = (recipientRows || []).map((r: any) => r.poll_id);

    let query = supabase
      .from('polls')
      .select(`
        id, question, expires_at, created_at, user_id,
        profiles!polls_user_id_fkey(username, avatar_url),
        poll_options(id, book_id, books(id, title, author, cover_image_url, isbn_13, isbn_10)),
        poll_votes(user_id, option_id),
        poll_recipients(recipient_id)
      `)
      .order('created_at', { ascending: false });

    if (sharedIds.length > 0) {
      query = query.or(`user_id.eq.${uid},id.in.(${sharedIds.join(',')})`);
    } else {
      query = query.eq('user_id', uid);
    }

    const { data } = await query;
    setPolls((data as Poll[]) || []);
  }

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      setLoading(true);
      fetchPolls(userId).finally(() => setLoading(false));
    }, [userId])
  );

  async function onRefresh() {
    if (!userId) return;
    setRefreshing(true);
    await fetchPolls(userId);
    setRefreshing(false);
  }

  async function handleVote(pollId: string, optionId: string) {
    if (!userId) return;
    // Optimistic update
    setPolls((prev) =>
      prev.map((p) => {
        if (p.id !== pollId) return p;
        return {
          ...p,
          poll_votes: [...p.poll_votes, { user_id: userId, option_id: optionId }],
        };
      })
    );
    await supabase.from('poll_votes').insert({ poll_id: pollId, user_id: userId, option_id: optionId });
    // Re-fetch to sync
    if (userId) fetchPolls(userId);
  }

  async function handleClosePoll(pollId: string) {
    await supabase
      .from('polls')
      .update({ expires_at: new Date().toISOString() })
      .eq('id', pollId);
    if (userId) fetchPolls(userId);
  }

  const now = new Date();
  const activePollsAll = polls.filter((p) => new Date(p.expires_at) > now);
  const myPolls = polls.filter((p) => p.user_id === userId);
  const pastPolls = polls.filter((p) => new Date(p.expires_at) <= now);

  const displayPolls =
    activeTab === 'active' ? activePollsAll :
    activeTab === 'mine'   ? myPolls :
    pastPolls;

  const tabCounts: Record<TabKey, number> = {
    active: activePollsAll.length,
    mine: myPolls.length,
    past: pastPolls.length,
  };

  const emptyMessages: Record<TabKey, { title: string; subtitle: string }> = {
    active: {
      title: 'No active polls',
      subtitle: 'Create a poll to ask your friends what you should read next!',
    },
    mine: {
      title: 'No polls yet',
      subtitle: 'Tap + to create your first reading poll.',
    },
    past: {
      title: 'No past polls',
      subtitle: 'Closed and expired polls will appear here.',
    },
  };

  return (
    <View style={styles.root}>
      {/* Tab switcher */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const count = tabCounts[tab.key];
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab.label}
              </Text>
              {count > 0 && (
                <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>
                    {count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.rust} />
        </View>
      ) : (
        <FlatList
          data={displayPolls}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) =>
            userId ? (
              <PollCard
                poll={item}
                userId={userId}
                onVote={handleVote}
                onClosePoll={handleClosePoll}
              />
            ) : null
          }
          contentContainerStyle={[
            styles.listContent,
            displayPolls.length === 0 && styles.listContentEmpty,
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={styles.emptyTitle}>{emptyMessages[activeTab].title}</Text>
              <Text style={styles.emptySubtitle}>{emptyMessages[activeTab].subtitle}</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}

      {/* FAB */}
      {userId && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setShowCreate(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.fabIcon}>+</Text>
        </TouchableOpacity>
      )}

      {/* Create Poll Modal */}
      {showCreate && userId && (
        <CreatePollModal
          userId={userId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            if (userId) fetchPolls(userId);
          }}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginRight: 4,
  },
  tabItemActive: {
    borderBottomColor: Colors.rust,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  tabLabelActive: {
    color: Colors.rust,
    fontWeight: '600',
  },
  tabBadge: {
    marginLeft: 6,
    backgroundColor: 'rgba(26,18,8,0.07)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tabBadgeActive: {
    backgroundColor: '#fdf0ea',
  },
  tabBadgeText: {
    fontSize: 11,
    color: Colors.muted,
    fontWeight: '500',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  tabBadgeTextActive: {
    color: Colors.rust,
    fontWeight: '600',
  },

  // List
  listContent: {
    padding: 16,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Empty state
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 14,
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

  // Avatar
  avatar: {
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  avatarText: {
    color: Colors.white,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },

  // Poll card
  pollCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.07,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  pollHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
  },
  pollHeaderInfo: {
    flex: 1,
    minWidth: 0,
  },
  pollAuthorLine: {
    fontSize: 14,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  pollAuthorName: {
    fontWeight: '700',
    color: Colors.ink,
  },
  pollAsksText: {
    color: Colors.muted,
  },
  pollQuestion: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.ink,
    marginTop: 3,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    lineHeight: 22,
  },
  pollBadgeCol: {
    alignItems: 'flex-end',
    gap: 4,
    flexShrink: 0,
  },
  badgeOpen: {
    backgroundColor: '#eef3ee',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeOpenText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.sage,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  badgeClosed: {
    backgroundColor: 'rgba(26,18,8,0.07)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeClosedText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  closeEarlyBtn: {
    marginTop: 2,
  },
  closeEarlyText: {
    fontSize: 12,
    color: Colors.rust,
    textDecorationLine: 'underline',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Options
  optionsList: {
    gap: 10,
  },
  optionBtn: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    padding: 12,
    backgroundColor: Colors.card,
  },
  optionBtnSelected: {
    borderColor: Colors.rust,
    backgroundColor: '#fdf0ea',
  },
  optionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optionText: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  optionAuthor: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  yourVoteLabel: {
    fontSize: 11,
    color: Colors.rust,
    fontWeight: '600',
    marginTop: 4,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  pctLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.ink,
    flexShrink: 0,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  barTrack: {
    marginTop: 8,
    height: 6,
    backgroundColor: Colors.background,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    minWidth: 4,
  },

  // Poll footer
  pollFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  voteTotal: {
    fontSize: 12,
    color: Colors.muted,
    fontWeight: '500',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  votedBadge: {
    backgroundColor: '#eef3ee',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  votedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.sage,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  pollTime: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.rust,
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  fabIcon: {
    fontSize: 28,
    color: Colors.white,
    fontWeight: '300',
    lineHeight: 32,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  modalCancelBtn: {
    padding: 4,
  },
  modalCancelText: {
    fontSize: 16,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  modalPostBtn: {
    backgroundColor: Colors.rust,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  modalPostBtnDisabled: {
    backgroundColor: Colors.border,
  },
  modalPostText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  modalPostTextDisabled: {
    color: Colors.muted,
  },
  modalBody: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
  },

  // Form
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.muted,
    marginBottom: 8,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  textInput: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: Platform.OS === 'ios' ? 11 : 9,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Search results
  searchResultsList: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: Colors.card,
  },
  searchHint: {
    padding: 16,
    alignItems: 'center',
  },
  searchHintText: {
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchResultRowSelected: {
    backgroundColor: '#fdf0ea',
  },
  searchResultTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  searchResultAuthor: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  searchResultAction: {
    fontSize: 13,
    color: Colors.muted,
    fontWeight: '500',
    marginLeft: 8,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Selected chips
  selectedChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fdf0ea',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    maxWidth: 180,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.rust,
    flex: 1,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  chipRemove: {
    fontSize: 11,
    color: Colors.rust,
    opacity: 0.7,
  },
  chipCount: {
    fontSize: 12,
    color: Colors.muted,
    alignSelf: 'center',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Expiry picker
  expiryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  expiryChip: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.card,
  },
  expiryChipActive: {
    backgroundColor: Colors.rust,
    borderColor: Colors.rust,
  },
  expiryChipText: {
    fontSize: 14,
    color: Colors.muted,
    fontWeight: '500',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  expiryChipTextActive: {
    color: Colors.white,
  },

  // Share
  shareRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  shareOption: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.card,
  },
  shareOptionActive: {
    borderColor: Colors.rust,
    backgroundColor: '#fdf0ea',
  },
  shareOptionText: {
    fontSize: 13,
    color: Colors.muted,
    fontWeight: '500',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  shareOptionTextActive: {
    color: Colors.rust,
  },
  friendList: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.card,
  },
  checkBoxChecked: {
    backgroundColor: Colors.rust,
    borderColor: Colors.rust,
  },
  checkMark: {
    fontSize: 12,
    color: Colors.white,
    fontWeight: '700',
  },
  friendName: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  noFriendsText: {
    fontSize: 13,
    color: Colors.muted,
    marginTop: 8,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});
