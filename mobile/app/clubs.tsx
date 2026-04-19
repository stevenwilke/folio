import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../constants/colors';
import { supabase } from '../lib/supabase';
import { fetchBlockedUserIds, ContentType } from '../lib/moderation';
import ReportModal from '../components/ReportModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BookStub {
  id: string;
  title: string;
  author: string | null;
  cover_image_url: string | null;
}

interface MemberStub {
  user_id: string;
  role: string;
  profiles: {
    username: string;
    avatar_url: string | null;
  } | null;
}

interface Club {
  id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  created_by: string;
  current_book_id: string | null;
  books: BookStub | null;
  book_club_members: MemberStub[] | { count: number }[];
}

interface Post {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  profiles: {
    username: string;
    avatar_url: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const AVATAR_PALETTE = [
  Colors.rust,
  Colors.sage,
  Colors.gold,
  '#4a6fa5',
  '#7b5ea7',
  '#2d7d6f',
];

function avatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash + username.charCodeAt(i)) % AVATAR_PALETTE.length;
  }
  return AVATAR_PALETTE[hash];
}

function avatarInitial(username: string): string {
  return (username || '?').trim().charAt(0).toUpperCase();
}

// ---------------------------------------------------------------------------
// Small shared components
// ---------------------------------------------------------------------------

function AvatarCircle({
  username,
  avatarUrl,
  size = 32,
  style,
}: {
  username: string;
  avatarUrl?: string | null;
  size?: number;
  style?: object;
}) {
  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
          style,
        ]}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: avatarColor(username),
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <Text
        style={{
          color: Colors.white,
          fontSize: Math.round(size * 0.4),
          fontWeight: '700',
          fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
        }}
      >
        {avatarInitial(username)}
      </Text>
    </View>
  );
}

function AvatarStack({ members }: { members: MemberStub[] }) {
  const shown = members.slice(0, 3);
  const extra = members.length - shown.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((m, i) => (
        <AvatarCircle
          key={m.user_id}
          username={m.profiles?.username ?? '?'}
          avatarUrl={m.profiles?.avatar_url}
          size={26}
          style={{
            marginLeft: i > 0 ? -8 : 0,
            borderWidth: 2,
            borderColor: Colors.card,
          }}
        />
      ))}
      {extra > 0 && (
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: Colors.border,
            borderWidth: 2,
            borderColor: Colors.card,
            marginLeft: -8,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 9, fontWeight: '600', color: Colors.muted }}>
            +{extra}
          </Text>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Club Card
// ---------------------------------------------------------------------------

function getMemberCount(club: Club): number {
  const raw = club.book_club_members;
  if (!raw || raw.length === 0) return 0;
  // If it's a count aggregate the first item is { count: number }
  if ('count' in raw[0]) return (raw[0] as { count: number }).count;
  return raw.length;
}

function getFullMembers(club: Club): MemberStub[] {
  const raw = club.book_club_members;
  if (!raw || raw.length === 0) return [];
  if ('count' in raw[0]) return [];
  return raw as MemberStub[];
}

function ClubCard({
  club,
  isMember,
  onEnter,
  onJoin,
  joining,
}: {
  club: Club;
  isMember: boolean;
  onEnter: (club: Club) => void;
  onJoin: (clubId: string) => void;
  joining: string | null;
}) {
  const memberCount = getMemberCount(club);
  const fullMembers = getFullMembers(club);

  return (
    <View style={styles.clubCard}>
      <View style={styles.clubCardSageBorder} />
      <View style={styles.clubCardBody}>
        <Text style={styles.clubName}>{club.name}</Text>

        {/* Member row */}
        <View style={styles.memberRow}>
          {fullMembers.length > 0 && <AvatarStack members={fullMembers} />}
          <Text style={styles.memberCount}>
            {memberCount} member{memberCount !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* Current book */}
        {club.books ? (
          <View style={styles.bookRow}>
            {club.books.cover_image_url ? (
              <Image
                source={{ uri: club.books.cover_image_url }}
                style={styles.bookCoverSmall}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.bookCoverSmall, styles.bookCoverPlaceholder]}>
                <Text style={styles.bookCoverPlaceholderText}>
                  {(club.books.title || '?').charAt(0)}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.bookLabel}>Reading</Text>
              <Text style={styles.bookTitle} numberOfLines={2}>
                {club.books.title}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.noBook}>No book selected</Text>
        )}

        {/* Description */}
        {club.description ? (
          <Text style={styles.clubDescription} numberOfLines={2}>
            {club.description}
          </Text>
        ) : null}

        {/* Action */}
        <View style={styles.cardActionRow}>
          {isMember ? (
            <TouchableOpacity
              style={styles.btnEnter}
              onPress={() => onEnter(club)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnEnterText}>Enter</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.btnJoin, joining === club.id && { opacity: 0.6 }]}
              onPress={() => onJoin(club.id)}
              disabled={joining === club.id}
              activeOpacity={0.8}
            >
              <Text style={styles.btnJoinText}>
                {joining === club.id ? 'Joining…' : 'Join'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Create Club Modal
// ---------------------------------------------------------------------------

function CreateClubModal({
  userId,
  onClose,
  onCreated,
}: {
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    const { data: club, error } = await supabase
      .from('book_clubs')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        created_by: userId,
        is_public: isPublic,
      })
      .select()
      .single();

    if (error || !club) {
      setSaving(false);
      return;
    }

    await supabase.from('book_club_members').insert({
      club_id: club.id,
      user_id: userId,
      role: 'admin',
    });

    setSaving(false);
    onCreated();
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          style={styles.modalSheet}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Create a Book Club</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>
            Club name <Text style={{ color: Colors.rust }}>*</Text>
          </Text>
          <TextInput
            style={styles.textInput}
            placeholder="e.g. The Sunday Readers"
            placeholderTextColor={Colors.muted}
            value={name}
            onChangeText={setName}
            maxLength={80}
            returnKeyType="next"
          />

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
            Description{' '}
            <Text style={{ color: Colors.muted, fontWeight: '400' }}>(optional)</Text>
          </Text>
          <TextInput
            style={[styles.textInput, styles.textArea]}
            placeholder="What's this club about?"
            placeholderTextColor={Colors.muted}
            value={description}
            onChangeText={setDescription}
            maxLength={300}
            multiline
            numberOfLines={3}
          />

          {/* Public toggle */}
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setIsPublic((v) => !v)}
            activeOpacity={0.7}
          >
            <View style={[styles.togglePill, isPublic && styles.togglePillOn]}>
              <View
                style={[
                  styles.toggleThumb,
                  isPublic && styles.toggleThumbOn,
                ]}
              />
            </View>
            <Text style={styles.toggleLabel}>
              {isPublic ? 'Public — discoverable by anyone' : 'Private — invite only'}
            </Text>
          </TouchableOpacity>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.btnGhost} onPress={onClose}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.btnPrimary,
                (!name.trim() || saving) && { opacity: 0.6 },
              ]}
              onPress={handleCreate}
              disabled={!name.trim() || saving}
              activeOpacity={0.8}
            >
              <Text style={styles.btnPrimaryText}>
                {saving ? 'Creating…' : 'Create Club'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Club Detail
// ---------------------------------------------------------------------------

type DetailTab = 'discussion' | 'members';

function ClubDetail({
  club,
  userId,
  onBack,
  onClubUpdate,
}: {
  club: Club;
  userId: string;
  onBack: () => void;
  onClubUpdate: () => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>('discussion');

  // Discussion state
  const [posts, setPosts] = useState<Post[]>([]);
  const [reportTarget, setReportTarget] = useState<{ contentType: ContentType; contentId: string; reportedUserId: string } | null>(null);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [postText, setPostText] = useState('');
  const [posting, setPosting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Members state
  const [members, setMembers] = useState<MemberStub[]>([]);

  // Invite state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState<
    { id: string; username: string; avatar_url: string | null }[]
  >([]);
  const [searchingInvite, setSearchingInvite] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);

  // Change book state
  const [showChangeBook, setShowChangeBook] = useState(false);
  const [bookQuery, setBookQuery] = useState('');
  const [bookResults, setBookResults] = useState<BookStub[]>([]);
  const [searchingBooks, setSearchingBooks] = useState(false);
  const [changingBook, setChangingBook] = useState(false);

  // Derive admin status from full members list
  const [isAdmin, setIsAdmin] = useState(false);

  // Current book (may get updated when changed)
  const [currentBook, setCurrentBook] = useState<BookStub | null>(club.books);

  useEffect(() => {
    fetchPosts();
    fetchMembers();
  }, [club.id]);

  // Auto-scroll chat to bottom when posts load/update
  useEffect(() => {
    if (posts.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [posts]);

  // Book search debounce
  useEffect(() => {
    if (!showChangeBook || !bookQuery.trim()) {
      setBookResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearchingBooks(true);
      const { data } = await supabase
        .from('books')
        .select('id, title, author, cover_image_url')
        .ilike('title', `%${bookQuery.trim()}%`)
        .limit(8);
      setBookResults(data || []);
      setSearchingBooks(false);
    }, 300);
    return () => clearTimeout(t);
  }, [bookQuery, showChangeBook]);

  // Invite search debounce
  useEffect(() => {
    if (!showInvite || !inviteQuery.trim()) {
      setInviteResults([]);
      return;
    }
    const existingIds = members.map((m) => m.user_id);
    const t = setTimeout(async () => {
      setSearchingInvite(true);
      const { data } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .ilike('username', `%${inviteQuery.trim()}%`)
        .neq('id', userId)
        .limit(10);
      setInviteResults(
        (data || []).filter((p: { id: string }) => !existingIds.includes(p.id))
      );
      setSearchingInvite(false);
    }, 300);
    return () => clearTimeout(t);
  }, [inviteQuery, showInvite]);

  async function fetchPosts() {
    setLoadingPosts(true);
    const [{ data }, blockedIds] = await Promise.all([
      supabase
        .from('book_club_posts')
        .select('id, content, created_at, user_id, profiles(username, avatar_url)')
        .eq('club_id', club.id)
        .order('created_at', { ascending: true }),
      userId ? fetchBlockedUserIds(userId) : Promise.resolve([]),
    ]);
    const blockedSet = new Set(blockedIds);
    setPosts((data || []).filter((p: any) => !blockedSet.has(p.user_id)));
    setLoadingPosts(false);
  }

  async function fetchMembers() {
    const { data } = await supabase
      .from('book_club_members')
      .select('user_id, role, profiles(username, avatar_url)')
      .eq('club_id', club.id);
    const list: MemberStub[] = data || [];
    setMembers(list);
    setIsAdmin(list.some((m) => m.user_id === userId && m.role === 'admin'));
  }

  async function handlePost() {
    const content = postText.trim();
    if (!content) return;
    setPosting(true);
    await supabase.from('book_club_posts').insert({
      club_id: club.id,
      user_id: userId,
      content,
    });
    setPostText('');
    setPosting(false);
    fetchPosts();
  }

  async function handleChangeBook(bookId: string) {
    setChangingBook(true);
    const { data: updatedBooks } = await supabase
      .from('books')
      .select('id, title, author, cover_image_url')
      .eq('id', bookId)
      .single();
    await supabase
      .from('book_clubs')
      .update({ current_book_id: bookId })
      .eq('id', club.id);
    setChangingBook(false);
    setShowChangeBook(false);
    setBookQuery('');
    setBookResults([]);
    if (updatedBooks) setCurrentBook(updatedBooks);
    onClubUpdate();
  }

  async function handleInvite(inviteeId: string) {
    setInviting(inviteeId);
    await supabase.from('book_club_members').insert({
      club_id: club.id,
      user_id: inviteeId,
      role: 'member',
    });
    setInviting(null);
    setInviteQuery('');
    setInviteResults([]);
    fetchMembers();
    onClubUpdate();
  }

  // ---- Discussion Tab ----
  function renderDiscussion() {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {loadingPosts ? (
          <View style={styles.chatLoader}>
            <ActivityIndicator color={Colors.rust} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            keyboardShouldPersistTaps="handled"
          >
            {posts.length === 0 ? (
              <Text style={styles.chatEmpty}>
                No messages yet. Start the conversation!
              </Text>
            ) : (
              posts.map((post, i) => {
                const isMe = post.user_id === userId;
                const prevPost = posts[i - 1];
                const showHeader = !prevPost || prevPost.user_id !== post.user_id;
                const username = post.profiles?.username ?? 'Unknown';
                return (
                  <View
                    key={post.id}
                    style={[
                      styles.messageRow,
                      isMe ? styles.messageRowMe : styles.messageRowOther,
                    ]}
                  >
                    {!isMe && (
                      <View style={styles.messageAvatarCol}>
                        {showHeader ? (
                          <AvatarCircle
                            username={username}
                            avatarUrl={post.profiles?.avatar_url}
                            size={28}
                          />
                        ) : (
                          <View style={{ width: 28 }} />
                        )}
                      </View>
                    )}
                    <View
                      style={[
                        styles.messageBubbleCol,
                        isMe ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' },
                      ]}
                    >
                      {showHeader && (
                        <Text style={styles.messageUsername}>
                          {isMe ? 'You' : username}
                        </Text>
                      )}
                      <View
                        style={[
                          styles.bubble,
                          isMe ? styles.bubbleMe : styles.bubbleOther,
                        ]}
                      >
                        <Text
                          style={[
                            styles.bubbleText,
                            isMe ? styles.bubbleTextMe : styles.bubbleTextOther,
                          ]}
                        >
                          {post.content}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                        <Text style={styles.bubbleTime}>{timeAgo(post.created_at)}</Text>
                        {!isMe && (
                          <TouchableOpacity
                            onPress={() => setReportTarget({ contentType: 'club_post', contentId: post.id, reportedUserId: post.user_id })}
                            hitSlop={8}
                          >
                            <Text style={[styles.bubbleTime, { textDecorationLine: 'underline' }]}>Report</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    {isMe && <View style={{ width: 28 }} />}
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        {/* Chat input */}
        <View style={styles.chatInputRow}>
          <TextInput
            style={styles.chatInput}
            placeholder="Add to the discussion…"
            placeholderTextColor={Colors.muted}
            value={postText}
            onChangeText={setPostText}
            multiline
            maxLength={1000}
            returnKeyType="send"
            onSubmitEditing={handlePost}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!postText.trim() || posting) && { opacity: 0.5 },
            ]}
            onPress={handlePost}
            disabled={!postText.trim() || posting}
            activeOpacity={0.8}
          >
            <Text style={styles.sendBtnText}>{posting ? '…' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ---- Members Tab ----
  function renderMembers() {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.membersContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Invite section */}
        {isAdmin && (
          <View style={styles.adminSection}>
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={() => setShowInvite((v) => !v)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnSecondaryText}>
                {showInvite ? 'Cancel Invite' : '+ Invite Member'}
              </Text>
            </TouchableOpacity>

            {showInvite && (
              <View style={styles.searchBlock}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Search by username…"
                  placeholderTextColor={Colors.muted}
                  value={inviteQuery}
                  onChangeText={setInviteQuery}
                  autoFocus
                />
                {inviteQuery.trim().length > 0 && (
                  <View style={styles.searchResults}>
                    {searchingInvite ? (
                      <Text style={styles.searchHint}>Searching…</Text>
                    ) : inviteResults.length === 0 ? (
                      <Text style={styles.searchHint}>No users found</Text>
                    ) : (
                      inviteResults.map((u) => (
                        <View key={u.id} style={styles.searchResultRow}>
                          <AvatarCircle
                            username={u.username}
                            avatarUrl={u.avatar_url}
                            size={28}
                          />
                          <Text style={styles.searchResultName}>{u.username}</Text>
                          <TouchableOpacity
                            style={[
                              styles.btnSmall,
                              inviting === u.id && { opacity: 0.6 },
                            ]}
                            onPress={() => handleInvite(u.id)}
                            disabled={inviting === u.id}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.btnSmallText}>
                              {inviting === u.id ? '…' : 'Add'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Change book section */}
        {isAdmin && (
          <View style={styles.adminSection}>
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={() => setShowChangeBook((v) => !v)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnSecondaryText}>
                {showChangeBook ? 'Cancel' : 'Change Current Book'}
              </Text>
            </TouchableOpacity>

            {showChangeBook && (
              <View style={styles.searchBlock}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Search for a book title…"
                  placeholderTextColor={Colors.muted}
                  value={bookQuery}
                  onChangeText={setBookQuery}
                  autoFocus
                />
                {bookQuery.trim().length > 0 && (
                  <View style={styles.searchResults}>
                    {searchingBooks ? (
                      <Text style={styles.searchHint}>Searching…</Text>
                    ) : bookResults.length === 0 ? (
                      <Text style={styles.searchHint}>No books found</Text>
                    ) : (
                      bookResults.map((b) => (
                        <TouchableOpacity
                          key={b.id}
                          style={[
                            styles.searchResultRow,
                            changingBook && { opacity: 0.6 },
                          ]}
                          onPress={() => handleChangeBook(b.id)}
                          disabled={changingBook}
                          activeOpacity={0.7}
                        >
                          {b.cover_image_url ? (
                            <Image
                              source={{ uri: b.cover_image_url }}
                              style={styles.bookCoverTiny}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={[styles.bookCoverTiny, styles.bookCoverPlaceholder]}>
                              <Text style={styles.bookCoverPlaceholderText}>
                                {(b.title || '?').charAt(0)}
                              </Text>
                            </View>
                          )}
                          <View style={{ flex: 1 }}>
                            <Text style={styles.searchResultName} numberOfLines={1}>
                              {b.title}
                            </Text>
                            {b.author && (
                              <Text style={styles.searchResultSub} numberOfLines={1}>
                                {b.author}
                              </Text>
                            )}
                          </View>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Member list */}
        <Text style={styles.sectionHeader}>Members</Text>
        {members.map((m) => (
          <View key={m.user_id} style={styles.memberListRow}>
            <AvatarCircle
              username={m.profiles?.username ?? '?'}
              avatarUrl={m.profiles?.avatar_url}
              size={36}
            />
            <Text style={styles.memberListName}>
              {m.profiles?.username ?? 'Unknown'}
            </Text>
            <View
              style={[
                styles.roleBadge,
                m.role === 'admin' ? styles.roleBadgeAdmin : styles.roleBadgeMember,
              ]}
            >
              <Text
                style={[
                  styles.roleBadgeText,
                  m.role === 'admin'
                    ? styles.roleBadgeTextAdmin
                    : styles.roleBadgeTextMember,
                ]}
              >
                {m.role === 'admin' ? 'Admin' : 'Member'}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={styles.detailRoot}>
      {/* Back row */}
      <TouchableOpacity style={styles.backRow} onPress={onBack} activeOpacity={0.7}>
        <Text style={styles.backText}>← Clubs</Text>
      </TouchableOpacity>

      {/* Club header */}
      <View style={styles.detailHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.detailClubName}>{club.name}</Text>
          <Text style={styles.detailMemberCount}>
            {members.length} member{members.length !== 1 ? 's' : ''}
          </Text>
        </View>
        {currentBook && (
          <View style={styles.detailBookRow}>
            {currentBook.cover_image_url ? (
              <Image
                source={{ uri: currentBook.cover_image_url }}
                style={styles.detailBookCover}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.detailBookCover, styles.bookCoverPlaceholder]}>
                <Text style={styles.bookCoverPlaceholderText}>
                  {(currentBook.title || '?').charAt(0)}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.bookLabel}>Reading</Text>
              <Text style={styles.detailBookTitle} numberOfLines={2}>
                {currentBook.title}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Tab pill switcher */}
      <View style={styles.pillSwitcher}>
        <TouchableOpacity
          style={[styles.pill, activeTab === 'discussion' && styles.pillActive]}
          onPress={() => setActiveTab('discussion')}
          activeOpacity={0.8}
        >
          <Text
            style={[styles.pillText, activeTab === 'discussion' && styles.pillTextActive]}
          >
            Discussion
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pill, activeTab === 'members' && styles.pillActive]}
          onPress={() => setActiveTab('members')}
          activeOpacity={0.8}
        >
          <Text
            style={[styles.pillText, activeTab === 'members' && styles.pillTextActive]}
          >
            Members
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab content */}
      <View style={{ flex: 1 }}>
        {activeTab === 'discussion' ? renderDiscussion() : renderMembers()}
      </View>

      <ReportModal
        visible={!!reportTarget}
        onClose={() => setReportTarget(null)}
        contentType={reportTarget?.contentType ?? 'club_post'}
        contentId={reportTarget?.contentId ?? ''}
        reportedUserId={reportTarget?.reportedUserId}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function ClubsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [myClubs, setMyClubs] = useState<Club[]>([]);
  const [discoverClubs, setDiscoverClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);

  async function fetchClubs(uid: string) {
    // My clubs
    const { data: memberRows } = await supabase
      .from('book_club_members')
      .select(`
        role,
        book_clubs(
          id, name, description, is_public, created_by,
          current_book_id,
          books(id, title, author, cover_image_url),
          book_club_members(user_id, role, profiles(username, avatar_url))
        )
      `)
      .eq('user_id', uid);

    const joined: Club[] = [];
    const joinedIds = new Set<string>();

    (memberRows || []).forEach((row: any) => {
      const bc = row.book_clubs;
      if (bc) {
        joined.push(bc as Club);
        joinedIds.add(bc.id);
      }
    });
    setMyClubs(joined);

    // Discover public clubs not already joined
    const { data: publicClubs } = await supabase
      .from('book_clubs')
      .select('id, name, description, is_public, created_by, current_book_id, book_club_members(count)')
      .eq('is_public', true);

    const discover = (publicClubs || []).filter(
      (c: { id: string }) => !joinedIds.has(c.id)
    ) as Club[];
    setDiscoverClubs(discover);
  }

  async function loadAll() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    setUserId(session.user.id);
    await fetchClubs(session.user.id);
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadAll().finally(() => setLoading(false));
    }, [])
  );

  async function handleJoin(clubId: string) {
    if (!userId) return;
    setJoining(clubId);
    await supabase.from('book_club_members').insert({
      club_id: clubId,
      user_id: userId,
      role: 'member',
    });
    setJoining(null);
    await fetchClubs(userId);
  }

  async function handleRefresh() {
    if (!userId) return;
    setRefreshing(true);
    await fetchClubs(userId);
    setRefreshing(false);
  }

  function handleClubUpdate() {
    if (userId) fetchClubs(userId);
  }

  // ---- Detail view ----
  if (selectedClub && userId) {
    return (
      <ClubDetail
        club={selectedClub}
        userId={userId}
        onBack={() => setSelectedClub(null)}
        onClubUpdate={handleClubUpdate}
      />
    );
  }

  // ---- Loading ----
  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  // ---- List view ----
  const sections: { title: string; data: Club[]; isMember: boolean }[] = [
    { title: 'My Clubs', data: myClubs, isMember: true },
    { title: 'Discover Clubs', data: discoverClubs, isMember: false },
  ];

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <Text style={{ display: 'none' }} />
        }
      >
        {sections.map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionHeader}>{section.title}</Text>
            {section.data.length === 0 ? (
              <Text style={styles.sectionEmpty}>
                {section.isMember
                  ? "You haven't joined any clubs yet."
                  : 'No public clubs to discover right now.'}
              </Text>
            ) : (
              section.data.map((club) => (
                <ClubCard
                  key={club.id}
                  club={club}
                  isMember={section.isMember}
                  onEnter={setSelectedClub}
                  onJoin={handleJoin}
                  joining={joining}
                />
              ))
            )}
          </View>
        ))}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowCreate(true)}
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>+ Create Club</Text>
      </TouchableOpacity>

      {/* Create modal */}
      {showCreate && userId && (
        <CreateClubModal
          userId={userId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            if (userId) fetchClubs(userId);
          }}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
const SANS = Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' });

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
    paddingBottom: 100,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: SERIF,
    marginTop: 8,
    marginBottom: 10,
  },
  sectionEmpty: {
    fontSize: 14,
    color: Colors.muted,
    fontFamily: SANS,
    marginBottom: 16,
    fontStyle: 'italic',
  },

  // Club card
  clubCard: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
    overflow: 'hidden',
  },
  clubCardSageBorder: {
    width: 4,
    backgroundColor: Colors.sage,
  },
  clubCardBody: {
    flex: 1,
    padding: 12,
  },
  clubName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: SERIF,
    marginBottom: 6,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  memberCount: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: SANS,
  },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  bookCoverSmall: {
    width: 40,
    height: 56,
    borderRadius: 3,
    flexShrink: 0,
  },
  bookCoverTiny: {
    width: 30,
    height: 42,
    borderRadius: 3,
    flexShrink: 0,
  },
  bookCoverPlaceholder: {
    backgroundColor: Colors.sage,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bookCoverPlaceholderText: {
    color: Colors.white,
    fontWeight: '700',
    fontFamily: SERIF,
    fontSize: 14,
  },
  bookLabel: {
    fontSize: 10,
    color: Colors.muted,
    fontFamily: SANS,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  bookTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: SERIF,
  },
  noBook: {
    fontSize: 13,
    color: Colors.muted,
    fontFamily: SANS,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  clubDescription: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: SANS,
    lineHeight: 17,
    marginBottom: 4,
  },
  cardActionRow: {
    marginTop: 10,
    flexDirection: 'row',
  },
  btnEnter: {
    backgroundColor: Colors.rust,
    paddingVertical: 7,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  btnEnterText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: SANS,
  },
  btnJoin: {
    backgroundColor: Colors.sage,
    paddingVertical: 7,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  btnJoinText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: SANS,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 20,
    backgroundColor: Colors.rust,
    borderRadius: 28,
    paddingVertical: 12,
    paddingHorizontal: 20,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  fabText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: SANS,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: SERIF,
  },
  modalClose: {
    fontSize: 16,
    color: Colors.muted,
    fontFamily: SANS,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: SANS,
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: SANS,
    backgroundColor: Colors.background,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  togglePill: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.border,
    justifyContent: 'center',
    padding: 2,
  },
  togglePillOn: {
    backgroundColor: Colors.rust,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.white,
    alignSelf: 'flex-start',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  toggleLabel: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: SANS,
    flex: 1,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  btnGhost: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnGhostText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: SANS,
  },
  btnPrimary: {
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: Colors.rust,
  },
  btnPrimaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
    fontFamily: SANS,
  },

  // Detail
  detailRoot: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  backRow: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 16,
    paddingBottom: 8,
  },
  backText: {
    fontSize: 15,
    color: Colors.rust,
    fontWeight: '600',
    fontFamily: SANS,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  detailClubName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: SERIF,
    marginBottom: 2,
  },
  detailMemberCount: {
    fontSize: 13,
    color: Colors.muted,
    fontFamily: SANS,
  },
  detailBookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
    maxWidth: 160,
  },
  detailBookCover: {
    width: 50,
    height: 70,
    borderRadius: 4,
    flexShrink: 0,
  },
  detailBookTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: SERIF,
  },

  // Pill switcher
  pillSwitcher: {
    flexDirection: 'row',
    margin: 14,
    backgroundColor: Colors.border,
    borderRadius: 20,
    padding: 3,
  },
  pill: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 18,
    alignItems: 'center',
  },
  pillActive: {
    backgroundColor: Colors.card,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  pillText: {
    fontSize: 13,
    color: Colors.muted,
    fontWeight: '600',
    fontFamily: SANS,
  },
  pillTextActive: {
    color: Colors.ink,
  },

  // Chat
  chatLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    padding: 12,
    paddingBottom: 8,
  },
  chatEmpty: {
    textAlign: 'center',
    color: Colors.muted,
    fontSize: 14,
    fontFamily: SANS,
    fontStyle: 'italic',
    paddingVertical: 32,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 6,
    gap: 6,
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  messageAvatarCol: {
    flexShrink: 0,
  },
  messageBubbleCol: {
    maxWidth: '72%',
    gap: 2,
  },
  messageUsername: {
    fontSize: 11,
    color: Colors.muted,
    fontFamily: SANS,
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleMe: {
    backgroundColor: Colors.rust,
    borderRadius: 14,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: SANS,
  },
  bubbleTextMe: {
    color: Colors.white,
  },
  bubbleTextOther: {
    color: Colors.ink,
  },
  bubbleTime: {
    fontSize: 10,
    color: Colors.muted,
    fontFamily: SANS,
    paddingHorizontal: 4,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.card,
    gap: 8,
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: SANS,
    backgroundColor: Colors.background,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: Colors.rust,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  sendBtnText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: SANS,
  },

  // Members tab
  membersContent: {
    padding: 16,
    paddingBottom: 40,
  },
  adminSection: {
    marginBottom: 14,
  },
  btnSecondary: {
    borderWidth: 1,
    borderColor: Colors.rust,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  btnSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.rust,
    fontFamily: SANS,
  },
  searchBlock: {
    marginTop: 10,
  },
  searchResults: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.card,
    overflow: 'hidden',
  },
  searchHint: {
    fontSize: 13,
    color: Colors.muted,
    fontFamily: SANS,
    fontStyle: 'italic',
    padding: 10,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchResultName: {
    flex: 1,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: SANS,
    fontWeight: '600',
  },
  searchResultSub: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: SANS,
  },
  btnSmall: {
    backgroundColor: Colors.rust,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  btnSmallText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: SANS,
  },
  memberListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  memberListName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: SANS,
  },
  roleBadge: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  roleBadgeAdmin: {
    backgroundColor: Colors.statusBg.reading,
  },
  roleBadgeMember: {
    backgroundColor: Colors.statusBg.owned,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: SANS,
  },
  roleBadgeTextAdmin: {
    color: Colors.rust,
  },
  roleBadgeTextMember: {
    color: Colors.sage,
  },
});
