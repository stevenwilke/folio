import React, { useCallback, useState } from 'react';
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
  TextInput,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';

// ---- Condition metadata ----

const CONDITION_META: Record<string, { label: string; color: string; bg: string }> = {
  like_new:   { label: 'Like New',   color: Colors.sage,  bg: 'rgba(90,122,90,0.12)' },
  very_good:  { label: 'Very Good',  color: '#2e7d4f',    bg: 'rgba(46,125,79,0.10)' },
  good:       { label: 'Good',       color: Colors.gold,  bg: 'rgba(184,134,11,0.12)' },
  acceptable: { label: 'Acceptable', color: Colors.rust,  bg: 'rgba(192,82,30,0.10)' },
  poor:       { label: 'Poor',       color: Colors.muted, bg: 'rgba(138,127,114,0.12)' },
};

const CONDITION_OPTIONS = ['like_new', 'very_good', 'good', 'acceptable', 'poor'] as const;
type ConditionKey = typeof CONDITION_OPTIONS[number];

// ---- Types ----

interface Listing {
  id: string;
  price: number;
  condition: string;
  description: string | null;
  status: string;
  created_at: string;
  books: {
    id: string;
    title: string;
    author: string | null;
    cover_image_url: string | null;
  };
  profiles?: {
    id: string;
    username: string;
  } | null;
}

interface OwnedBook {
  book_id: string;
  books: {
    id: string;
    title: string;
    author: string | null;
  };
}

// ---- Condition badge ----

function CondBadge({ condition }: { condition: string }) {
  const meta = CONDITION_META[condition] ?? CONDITION_META.good;
  return (
    <View style={[cb.pill, { backgroundColor: meta.bg }]}>
      <Text style={[cb.text, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}
const cb = StyleSheet.create({
  pill: { borderRadius: 20, paddingHorizontal: 9, paddingVertical: 2, alignSelf: 'flex-start' },
  text: { fontSize: 11, fontWeight: '500', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
});

// ---- Status badge ----

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:  { label: 'Active',  color: Colors.sage, bg: 'rgba(90,122,90,0.15)' },
  sold:    { label: 'Sold',    color: Colors.muted, bg: 'rgba(138,127,114,0.15)' },
  removed: { label: 'Removed', color: Colors.rust,  bg: 'rgba(192,82,30,0.10)' },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.active;
  return (
    <View style={[cb.pill, { backgroundColor: meta.bg }]}>
      <Text style={[cb.text, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

// ---- Fake cover ----

function MiniCover({ title }: { title: string }) {
  const palette = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e'];
  const c  = palette[title.charCodeAt(0) % palette.length];
  const c2 = palette[(title.charCodeAt(0) + 3) % palette.length];
  return (
    <View style={{ flex: 1, borderRadius: 4, overflow: 'hidden' }}>
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: c }} />
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: c2, opacity: 0.5 }} />
    </View>
  );
}

// ---- Browse listing card ----

function ListingCard({ listing }: { listing: Listing }) {
  const router = useRouter();
  const book = listing.books;
  const seller = listing.profiles;

  return (
    <View style={lcard.card}>
      {/* Cover */}
      <View style={lcard.coverBox}>
        {book.cover_image_url ? (
          <Image source={{ uri: book.cover_image_url }} style={lcard.coverImg} resizeMode="cover" />
        ) : (
          <MiniCover title={book.title} />
        )}
      </View>

      <View style={lcard.info}>
        <Text style={lcard.title} numberOfLines={2}>{book.title}</Text>
        {book.author ? <Text style={lcard.author}>{book.author}</Text> : null}

        <View style={lcard.condRow}>
          <CondBadge condition={listing.condition} />
        </View>

        {listing.description ? (
          <Text style={lcard.desc} numberOfLines={2}>{listing.description}</Text>
        ) : null}

        <View style={lcard.footer}>
          <Text style={lcard.price}>${Number(listing.price).toFixed(2)}</Text>
          {seller ? (
            <Text style={lcard.seller}>by <Text style={lcard.sellerName}>{seller.username}</Text></Text>
          ) : null}
        </View>

        <TouchableOpacity
          style={lcard.contactBtn}
          onPress={() => Alert.alert('Message Seller', `Message @${seller?.username ?? 'seller'} about this book.\n\nMessaging coming soon!`)}
        >
          <Text style={lcard.contactBtnText}>Message Seller</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const lcard = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
    overflow: 'hidden',
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  coverBox: { width: 60, height: 86, borderRadius: 6, overflow: 'hidden', backgroundColor: '#e8dfc8', flexShrink: 0 },
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
  condRow: { flexDirection: 'row', marginTop: 2 },
  desc: {
    fontSize: 12,
    color: '#5a4a3a',
    lineHeight: 16,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4 },
  price: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.gold,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  seller: {
    fontSize: 11,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  sellerName: { color: Colors.rust, fontWeight: '600' },
  contactBtn: {
    marginTop: 8,
    backgroundColor: Colors.rust,
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  contactBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});

// ---- My listing card ----

function MyListingCard({
  listing,
  onMarkSold,
  onRemove,
}: {
  listing: Listing;
  onMarkSold: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [acting, setActing] = useState(false);
  const book = listing.books;

  async function act(fn: (id: string) => Promise<void>) {
    setActing(true);
    await fn(listing.id);
    setActing(false);
  }

  return (
    <View style={mlc.card}>
      <View style={mlc.coverBox}>
        {book.cover_image_url ? (
          <Image source={{ uri: book.cover_image_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <MiniCover title={book.title} />
        )}
      </View>

      <View style={mlc.info}>
        <Text style={mlc.title} numberOfLines={2}>{book.title}</Text>
        {book.author ? <Text style={mlc.author}>{book.author}</Text> : null}
        <View style={mlc.badgeRow}>
          <CondBadge condition={listing.condition} />
          <StatusBadge status={listing.status} />
        </View>
        <Text style={mlc.listed}>
          Listed {new Date(listing.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </Text>
      </View>

      <View style={mlc.right}>
        <Text style={mlc.price}>${Number(listing.price).toFixed(2)}</Text>
        {listing.status === 'active' && (
          <View style={mlc.btnCol}>
            <TouchableOpacity
              style={mlc.btnSold}
              onPress={() => act(onMarkSold)}
              disabled={acting}
            >
              {acting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={mlc.btnSoldText}>Mark Sold</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={mlc.btnRemove}
              onPress={() => act(onRemove)}
              disabled={acting}
            >
              <Text style={mlc.btnRemoveText}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const mlc = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 10,
    gap: 12,
    alignItems: 'flex-start',
  },
  coverBox: { width: 52, height: 78, borderRadius: 4, overflow: 'hidden', backgroundColor: '#e8dfc8', flexShrink: 0 },
  info: { flex: 1, gap: 4 },
  title: { fontSize: 14, fontWeight: '600', color: Colors.ink, lineHeight: 18, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  author: { fontSize: 12, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  listed: { fontSize: 11, color: Colors.muted, marginTop: 2, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  right: { flexShrink: 0, alignItems: 'flex-end', gap: 6 },
  price: { fontSize: 18, fontWeight: '700', color: Colors.gold, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  btnCol: { gap: 6 },
  btnSold: { backgroundColor: Colors.sage, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, minWidth: 80, alignItems: 'center' },
  btnSoldText: { color: '#fff', fontSize: 12, fontWeight: '600', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  btnRemove: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center' },
  btnRemoveText: { color: Colors.muted, fontSize: 12, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
});

// ---- Sell a book form ----

function SellTab({ userId }: { userId: string }) {
  const [ownedBooks, setOwnedBooks] = useState<OwnedBook[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [condition, setCondition] = useState<ConditionKey>('good');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showBookPicker, setShowBookPicker] = useState(false);

  React.useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('collection_entries')
        .select('book_id, books ( id, title, author )')
        .eq('user_id', userId)
        .order('added_at', { ascending: false });
      setOwnedBooks((data as unknown as OwnedBook[]) || []);
      setLoadingBooks(false);
    }
    load();
  }, [userId]);

  const selectedBook = ownedBooks.find((b) => b.book_id === selectedBookId);

  async function handleSubmit() {
    if (!selectedBookId) {
      Alert.alert('Select a book', 'Please choose a book from your collection.');
      return;
    }
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      Alert.alert('Invalid price', 'Please enter a valid price greater than 0.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('listings').insert({
        seller_id: userId,
        book_id: selectedBookId,
        price: priceNum,
        condition,
        description: description.trim() || null,
        status: 'active',
      });
      if (error) throw error;
      Alert.alert('Listed!', 'Your book is now listed on the Marketplace.');
      setSelectedBookId(null);
      setPrice('');
      setCondition('good');
      setDescription('');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not create listing.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingBooks) {
    return (
      <View style={sell.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={sell.content}>
        <Text style={sell.heading}>List a Book for Sale</Text>
        <Text style={sell.subheading}>Choose from your collection and set a price.</Text>

        {/* Book picker */}
        <Text style={sell.label}>Book *</Text>
        <TouchableOpacity
          style={sell.picker}
          onPress={() => setShowBookPicker(!showBookPicker)}
        >
          <Text style={selectedBook ? sell.pickerText : sell.pickerPlaceholder}>
            {selectedBook ? selectedBook.books.title : 'Select a book…'}
          </Text>
          <Text style={sell.pickerArrow}>{showBookPicker ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {showBookPicker && (
          <View style={sell.dropdownBox}>
            {ownedBooks.length === 0 ? (
              <Text style={sell.dropdownEmpty}>No books in your collection yet.</Text>
            ) : (
              ownedBooks.map((b) => (
                <TouchableOpacity
                  key={b.book_id}
                  style={[sell.dropdownItem, b.book_id === selectedBookId && sell.dropdownItemActive]}
                  onPress={() => {
                    setSelectedBookId(b.book_id);
                    setShowBookPicker(false);
                  }}
                >
                  <Text style={[sell.dropdownItemText, b.book_id === selectedBookId && sell.dropdownItemTextActive]}
                    numberOfLines={1}
                  >
                    {b.books.title}
                    {b.books.author ? ` — ${b.books.author}` : ''}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* Price */}
        <Text style={sell.label}>Price ($) *</Text>
        <TextInput
          style={sell.input}
          value={price}
          onChangeText={setPrice}
          placeholder="e.g. 8.99"
          placeholderTextColor={Colors.muted}
          keyboardType="decimal-pad"
        />

        {/* Condition */}
        <Text style={sell.label}>Condition *</Text>
        <View style={sell.condRow}>
          {CONDITION_OPTIONS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[sell.condChip, condition === c && sell.condChipActive]}
              onPress={() => setCondition(c)}
            >
              <Text style={[sell.condChipText, condition === c && sell.condChipTextActive]}>
                {CONDITION_META[c].label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Description */}
        <Text style={sell.label}>Description (optional)</Text>
        <TextInput
          style={[sell.input, sell.textarea]}
          value={description}
          onChangeText={setDescription}
          placeholder="Notes on condition, edition, etc."
          placeholderTextColor={Colors.muted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {/* Submit */}
        <TouchableOpacity
          style={[sell.submitBtn, submitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={sell.submitBtnText}>List for Sale</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const sell = StyleSheet.create({
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, paddingBottom: 48 },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 4,
  },
  subheading: {
    fontSize: 13,
    color: Colors.muted,
    marginBottom: 20,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 16,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerText: { flex: 1, fontSize: 14, color: Colors.ink, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  pickerPlaceholder: { flex: 1, fontSize: 14, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  pickerArrow: { fontSize: 11, color: Colors.muted },
  dropdownBox: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    marginTop: 2,
    maxHeight: 200,
    overflow: 'hidden',
  },
  dropdownEmpty: { padding: 14, color: Colors.muted, fontSize: 13, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: Colors.border },
  dropdownItemActive: { backgroundColor: 'rgba(192,82,30,0.08)' },
  dropdownItemText: { fontSize: 13, color: Colors.ink, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  dropdownItemTextActive: { color: Colors.rust, fontWeight: '600' },
  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  condRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  condChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  condChipActive: { backgroundColor: Colors.rust, borderColor: Colors.rust },
  condChipText: { fontSize: 12, fontWeight: '600', color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  condChipTextActive: { color: '#fff' },
  submitBtn: {
    marginTop: 28,
    backgroundColor: Colors.rust,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
});

// ---- Main screen ----

type TabKey = 'browse' | 'my-listings' | 'sell';

export default function MarketplaceScreen() {
  const [tab, setTab] = useState<TabKey>('browse');
  const [listings, setListings] = useState<Listing[]>([]);
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [condFilter, setCondFilter] = useState('all');
  const [userId, setUserId] = useState<string | null>(null);

  async function fetchListings() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const [{ data: all }, { data: mine }] = await Promise.all([
      supabase
        .from('listings')
        .select(`
          id, price, condition, description, status, created_at,
          books ( id, title, author, cover_image_url ),
          profiles!listings_seller_id_fkey ( id, username )
        `)
        .eq('status', 'active')
        .neq('seller_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('listings')
        .select(`
          id, price, condition, description, status, created_at,
          books ( id, title, author, cover_image_url )
        `)
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false }),
    ]);

    setListings((all as unknown as Listing[]) || []);
    setMyListings((mine as unknown as Listing[]) || []);
  }

  async function markSold(id: string) {
    await supabase.from('listings').update({ status: 'sold' }).eq('id', id);
    await fetchListings();
  }

  async function removeListing(id: string) {
    await supabase.from('listings').update({ status: 'removed' }).eq('id', id);
    await fetchListings();
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchListings().finally(() => setLoading(false));
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchListings();
    setRefreshing(false);
  }

  const filtered = listings.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      l.books?.title?.toLowerCase().includes(q) ||
      l.books?.author?.toLowerCase().includes(q) ||
      (l.profiles?.username ?? '').toLowerCase().includes(q);
    const matchCond = condFilter === 'all' || l.condition === condFilter;
    return matchSearch && matchCond;
  });

  const activeMyCount = myListings.filter((l) => l.status === 'active').length;

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'browse',      label: 'Browse' },
    { key: 'my-listings', label: `My Listings${activeMyCount ? ` (${activeMyCount})` : ''}` },
    { key: 'sell',        label: 'Sell a Book' },
  ];

  function renderBrowse() {
    return (
      <View style={{ flex: 1 }}>
        {/* Search */}
        <View style={styles.searchBox}>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search title, author, or seller…"
            placeholderTextColor={Colors.muted}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        {/* Condition filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {[['all', 'All'], ...Object.entries(CONDITION_META).map(([k, v]) => [k, v.label])].map(
            ([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.filterChip, condFilter === key && styles.filterChipActive]}
                onPress={() => setCondFilter(key)}
              >
                <Text style={[styles.filterChipText, condFilter === key && styles.filterChipTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            )
          )}
        </ScrollView>

        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={Colors.rust} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ListingCard listing={item} />}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>🏪</Text>
                <Text style={styles.emptyTitle}>
                  {search ? 'No listings match your search' : 'No listings yet'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {search
                    ? 'Try a different search term.'
                    : 'Be the first to list a book — use the "Sell a Book" tab.'}
                </Text>
              </View>
            }
          />
        )}
      </View>
    );
  }

  function renderMyListings() {
    const active  = myListings.filter((l) => l.status === 'active');
    const history = myListings.filter((l) => l.status !== 'active');

    if (loading) {
      return (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.rust} />
        </View>
      );
    }

    if (!myListings.length) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTitle}>Nothing listed yet</Text>
          <Text style={styles.emptySubtitle}>
            Use the "Sell a Book" tab to list a book from your collection.
          </Text>
        </View>
      );
    }

    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />
        }
      >
        {active.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Active Listings</Text>
              <View style={styles.sectionCount}>
                <Text style={styles.sectionCountText}>{active.length}</Text>
              </View>
            </View>
            {active.map((l) => (
              <MyListingCard key={l.id} listing={l} onMarkSold={markSold} onRemove={removeListing} />
            ))}
          </View>
        )}
        {history.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: Colors.muted }]}>History</Text>
              <View style={styles.sectionCount}>
                <Text style={styles.sectionCountText}>{history.length}</Text>
              </View>
            </View>
            {history.map((l) => (
              <MyListingCard key={l.id} listing={l} onMarkSold={markSold} onRemove={removeListing} />
            ))}
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      {/* Pill tab switcher */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabBarContent}
        style={styles.tabBar}
      >
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabPill, tab === t.key && styles.tabPillActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabPillText, tab === t.key && styles.tabPillTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {tab === 'browse' && renderBrowse()}
      {tab === 'my-listings' && renderMyListings()}
      {tab === 'sell' && userId && <SellTab userId={userId} />}
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
    paddingTop: 60,
  },
  tabBar: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
    flexGrow: 0,
  },
  tabBarContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tabPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabPillActive: {
    backgroundColor: Colors.rust,
    borderColor: Colors.rust,
  },
  tabPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  tabPillTextActive: { color: '#fff' },
  searchBox: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  searchInput: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.rust, borderColor: Colors.rust },
  filterChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  filterChipTextActive: { color: '#fff' },
  listContent: { padding: 16, paddingTop: 8, paddingBottom: 40 },
  section: { marginBottom: 24 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  sectionCount: {
    backgroundColor: 'rgba(192,82,30,0.10)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  sectionCountText: {
    fontSize: 12,
    color: Colors.rust,
    fontWeight: '500',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
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
