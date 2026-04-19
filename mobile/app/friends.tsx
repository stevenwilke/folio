import React, { useState, useEffect, useCallback } from 'react';
import { sendPushNotification } from '../lib/notifications';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Image,
  StyleSheet,
  Platform,
  RefreshControl,
  SectionList,
  Share,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as Contacts from 'expo-contacts';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
import { fetchBlockedUserIds } from '../lib/moderation';

// ── Types ──────────────────────────────────────────────────
interface FriendProfile {
  id: string;
  username: string;
  avatar_url: string | null;
  friendshipId: string;
  stats: { total: number; read: number };
}

interface PendingRequest {
  id: string;
  profiles: { id: string; username: string; avatar_url: string | null } | null;
}

interface SearchResult {
  id: string;
  username: string;
  avatar_url: string | null;
  friendship: {
    friendshipId: string;
    status: string;
    iAmRequester: boolean;
  } | null;
}

// ── Main Screen ────────────────────────────────────────────
export default function FriendsScreen() {
  const router = useRouter();

  const [myId, setMyId] = useState<string | null>(null);
  const [friends, setFriends]   = useState<FriendProfile[]>([]);
  const [incoming, setIncoming] = useState<PendingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<PendingRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing]     = useState<string | null>(null);

  const [search, setSearch]               = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching]         = useState(false);
  const [searched, setSearched]           = useState(false);

  // Contacts / People You May Know
  const [contactMatches, setContactMatches]       = useState<SearchResult[]>([]);
  const [contactsLoading, setContactsLoading]     = useState(false);
  const [contactsChecked, setContactsChecked]     = useState(false);

  // Invite
  const [inviteCopied, setInviteCopied] = useState(false);
  const [myUsername, setMyUsername]     = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [])
  );

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setMyId(user.id);
    setLoading(true);
    const [, { data: profile }] = await Promise.all([
      fetchAll(user.id),
      supabase.from('profiles').select('username').eq('id', user.id).single(),
    ]);
    setMyUsername(profile?.username ?? null);
    setLoading(false);
  }

  // ── Contacts import ─────────────────────────────────────────
  async function importContacts() {
    setContactsLoading(true);
    setContactsChecked(false);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Contacts Access Needed',
          'Allow Ex Libris to access your contacts so we can find friends who are already on the app.',
          [{ text: 'OK' }]
        );
        setContactsLoading(false);
        return;
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Emails],
      });

      const emails: string[] = [];
      for (const c of data) {
        for (const e of c.emails ?? []) {
          if (e.email) emails.push(e.email.toLowerCase());
        }
      }

      if (!emails.length) {
        setContactMatches([]);
        setContactsChecked(true);
        setContactsLoading(false);
        return;
      }

      // Batch into chunks of 100 to stay within URL limits
      const chunks: string[][] = [];
      for (let i = 0; i < emails.length; i += 100) chunks.push(emails.slice(i, i + 100));

      let allMatches: any[] = [];
      for (const chunk of chunks) {
        const { data: matches } = await supabase.rpc('match_contacts_by_email', { emails: chunk });
        allMatches = allMatches.concat(matches ?? []);
      }

      // Deduplicate
      const seen = new Set<string>();
      allMatches = allMatches.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });

      // Check friendship status for each match
      if (allMatches.length && myId) {
        const ids = allMatches.map((m: any) => m.id);
        const { data: fs } = await supabase
          .from('friendships')
          .select('id, requester_id, addressee_id, status')
          .or(
            ids.map((id: string) =>
              `and(requester_id.eq.${myId},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${myId})`
            ).join(',')
          );
        const statusMap: Record<string, any> = {};
        for (const f of fs ?? []) {
          const otherId = f.requester_id === myId ? f.addressee_id : f.requester_id;
          statusMap[otherId] = { friendshipId: f.id, status: f.status, iAmRequester: f.requester_id === myId };
        }
        allMatches = allMatches.map((m: any) => ({ ...m, friendship: statusMap[m.id] ?? null }));
      }

      setContactMatches(allMatches);
      setContactsChecked(true);
    } catch (err) {
      console.error('Contacts error:', err);
    }
    setContactsLoading(false);
  }

  // ── Invite link ──────────────────────────────────────────────
  const inviteLink = `https://exlibris.app/join${myUsername ? `?ref=${myUsername}` : ''}`;

  async function shareInvite() {
    try {
      await Share.share({
        message: `I'm using Ex Libris to track my book collection and share reads with friends. Join me! ${inviteLink}`,
        url: inviteLink,
        title: 'Join me on Ex Libris',
      });
    } catch {}
  }

  async function copyInviteLink() {
    await Clipboard.setStringAsync(inviteLink);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2500);
  }

  async function fetchAll(userId: string) {
    const [{ data: fs }, { data: incRaw }, { data: outRaw }] = await Promise.all([
      supabase
        .from('friendships')
        .select('id, requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
      supabase
        .from('friendships')
        .select('id, requester_id')
        .eq('addressee_id', userId)
        .eq('status', 'pending'),
      supabase
        .from('friendships')
        .select('id, addressee_id')
        .eq('requester_id', userId)
        .eq('status', 'pending'),
    ]);

    // Look up profiles for pending requests
    const pendingIds = [...new Set([
      ...(incRaw || []).map((f: any) => f.requester_id),
      ...(outRaw || []).map((f: any) => f.addressee_id),
    ])];
    let pendingProfileMap: Record<string, any> = {};
    if (pendingIds.length) {
      const { data: ps } = await supabase.from('profiles').select('id, username, avatar_url').in('id', pendingIds);
      pendingProfileMap = Object.fromEntries((ps || []).map((p: any) => [p.id, p]));
    }

    const inc = (incRaw || []).map((f: any) => ({ ...f, profiles: pendingProfileMap[f.requester_id] || null }));
    const out = (outRaw || []).map((f: any) => ({ ...f, profiles: pendingProfileMap[f.addressee_id] || null }));

    setIncoming(inc as unknown as PendingRequest[]);
    setOutgoing(out as unknown as PendingRequest[]);

    const friendIds = (fs || []).map((f: any) =>
      f.requester_id === userId ? f.addressee_id : f.requester_id
    );

    if (!friendIds.length) { setFriends([]); return; }

    const [{ data: profiles }, { data: counts }] = await Promise.all([
      supabase.from('profiles').select('id, username, avatar_url').in('id', friendIds),
      supabase.from('collection_entries').select('user_id, read_status').in('user_id', friendIds),
    ]);

    const countMap: Record<string, { total: number; read: number }> = {};
    for (const e of counts || []) {
      if (!countMap[e.user_id]) countMap[e.user_id] = { total: 0, read: 0 };
      countMap[e.user_id].total++;
      if (e.read_status === 'read') countMap[e.user_id].read++;
    }

    const fsIdMap: Record<string, string> = {};
    for (const f of fs || []) {
      const fid = (f as any).requester_id === userId ? (f as any).addressee_id : (f as any).requester_id;
      fsIdMap[fid] = f.id;
    }

    setFriends(
      (profiles || []).map((p: any) => ({
        ...p,
        friendshipId: fsIdMap[p.id],
        stats: countMap[p.id] || { total: 0, read: 0 },
      }))
    );
  }

  async function onRefresh() {
    if (!myId) return;
    setRefreshing(true);
    await fetchAll(myId);
    setRefreshing(false);
  }

  async function respondToRequest(id: string, accept: boolean) {
    setActing(id);
    if (accept) {
      await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id);
    } else {
      await supabase.from('friendships').delete().eq('id', id);
    }
    setActing(null);
    if (myId) { await fetchAll(myId); if (searched) runSearch(myId); }
  }

  async function cancelOutgoing(id: string) {
    setActing(id);
    await supabase.from('friendships').delete().eq('id', id);
    setActing(null);
    if (myId) fetchAll(myId);
  }

  async function unfriend(friendshipId: string) {
    setActing(friendshipId);
    await supabase.from('friendships').delete().eq('id', friendshipId);
    setActing(null);
    if (myId) fetchAll(myId);
  }

  async function runSearch(userId?: string) {
    const uid = userId ?? myId;
    const q = search.trim();
    if (!q || !uid) return;
    setSearching(true);
    setSearched(true);

    const blockedIds = await fetchBlockedUserIds(uid);
    const blockedSet = new Set(blockedIds);

    const { data: raw } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${q}%`)
      .neq('id', uid)
      .limit(30);

    const data = (raw || []).filter((p: any) => !blockedSet.has(p.id)).slice(0, 20);
    const ids = data.map((p: any) => p.id);
    let statusMap: Record<string, any> = {};
    if (ids.length) {
      const { data: fs } = await supabase
        .from('friendships')
        .select('id, requester_id, addressee_id, status')
        .or(
          ids.map((id: string) =>
            `and(requester_id.eq.${uid},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${uid})`
          ).join(',')
        );
      for (const f of fs || []) {
        const otherId = f.requester_id === uid ? f.addressee_id : f.requester_id;
        statusMap[otherId] = { friendshipId: f.id, status: f.status, iAmRequester: f.requester_id === uid };
      }
    }

    setSearchResults((data || []).map((p: any) => ({ ...p, friendship: statusMap[p.id] || null })));
    setSearching(false);
  }

  async function addFriend(userId: string) {
    if (!myId) return;
    setActing(userId);
    await supabase.from('friendships').insert({ requester_id: myId, addressee_id: userId });
    // Notify the recipient of the friend request
    const { data: me } = await supabase.from('profiles').select('username').eq('id', myId).single();
    sendPushNotification(
      userId,
      'New Friend Request',
      `${me?.username ?? 'Someone'} sent you a friend request on Ex Libris`,
      { type: 'friend_request' }
    );
    setActing(null);
    runSearch(myId);
    fetchAll(myId);
  }

  async function cancelSearchRequest(friendshipId: string, userId: string) {
    setActing(userId);
    await supabase.from('friendships').delete().eq('id', friendshipId);
    setActing(null);
    if (myId) { runSearch(myId); fetchAll(myId); }
  }

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />}
      keyboardShouldPersistTaps="handled"
    >

      {/* ── Pending requests ── */}
      {incoming.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Friend Requests</Text>
            <View style={styles.badge}><Text style={styles.badgeText}>{incoming.length}</Text></View>
          </View>
          {incoming.map((req) => (
            <View key={req.id} style={styles.requestRow}>
              <UserAvatar profile={req.profiles} size={44} />
              <View style={styles.requestInfo}>
                <Text
                  style={styles.requestName}
                  onPress={() => router.push(`/profile/${req.profiles?.username}` as any)}
                >
                  {req.profiles?.username}
                </Text>
                <Text style={styles.requestSub}>wants to be friends</Text>
              </View>
              <View style={styles.requestBtns}>
                <TouchableOpacity
                  style={styles.btnAccept}
                  onPress={() => respondToRequest(req.id, true)}
                  disabled={acting === req.id}
                >
                  <Text style={styles.btnAcceptText}>{acting === req.id ? '…' : 'Accept'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnDecline}
                  onPress={() => respondToRequest(req.id, false)}
                  disabled={acting === req.id}
                >
                  <Text style={styles.btnDeclineText}>Decline</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Invite Friends ── */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Invite Friends</Text>
        </View>
        <View style={styles.inviteCard}>
          <Text style={styles.inviteText}>
            Know someone who loves books? Share your invite link and they'll land right on Ex Libris.
          </Text>
          <View style={styles.inviteLinkRow}>
            <Text style={styles.inviteLinkText} numberOfLines={1}>{inviteLink}</Text>
          </View>
          <View style={styles.inviteBtnRow}>
            <TouchableOpacity style={styles.btnShare} onPress={shareInvite}>
              <Text style={styles.btnShareText}>📤  Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnCopy} onPress={copyInviteLink}>
              <Text style={styles.btnCopyText}>{inviteCopied ? '✓ Copied!' : 'Copy Link'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── People You May Know (contacts) ── */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>People You May Know</Text>
        </View>
        {!contactsChecked ? (
          <TouchableOpacity
            style={styles.contactsBtn}
            onPress={importContacts}
            disabled={contactsLoading}
          >
            {contactsLoading
              ? <ActivityIndicator size="small" color={Colors.rust} />
              : <Text style={styles.contactsBtnText}>📇  Find friends from your contacts</Text>
            }
          </TouchableOpacity>
        ) : contactMatches.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyTitle}>No matches found</Text>
            <Text style={styles.emptySub}>None of your contacts are on Ex Libris yet — invite them!</Text>
            <TouchableOpacity style={[styles.contactsBtn, { marginTop: 12 }]} onPress={importContacts} disabled={contactsLoading}>
              <Text style={styles.contactsBtnText}>🔄  Refresh contacts</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {contactMatches.map((user) => {
              const f = user.friendship;
              return (
                <View key={user.id} style={styles.searchResultRow}>
                  <UserAvatar profile={user} size={40} />
                  <Text
                    style={styles.searchResultName}
                    onPress={() => router.push(`/profile/${user.username}` as any)}
                  >
                    {user.username}
                  </Text>
                  <View>
                    {!f && (
                      <TouchableOpacity style={styles.btnAdd} onPress={() => addFriend(user.id)} disabled={acting === user.id}>
                        <Text style={styles.btnAddText}>{acting === user.id ? '…' : '+ Add'}</Text>
                      </TouchableOpacity>
                    )}
                    {f?.status === 'accepted' && <Text style={styles.friendChip}>Friends ✓</Text>}
                    {f?.status === 'pending' && f?.iAmRequester && (
                      <TouchableOpacity style={styles.btnPending} onPress={() => cancelSearchRequest(f.friendshipId, user.id)} disabled={acting === user.id}>
                        <Text style={styles.btnPendingText}>{acting === user.id ? '…' : 'Requested'}</Text>
                      </TouchableOpacity>
                    )}
                    {f?.status === 'pending' && !f?.iAmRequester && (
                      <TouchableOpacity style={styles.btnAccept} onPress={() => respondToRequest(f.friendshipId, true)} disabled={acting === f.friendshipId}>
                        <Text style={styles.btnAcceptText}>Accept</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
            <TouchableOpacity style={[styles.contactsBtn, { marginTop: 8 }]} onPress={importContacts} disabled={contactsLoading}>
              <Text style={styles.contactsBtnText}>🔄  Refresh</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── Find people ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Find People</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by username…"
            placeholderTextColor={Colors.muted}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => runSearch()}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.btnSearch, (!search.trim() || searching) && { opacity: 0.5 }]}
            onPress={() => runSearch()}
            disabled={!search.trim() || searching}
          >
            <Text style={styles.btnSearchText}>{searching ? '…' : 'Search'}</Text>
          </TouchableOpacity>
        </View>

        {searched && !searching && (
          <View style={styles.searchResults}>
            {searchResults.length === 0 ? (
              <Text style={styles.emptySearch}>No users found for "{search}"</Text>
            ) : (
              searchResults.map((user) => {
                const f = user.friendship;
                return (
                  <View key={user.id} style={styles.searchResultRow}>
                    <UserAvatar profile={user} size={40} />
                    <Text
                      style={styles.searchResultName}
                      onPress={() => router.push(`/profile/${user.username}` as any)}
                    >
                      {user.username}
                    </Text>
                    <View>
                      {!f && (
                        <TouchableOpacity style={styles.btnAdd} onPress={() => addFriend(user.id)} disabled={acting === user.id}>
                          <Text style={styles.btnAddText}>{acting === user.id ? '…' : '+ Add'}</Text>
                        </TouchableOpacity>
                      )}
                      {f?.status === 'accepted' && (
                        <Text style={styles.friendChip}>Friends ✓</Text>
                      )}
                      {f?.status === 'pending' && f?.iAmRequester && (
                        <TouchableOpacity style={styles.btnPending} onPress={() => cancelSearchRequest(f.friendshipId, user.id)} disabled={acting === user.id}>
                          <Text style={styles.btnPendingText}>{acting === user.id ? '…' : 'Requested'}</Text>
                        </TouchableOpacity>
                      )}
                      {f?.status === 'pending' && !f?.iAmRequester && (
                        <TouchableOpacity style={styles.btnAccept} onPress={() => respondToRequest(f.friendshipId, true)} disabled={acting === f.friendshipId}>
                          <Text style={styles.btnAcceptText}>Accept</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}
      </View>

      {/* ── Friends list ── */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>My Friends</Text>
          {friends.length > 0 && (
            <View style={styles.countChip}><Text style={styles.countChipText}>{friends.length}</Text></View>
          )}
        </View>

        {friends.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>No friends yet</Text>
            <Text style={styles.emptySub}>Search for people above to connect with other readers.</Text>
          </View>
        ) : (
          <View style={styles.friendsGrid}>
            {friends.map((friend) => (
              <FriendCard
                key={friend.id}
                friend={friend}
                onVisit={() => router.push(`/profile/${friend.username}` as any)}
                onUnfriend={() => unfriend(friend.friendshipId)}
                acting={acting === friend.friendshipId}
              />
            ))}
          </View>
        )}
      </View>

      {/* ── Sent requests ── */}
      {outgoing.length > 0 && (
        <View style={[styles.section, { marginBottom: 32 }]}>
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { fontSize: 15 }]}>Sent Requests</Text>
            <View style={styles.countChip}><Text style={styles.countChipText}>{outgoing.length}</Text></View>
          </View>
          {outgoing.map((req) => (
            <View key={req.id} style={styles.requestRow}>
              <UserAvatar profile={req.profiles} size={40} />
              <View style={styles.requestInfo}>
                <Text style={styles.requestName}>{req.profiles?.username}</Text>
                <Text style={styles.requestSub}>Request pending</Text>
              </View>
              <TouchableOpacity style={styles.btnDecline} onPress={() => cancelOutgoing(req.id)} disabled={acting === req.id}>
                <Text style={styles.btnDeclineText}>{acting === req.id ? '…' : 'Cancel'}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

    </ScrollView>
  );
}

// ── Friend Card ────────────────────────────────────────────
function FriendCard({ friend, onVisit, onUnfriend, acting }: {
  friend: FriendProfile;
  onVisit: () => void;
  onUnfriend: () => void;
  acting: boolean;
}) {
  return (
    <View style={styles.friendCard}>
      <TouchableOpacity onPress={onVisit} style={styles.friendCardTop}>
        <UserAvatar profile={friend} size={56} />
        <Text style={styles.friendName} numberOfLines={1}>{friend.username}</Text>
        <Text style={styles.friendStats}>
          {friend.stats.total > 0
            ? `${friend.stats.total} book${friend.stats.total !== 1 ? 's' : ''} · ${friend.stats.read} read`
            : 'No books yet'}
        </Text>
      </TouchableOpacity>
      <View style={styles.friendCardActions}>
        <TouchableOpacity style={styles.btnVisit} onPress={onVisit}>
          <Text style={styles.btnVisitText}>Profile</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnUnfriend} onPress={onUnfriend} disabled={acting}>
          <Text style={styles.btnUnfriendText}>{acting ? '…' : 'Remove'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── User Avatar ────────────────────────────────────────────
function UserAvatar({ profile, size }: { profile: { username?: string | null; avatar_url?: string | null } | null; size: number }) {
  const colors = [Colors.rust, Colors.sage, Colors.gold, '#4a6fa5', '#7b5ea7'];
  const username = profile?.username ?? '?';
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash + username.charCodeAt(i)) % colors.length;
  const bg = colors[hash];

  if (profile?.avatar_url) {
    return <Image source={{ uri: profile.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: '#fff', fontSize: size * 0.38, fontWeight: '700', fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) }}>
        {username.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },
  loader:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },

  section:      { marginBottom: 28 },
  sectionHead:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  badge:        { backgroundColor: Colors.rust, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText:    { color: '#fff', fontSize: 12, fontWeight: '700' },
  countChip:    { backgroundColor: 'rgba(26,18,8,0.07)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  countChipText:{ color: Colors.muted, fontSize: 12, fontWeight: '500' },

  // Requests
  requestRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 14, marginBottom: 8 },
  requestInfo:  { flex: 1 },
  requestName:  { fontSize: 15, fontWeight: '600', color: Colors.ink },
  requestSub:   { fontSize: 12, color: Colors.muted, marginTop: 2 },
  requestBtns:  { flexDirection: 'row', gap: 8 },

  // Search
  searchRow:        { flexDirection: 'row', gap: 8, marginBottom: 4 },
  searchInput:      { flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: Colors.ink },
  searchResults:    { marginTop: 8, gap: 4 },
  searchResultRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12 },
  searchResultName: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.ink },
  emptySearch:      { color: Colors.muted, fontSize: 14, textAlign: 'center', paddingVertical: 16 },
  friendChip:       { fontSize: 13, color: Colors.sage, fontWeight: '600' },

  // Friends grid (2 columns)
  friendsGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  friendCard:     { width: '48%', backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  friendCardTop:  { alignItems: 'center', padding: 16, gap: 8 },
  friendName:     { fontSize: 14, fontWeight: '700', color: Colors.ink, textAlign: 'center' },
  friendStats:    { fontSize: 11, color: Colors.muted, textAlign: 'center' },
  friendCardActions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.border },

  // Empty state
  emptyBox:   { backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 32, alignItems: 'center' },
  emptyIcon:  { fontSize: 32, marginBottom: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink, marginBottom: 6, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  emptySub:   { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 18 },

  // Invite
  inviteCard:     { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 12 },
  inviteText:     { fontSize: 13, color: Colors.muted, lineHeight: 19 },
  inviteLinkRow:  { backgroundColor: Colors.background, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 9 },
  inviteLinkText: { fontSize: 12, color: Colors.rust, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  inviteBtnRow:   { flexDirection: 'row' as const, gap: 10 },
  btnShare:       { flex: 1, backgroundColor: Colors.rust, borderRadius: 9, paddingVertical: 11, alignItems: 'center' as const },
  btnShareText:   { color: '#fff', fontSize: 14, fontWeight: '600' as const },
  btnCopy:        { flex: 1, borderRadius: 9, paddingVertical: 11, alignItems: 'center' as const, borderWidth: 1, borderColor: Colors.border },
  btnCopyText:    { color: Colors.ink, fontSize: 14, fontWeight: '500' as const },

  // Contacts
  contactsBtn:     { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingVertical: 14, alignItems: 'center' as const },
  contactsBtnText: { fontSize: 14, color: Colors.rust, fontWeight: '600' as const },

  // Buttons
  btnAccept:      { backgroundColor: Colors.rust, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  btnAcceptText:  { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnDecline:     { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: Colors.border },
  btnDeclineText: { color: Colors.muted, fontSize: 13 },
  btnSearch:      { backgroundColor: Colors.ink, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  btnSearchText:  { color: '#fdf8f0', fontSize: 14, fontWeight: '600' },
  btnAdd:         { backgroundColor: Colors.rust, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  btnAddText:     { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnPending:     { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.sage },
  btnPendingText: { color: Colors.sage, fontSize: 13, fontWeight: '600' },
  btnVisit:       { flex: 1, alignItems: 'center', paddingVertical: 10, borderRightWidth: 1, borderRightColor: Colors.border },
  btnVisitText:   { fontSize: 12, fontWeight: '600', color: Colors.rust },
  btnUnfriend:    { flex: 1, alignItems: 'center', paddingVertical: 10 },
  btnUnfriendText:{ fontSize: 12, color: Colors.muted },
});
