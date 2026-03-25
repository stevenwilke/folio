import React, { useCallback, useState } from 'react';
import { sendPushNotification } from '../../lib/notifications';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  RefreshControl,
  Image,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';

// ---- Types ----

interface BorrowRequest {
  id: string;
  status: 'pending' | 'active' | 'returned' | 'declined';
  message: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  books: {
    id: string;
    title: string;
    author: string | null;
    cover_image_url: string | null;
  };
  profiles: {
    id: string;
    username: string;
  } | null;
}

type LoanMode = 'lend-pending' | 'lend-active' | 'borrow-pending' | 'borrow-active' | 'history';

// ---- Status badge ----

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  pending:  { label: 'Pending',  bg: 'rgba(184,134,11,0.14)',  color: Colors.gold },
  active:   { label: 'Active',   bg: 'rgba(90,122,90,0.15)',   color: Colors.sage },
  returned: { label: 'Returned', bg: 'rgba(138,127,114,0.15)', color: Colors.muted },
  declined: { label: 'Declined', bg: 'rgba(192,82,30,0.12)',   color: Colors.rust },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <View style={[badge.pill, { backgroundColor: meta.bg }]}>
      <Text style={[badge.text, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}
const badge = StyleSheet.create({
  pill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  text: { fontSize: 11, fontWeight: '600', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
});

// ---- Mini book cover placeholder ----

function MiniCover({ title }: { title: string }) {
  const palette = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e'];
  const c  = palette[title.charCodeAt(0) % palette.length];
  const c2 = palette[(title.charCodeAt(0) + 3) % palette.length];
  return (
    <View style={[miniCoverStyle.box, { backgroundColor: c }]}>
      <View style={[miniCoverStyle.gradient, { backgroundColor: c2 }]} />
    </View>
  );
}
const miniCoverStyle = StyleSheet.create({
  box:      { width: '100%', height: '100%', borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' },
  gradient: { ...StyleSheet.absoluteFillObject, opacity: 0.5 },
});

// ---- Loan card row ----

function LoanCard({
  req,
  mode,
  onAction,
}: {
  req: BorrowRequest;
  mode: LoanMode;
  onAction: (id: string, action: string) => Promise<void>;
}) {
  const router = useRouter();
  const [acting, setActing] = useState(false);
  const book = req.books;
  const otherProfile = req.profiles;

  async function act(action: string) {
    setActing(true);
    await onAction(req.id, action);
    setActing(false);
  }

  const dueDate = req.due_date
    ? new Date(req.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const isOverdue = req.due_date && req.status === 'active' && new Date(req.due_date) < new Date();
  const isHistory = mode === 'history';

  return (
    <TouchableOpacity
      style={[lc.card, isHistory && lc.cardMuted]}
      activeOpacity={0.75}
      onPress={() => book.id && router.push(`/book/${book.id}`)}
    >
      {/* Cover */}
      <View style={lc.coverBox}>
        {book.cover_image_url ? (
          <Image source={{ uri: book.cover_image_url }} style={lc.coverImg} resizeMode="cover" />
        ) : (
          <MiniCover title={book.title} />
        )}
      </View>

      {/* Info */}
      <View style={lc.info}>
        <Text style={lc.title} numberOfLines={2}>{book.title}</Text>
        {book.author ? <Text style={lc.author}>{book.author}</Text> : null}

        {(mode === 'lend-pending' || mode === 'lend-active') && otherProfile ? (
          <Text style={lc.meta}>
            Requested by <Text style={lc.username}>{otherProfile.username}</Text>
          </Text>
        ) : null}
        {(mode === 'borrow-pending' || mode === 'borrow-active') && otherProfile ? (
          <Text style={lc.meta}>
            Owned by <Text style={lc.username}>{otherProfile.username}</Text>
          </Text>
        ) : null}
        {mode === 'history' && otherProfile ? (
          <Text style={lc.meta}>
            With <Text style={lc.username}>{otherProfile.username}</Text>
          </Text>
        ) : null}

        {req.message ? (
          <Text style={lc.message} numberOfLines={2}>"{req.message}"</Text>
        ) : null}

        {dueDate ? (
          <Text style={[lc.dueDate, isOverdue && lc.overdue]}>
            Due {dueDate}{isOverdue ? ' — Overdue' : ''}
          </Text>
        ) : null}
      </View>

      {/* Actions */}
      <View style={lc.actions}>
        <StatusBadge status={req.status} />

        {mode === 'lend-pending' && (
          <View style={lc.btnRow}>
            <TouchableOpacity
              style={[lc.btn, lc.btnAccept]}
              onPress={() => act('accept')}
              disabled={acting}
            >
              {acting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={lc.btnAcceptText}>Accept</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[lc.btn, lc.btnDecline]}
              onPress={() => act('decline')}
              disabled={acting}
            >
              <Text style={lc.btnDeclineText}>Decline</Text>
            </TouchableOpacity>
          </View>
        )}

        {mode === 'lend-active' && (
          <TouchableOpacity
            style={[lc.btn, lc.btnGhost, { marginTop: 8 }]}
            onPress={() => act('returned')}
            disabled={acting}
          >
            {acting ? (
              <ActivityIndicator size="small" color={Colors.ink} />
            ) : (
              <Text style={lc.btnGhostText}>Mark Returned</Text>
            )}
          </TouchableOpacity>
        )}

        {mode === 'borrow-pending' && (
          <TouchableOpacity
            style={[lc.btn, lc.btnGhost, { marginTop: 8 }]}
            onPress={() => act('cancel')}
            disabled={acting}
          >
            {acting ? (
              <ActivityIndicator size="small" color={Colors.muted} />
            ) : (
              <Text style={[lc.btnGhostText, { color: Colors.muted }]}>Cancel</Text>
            )}
          </TouchableOpacity>
        )}

        {mode === 'borrow-active' && (
          <TouchableOpacity
            style={[lc.btn, lc.btnGhost, { marginTop: 8 }]}
            onPress={() => act('returned')}
            disabled={acting}
          >
            {acting ? (
              <ActivityIndicator size="small" color={Colors.ink} />
            ) : (
              <Text style={lc.btnGhostText}>Mark Returned</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const lc = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    alignItems: 'flex-start',
  },
  cardMuted: { opacity: 0.72 },
  coverBox: { width: 52, height: 78, borderRadius: 4, overflow: 'hidden', backgroundColor: '#e8dfc8', flexShrink: 0 },
  coverImg: { width: '100%', height: '100%' },
  info: { flex: 1, gap: 4 },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    lineHeight: 19,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  author: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  meta: {
    fontSize: 12,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
    marginTop: 2,
  },
  username: { fontWeight: '700', color: Colors.rust },
  message: {
    fontSize: 12,
    color: '#5a4a3a',
    fontStyle: 'italic',
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  dueDate: {
    fontSize: 11,
    color: Colors.muted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  overdue: { color: Colors.rust, fontWeight: '600' },
  actions: { flexShrink: 0, alignItems: 'flex-end', gap: 0 },
  btnRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  btn: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center', justifyContent: 'center', minWidth: 58 },
  btnAccept: { backgroundColor: Colors.rust },
  btnAcceptText: { color: '#fff', fontSize: 12, fontWeight: '600', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  btnDecline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.border },
  btnDeclineText: { color: Colors.muted, fontSize: 12, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  btnGhost: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  btnGhostText: { color: Colors.ink, fontSize: 12, fontWeight: '500', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
});

// ---- Section header ----

function SectionHeader({ title, count, muted }: { title: string; count: number; muted?: boolean }) {
  return (
    <View style={sh.row}>
      <Text style={[sh.title, muted && sh.titleMuted]}>{title}</Text>
      <View style={sh.countPill}>
        <Text style={sh.countText}>{count}</Text>
      </View>
    </View>
  );
}
const sh = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  titleMuted: { color: Colors.muted },
  countPill: { backgroundColor: 'rgba(192,82,30,0.10)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },
  countText: { fontSize: 12, color: Colors.rust, fontWeight: '500', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
});

// ---- Main screen ----

export default function LoansScreen() {
  const [lending, setLending] = useState<BorrowRequest[]>([]);
  const [borrowing, setBorrowing] = useState<BorrowRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'lending' | 'borrowing'>('lending');

  async function fetchLoans() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: lendData }, { data: borrowData }] = await Promise.all([
      supabase
        .from('borrow_requests')
        .select(`
          id, status, message, due_date, created_at, updated_at,
          books ( id, title, author, cover_image_url ),
          profiles!borrow_requests_owner_id_fkey ( id, username )
        `)
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('borrow_requests')
        .select(`
          id, status, message, due_date, created_at, updated_at,
          books ( id, title, author, cover_image_url ),
          profiles!borrow_requests_requester_id_fkey ( id, username )
        `)
        .eq('requester_id', user.id)
        .order('created_at', { ascending: false }),
    ]);

    setLending((lendData as unknown as BorrowRequest[]) || []);
    setBorrowing((borrowData as unknown as BorrowRequest[]) || []);
  }

  async function handleAction(id: string, action: string) {
    // Find the request so we can notify the right person
    const req = [...lending, ...borrowing].find(r => r.id === id);
    const bookTitle = (req as any)?.books?.title ?? 'a book';

    if (action === 'accept') {
      await supabase
        .from('borrow_requests')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', id);
      // Notify the borrower that their request was accepted
      const borrowerId = (req as any)?.profiles?.id;
      if (borrowerId) {
        sendPushNotification(
          borrowerId,
          'Loan Request Accepted! 📚',
          `Your request to borrow "${bookTitle}" was accepted`,
          { type: 'loan_accepted' }
        );
      }
    } else if (action === 'decline') {
      await supabase.from('borrow_requests').delete().eq('id', id);
      // Notify the borrower that their request was declined
      const borrowerId = (req as any)?.profiles?.id;
      if (borrowerId) {
        sendPushNotification(
          borrowerId,
          'Loan Request Declined',
          `Your request to borrow "${bookTitle}" was not accepted`,
          { type: 'loan_declined' }
        );
      }
    } else if (action === 'cancel') {
      await supabase.from('borrow_requests').delete().eq('id', id);
    } else if (action === 'returned') {
      await supabase
        .from('borrow_requests')
        .update({ status: 'returned', updated_at: new Date().toISOString() })
        .eq('id', id);
    }
    await fetchLoans();
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchLoans().finally(() => setLoading(false));
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchLoans();
    setRefreshing(false);
  }

  const lendPending = lending.filter((r) => r.status === 'pending');
  const lendActive  = lending.filter((r) => r.status === 'active');
  const lendHistory = lending.filter((r) => r.status === 'returned' || r.status === 'declined');
  const borPending  = borrowing.filter((r) => r.status === 'pending');
  const borActive   = borrowing.filter((r) => r.status === 'active');
  const borHistory  = borrowing.filter((r) => r.status === 'returned');

  const pendingBadge = tab === 'lending' ? lendPending.length : borPending.length;

  function renderLendingContent() {
    if (!lendPending.length && !lendActive.length && !lendHistory.length) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📚</Text>
          <Text style={styles.emptyTitle}>No lending activity yet</Text>
          <Text style={styles.emptySubtitle}>
            When friends request to borrow your books, they'll appear here.
          </Text>
        </View>
      );
    }
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />
        }
      >
        {lendPending.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Pending Requests" count={lendPending.length} />
            {lendPending.map((r) => (
              <LoanCard key={r.id} req={r} mode="lend-pending" onAction={handleAction} />
            ))}
          </View>
        )}
        {lendActive.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Currently Lent Out" count={lendActive.length} />
            {lendActive.map((r) => (
              <LoanCard key={r.id} req={r} mode="lend-active" onAction={handleAction} />
            ))}
          </View>
        )}
        {lendHistory.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="History" count={lendHistory.length} muted />
            {lendHistory.map((r) => (
              <LoanCard key={r.id} req={r} mode="history" onAction={handleAction} />
            ))}
          </View>
        )}
      </ScrollView>
    );
  }

  function renderBorrowingContent() {
    if (!borPending.length && !borActive.length && !borHistory.length) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📖</Text>
          <Text style={styles.emptyTitle}>No borrowing activity yet</Text>
          <Text style={styles.emptySubtitle}>
            Visit a friend's library and tap a book to request it.
          </Text>
        </View>
      );
    }
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />
        }
      >
        {borPending.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Awaiting Response" count={borPending.length} />
            {borPending.map((r) => (
              <LoanCard key={r.id} req={r} mode="borrow-pending" onAction={handleAction} />
            ))}
          </View>
        )}
        {borActive.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Currently Borrowing" count={borActive.length} />
            {borActive.map((r) => (
              <LoanCard key={r.id} req={r} mode="borrow-active" onAction={handleAction} />
            ))}
          </View>
        )}
        {borHistory.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="History" count={borHistory.length} muted />
            {borHistory.map((r) => (
              <LoanCard key={r.id} req={r} mode="history" onAction={handleAction} />
            ))}
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      {/* Pill tab switcher */}
      <View style={styles.tabBar}>
        {(['lending', 'borrowing'] as const).map((t) => {
          const isActive = tab === t;
          const count = t === 'lending' ? lendPending.length : borPending.length;
          return (
            <TouchableOpacity
              key={t}
              style={[styles.tabPill, isActive && styles.tabPillActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabPillText, isActive && styles.tabPillTextActive]}>
                {t === 'lending' ? 'Lending Out' : 'Borrowing'}
              </Text>
              {count > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.rust} />
        </View>
      ) : tab === 'lending' ? (
        renderLendingContent()
      ) : (
        renderBorrowingContent()
      )}
    </View>
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
  },
  tabBar: {
    flexDirection: 'row',
    margin: 16,
    marginBottom: 8,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 4,
    gap: 4,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 9,
    gap: 6,
  },
  tabPillActive: {
    backgroundColor: Colors.rust,
  },
  tabPillText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  tabPillTextActive: {
    color: '#fff',
  },
  tabBadge: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  scrollContent: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
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
