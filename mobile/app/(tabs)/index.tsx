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
  RefreshControl,
  Modal,
  Image,
  Alert,
  Pressable,
  TextInput,
  DeviceEventEmitter,
} from 'react-native';
import { SHELF_PLANNER_EVENT } from './_layout';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';
import { fetchUsedPrices } from '../../lib/fetchUsedPrices';
import { Colors } from '../../constants/colors';
import { BookCard, ReadStatus } from '../../components/BookCard';
import ShelfPlannerModal, { ShelfBook } from '../../components/ShelfPlannerModal';
import SwipeTabNav from '../../components/SwipeTabNav';

type FilterKey = 'all' | ReadStatus | 'series';

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'owned', label: 'In Library' },
  { key: 'read', label: 'Read' },
  { key: 'reading', label: 'Reading' },
  { key: 'want', label: 'Want' },
  { key: 'series', label: 'Series' },
];

interface CollectionEntry {
  id: string;
  book_id: string;
  read_status: ReadStatus;
  has_read: boolean;
  user_rating: number | null;
  current_page: number | null;
  books: {
    id: string;
    title: string;
    author: string | null;
    cover_image_url: string | null;
    genre: string | null;
    published_year: number | null;
    series_name: string | null;
    series_number: number | null;
    pages: number | null;
    format: string | null;
  };
}

interface Stats {
  total: number;
  read: number;
  reading: number;
  want: number;
}

type SizeKey = 'S' | 'M' | 'L';
const SIZE_COLUMNS: Record<SizeKey, number> = { S: 4, M: 3, L: 2 };
const SIZE_STORAGE_KEY = 'exlibris-cover-size';

export default function LibraryScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [coverSize, setCoverSize] = useState<SizeKey>('M');
  const [showShelfPlanner, setShowShelfPlanner] = useState(false);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(SHELF_PLANNER_EVENT, () => setShowShelfPlanner(true));
    return () => sub.remove();
  }, []);
  const [pendingCoverIds, setPendingCoverIds] = useState<Set<string>>(new Set());
  const [coverUploadTarget, setCoverUploadTarget] = useState<{ id: string; title: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [valuationStats, setValuationStats] = useState<{ retailTotal: number; retailCount: number; usedTotal: number; usedCount: number } | null>(null);
  const [sort, setSort] = useState('added');
  const [groupBy, setGroupBy] = useState('none');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [pickerSheet, setPickerSheet] = useState<{
    title: string;
    options: { key: string; label: string }[];
    selected: string;
    onSelect: (key: string) => void;
  } | null>(null);
  const [searchBarY, setSearchBarY] = useState<number | null>(null);
  const [isSearchSticky, setIsSearchSticky] = useState(false);

  const handleScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      if (searchBarY === null) return;
      const shouldStick = e.nativeEvent.contentOffset.y > searchBarY;
      if (shouldStick !== isSearchSticky) setIsSearchSticky(shouldStick);
    },
    [searchBarY, isSearchSticky]
  );

  const COLUMNS = SIZE_COLUMNS[coverSize];
  const HORIZONTAL_PADDING = 16;
  const GAP = 10;
  const cardWidth = Math.floor((width - HORIZONTAL_PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  useEffect(() => {
    AsyncStorage.getItem(SIZE_STORAGE_KEY).then((val) => {
      if (val === 'S' || val === 'M' || val === 'L') setCoverSize(val);
    });
  }, []);

  async function handleSizeChange(size: SizeKey) {
    setCoverSize(size);
    await AsyncStorage.setItem(SIZE_STORAGE_KEY, size);
  }

  async function fetchLibrary() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('collection_entries')
      .select(`
        id,
        book_id,
        read_status,
        has_read,
        user_rating,
        current_page,
        books (
          id,
          title,
          author,
          cover_image_url,
          genre,
          published_year,
          series_name,
          series_number,
          pages,
          format
        )
      `)
      .eq('user_id', user.id)
      .order('added_at', { ascending: false });

    if (!error && data) {
      let entries = data as unknown as CollectionEntry[];

      // Auto-promote finished books: if reading and current_page >= total pages, mark as read
      const toPromote = entries.filter(e =>
        e.read_status === 'reading' && e.books?.pages && e.current_page != null && e.current_page >= e.books.pages
      );
      if (toPromote.length) {
        await Promise.all(toPromote.map(e =>
          supabase.from('collection_entries').update({ read_status: 'read' }).eq('id', e.id)
        ));
        // Update local state to reflect the promotion without a full refetch
        entries = entries.map(e =>
          toPromote.some(p => p.id === e.id)
            ? { ...e, read_status: 'read' as ReadStatus }
            : e
        );
      }

      setEntries(entries);

      // New user check: no books + not yet onboarded → show onboarding wizard
      if (data.length === 0) {
        const onboarded = await AsyncStorage.getItem('exlibris-onboarded');
        if (!onboarded) {
          router.replace('/onboarding');
        }
      }

      // Fetch any pending cover submissions for this user's books
      const bookIds = entries.map((e) => e.books.id);
      if (bookIds.length) {
        const { data: pending } = await supabase
          .from('pending_covers')
          .select('book_id')
          .eq('user_id', user.id)
          .eq('status', 'pending')
          .in('book_id', bookIds);
        setPendingCoverIds(new Set((pending ?? []).map((p: any) => p.book_id)));
      }

      // Fetch library valuation stats
      const { data: vals } = await supabase
        .from('valuations')
        .select('book_id, list_price, avg_price')
        .in('book_id', bookIds);
      if (vals?.length) {
        let retailTotal = 0, retailCount = 0, usedTotal = 0, usedCount = 0;
        for (const v of vals) {
          if (v.list_price) { retailTotal += v.list_price; retailCount++; }
          if (v.avg_price) { usedTotal += v.avg_price; usedCount++; }
        }
        setValuationStats({ retailTotal, retailCount, usedTotal, usedCount });
      }
    }
  }

  // Background backfill of book valuations (once per session)
  const backfillRan = React.useRef(false);
  async function backfillValuations(libraryEntries: CollectionEntry[]) {
    const bookIds = libraryEntries.map(e => e.books?.id).filter(Boolean);
    if (!bookIds.length) return;

    const { data: existing } = await supabase
      .from('valuations')
      .select('book_id, fetched_at')
      .in('book_id', bookIds);

    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    const skipIds = new Set(
      (existing || [])
        .filter((v: any) => new Date(v.fetched_at).getTime() > sixHoursAgo)
        .map((v: any) => v.book_id)
    );

    const todo = libraryEntries.filter(e => e.books?.id && !skipIds.has(e.books.id));
    if (!todo.length) return;

    const BATCH = 3;
    for (let i = 0; i < todo.length; i += BATCH) {
      await Promise.allSettled(todo.slice(i, i + BATCH).map(async entry => {
        const b = entry.books;
        const isbn = b.isbn_13 || b.isbn_10 || null;
        try {
          const [retailResult, usedResult] = await Promise.allSettled([
            supabase.functions.invoke('get-book-valuation', { body: { isbn, title: b.title, author: b.author } }),
            fetchUsedPrices(isbn, b.title, b.author),
          ]);
          const data = retailResult.status === 'fulfilled' ? (retailResult as any).value.data : null;
          const used = usedResult.status === 'fulfilled' ? (usedResult as any).value : null;
          const row = {
            book_id: b.id,
            list_price: data?.list_price ?? used?.new_price ?? null,
            list_price_currency: data?.list_price_currency ?? (used?.new_price ? 'USD' : null),
            avg_price: used?.avg_price ?? null,
            min_price: used?.min_price ?? null,
            max_price: used?.max_price ?? null,
            sample_count: used?.sample_count ?? null,
            paperback_avg: used?.paperback_avg ?? null,
            hardcover_avg: used?.hardcover_avg ?? null,
            currency: data?.currency || 'USD',
            fetched_at: new Date().toISOString(),
          };
          await supabase.from('valuations').upsert(row, { onConflict: 'book_id' });
        } catch { /* ignore */ }
      }));
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  const initialLoadDone = React.useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!initialLoadDone.current) setLoading(true);
      fetchLibrary().then(() => {
        if (!backfillRan.current) {
          backfillRan.current = true;
          setTimeout(() => {
            supabase.auth.getUser().then(({ data: { user } }) => {
              if (!user) return;
              supabase.from('collection_entries')
                .select('book_id, books(id, title, author, isbn_13, isbn_10)')
                .eq('user_id', user.id)
                .then(({ data }) => {
                  if (data?.length) backfillValuations(data as any);
                });
            });
          }, 2000);
        }
      }).finally(() => { setLoading(false); initialLoadDone.current = true; });
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchLibrary();
    setRefreshing(false);
  }

  const filteredByStatus =
    filter === 'all' ? entries.filter((e) => e.read_status !== 'want')
    : filter === 'read' ? entries.filter((e) => e.has_read === true)
    : filter === 'series' ? entries.filter(e => e.books?.series_name)
    : entries.filter((e) => e.read_status === filter);

  // Apply search query
  const q = searchQuery.trim().toLowerCase();
  const searched = q
    ? filteredByStatus.filter(e =>
        e.books?.title?.toLowerCase().includes(q) ||
        e.books?.author?.toLowerCase().includes(q))
    : filteredByStatus;

  // Apply sort
  const sorted = (() => {
    const arr = [...searched];
    switch (sort) {
      case 'title':  return arr.sort((a, b) => (a.books?.title || '').localeCompare(b.books?.title || ''));
      case 'author': return arr.sort((a, b) => (a.books?.author || '').localeCompare(b.books?.author || ''));
      case 'rating': return arr.sort((a, b) => (b.user_rating || 0) - (a.user_rating || 0));
      case 'year':   return arr.sort((a, b) => (b.books?.published_year || 0) - (a.books?.published_year || 0));
      default:       return arr; // 'added' — already sorted by added_at desc
    }
  })();

  // Apply grouping
  const STATUS_LABELS_MAP: Record<string, string> = { owned: 'In Library', read: 'Read', reading: 'Reading', want: 'Want to Read' };
  const groups = (() => {
    if (groupBy === 'none') return [{ label: null as string | null, entries: sorted }];
    const map: Record<string, CollectionEntry[]> = {};
    for (const entry of sorted) {
      let key: string;
      if (groupBy === 'status') key = STATUS_LABELS_MAP[entry.read_status] || 'Other';
      else if (groupBy === 'genre') key = entry.books?.genre || 'Uncategorized';
      else if (groupBy === 'author') key = entry.books?.author || 'Unknown Author';
      else if (groupBy === 'series') key = entry.books?.series_name || 'No Series';
      else if (groupBy === 'decade') {
        const y = entry.books?.published_year;
        key = y ? `${Math.floor(y / 10) * 10}s` : 'Unknown';
      } else key = 'Other';
      if (!map[key]) map[key] = [];
      map[key].push(entry);
    }
    return Object.entries(map)
      .map(([label, entries]) => ({ label, entries }))
      .sort((a, b) => a.label.localeCompare(b.label));
  })();

  const filtered = sorted;

  // Series grouping when series filter is active
  const seriesGroups = filter === 'series' ? (() => {
    const groups: Record<string, CollectionEntry[]> = {};
    filtered.forEach(e => {
      const name = e.books?.series_name || 'Unknown';
      if (!groups[name]) groups[name] = [];
      groups[name].push(e);
    });
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, books]) => ({
        name,
        books: books.sort((a, b) => {
          const an = parseFloat(String(a.books?.series_number || '999'));
          const bn = parseFloat(String(b.books?.series_number || '999'));
          return an - bn;
        }),
        readCount: books.filter(b => b.read_status === 'read' || (b as any).has_read).length,
      }));
  })() : [];

  const stats: Stats = {
    total: entries.filter((e) => e.read_status !== 'want').length,
    read: entries.filter((e) => e.has_read === true).length,
    reading: entries.filter((e) => e.read_status === 'reading').length,
    want: entries.filter((e) => e.read_status === 'want').length,
  };

  // Pad filtered data so the last row has the right number of items (avoids stretching)
  const paddedFiltered = (() => {
    const remainder = filtered.length % COLUMNS;
    if (remainder === 0 || filtered.length === 0) return filtered;
    const placeholders = Array.from({ length: COLUMNS - remainder }, (_, i) => ({
      id: `__placeholder_${i}`,
      book_id: `__placeholder_${i}`,
      read_status: 'owned' as ReadStatus,
      has_read: false,
      user_rating: null,
      current_page: null,
      books: { id: '', title: '', author: null, cover_image_url: null, genre: null, published_year: null, series_name: null, series_number: null, pages: null, format: null },
      _placeholder: true,
    }));
    return [...filtered, ...placeholders] as (CollectionEntry & { _placeholder?: boolean })[];
  })();

  const renderItem = ({ item, index }: { item: CollectionEntry & { _placeholder?: boolean }; index: number }) => {
    const col = index % COLUMNS;
    const marginLeft  = col === 0 ? 0 : GAP / 2;
    const marginRight = col === COLUMNS - 1 ? 0 : GAP / 2;

    // Invisible placeholder to fill last row
    if ((item as any)._placeholder) {
      return <View style={[styles.gridItem, { marginLeft, marginRight, opacity: 0 }]}>
        <View style={{ width: cardWidth, height: 1 }} />
      </View>;
    }

    return (
      <View style={[styles.gridItem, { marginLeft, marginRight }]}>
        <BookCard
          id={item.book_id}
          title={item.books.title}
          author={item.books.author}
          coverImageUrl={item.books.cover_image_url}
          status={item.read_status}
          cardWidth={cardWidth}
          hideText={coverSize === 'S'}
          onPress={() => router.push(`/book/${item.book_id}`)}
          hasPendingCover={pendingCoverIds.has(item.books.id)}
          onAddCover={
            item.books.cover_image_url
              ? undefined
              : () => setCoverUploadTarget({ id: item.books.id, title: item.books.title })
          }
        />
      </View>
    );
  };

  const ListHeader = () => (
    <View>
      {/* Stats row — tapping a card filters the grid */}
      <View style={styles.statsRow}>
        {([
          { label: 'In Library', value: stats.total,   key: 'all'     },
          { label: 'Read',    value: stats.read,    key: 'read'    },
          { label: 'Reading', value: stats.reading, key: 'reading' },
          { label: 'Want',    value: stats.want,    key: 'want'    },
        ] as { label: string; value: number; key: FilterKey }[]).map((stat) => (
          <TouchableOpacity
            key={stat.label}
            style={[styles.statCard, filter === stat.key && styles.statCardActive]}
            onPress={() => setFilter(stat.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.statValue, filter === stat.key && styles.statValueActive]}>
              {stat.value}
            </Text>
            <Text style={[styles.statLabel, filter === stat.key && styles.statLabelActive]}>
              {stat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Library value boxes */}
      {valuationStats && (valuationStats.retailTotal > 0 || valuationStats.usedTotal > 0) && (
        <View style={styles.valueRow}>
          <TouchableOpacity
            style={styles.valueCard}
            activeOpacity={0.7}
            onPress={() => router.push('/valuation?mode=retail')}
          >
            <Text style={styles.valueIcon}>💰</Text>
            <View>
              <Text style={styles.valueAmount}>
                ${valuationStats.retailTotal.toFixed(0)}
              </Text>
              <Text style={styles.valueLabel}>Retail Value</Text>
              <Text style={styles.valueCount}>{valuationStats.retailCount} books priced</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.valueCard, { borderColor: Colors.gold }]}
            activeOpacity={0.7}
            onPress={() => router.push('/valuation?mode=used')}
          >
            <Text style={styles.valueIcon}>📊</Text>
            <View>
              <Text style={[styles.valueAmount, { color: Colors.gold }]}>
                ${valuationStats.usedTotal.toFixed(0)}
              </Text>
              <Text style={styles.valueLabel}>Used Value</Text>
              <Text style={styles.valueCount}>{valuationStats.usedCount} books priced</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* View mode + Size + Sort + Group — single compact row */}
      <View style={styles.sizeRow}>
        {/* Grid / List toggle */}
        <View style={{ flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' }}>
          <TouchableOpacity
            onPress={() => setViewMode('grid')}
            style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: viewMode === 'grid' ? Colors.rust : 'transparent' }}
          >
            <Text style={{ fontSize: 14, color: viewMode === 'grid' ? '#fff' : Colors.muted }}>⊞</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setViewMode('list')}
            style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: viewMode === 'list' ? Colors.rust : 'transparent', borderLeftWidth: 1, borderLeftColor: Colors.border }}
          >
            <Text style={{ fontSize: 14, color: viewMode === 'list' ? '#fff' : Colors.muted }}>☰</Text>
          </TouchableOpacity>
        </View>

        {/* Cover size (grid only) */}
        {viewMode === 'grid' && (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {(['S', 'M', 'L'] as SizeKey[]).map((size) => (
              <TouchableOpacity
                key={size}
                style={[styles.sizeBtn, coverSize === size && styles.sizeBtnActive]}
                onPress={() => handleSizeChange(size)}
              >
                <Text style={[styles.sizeBtnText, coverSize === size && styles.sizeBtnTextActive]}>
                  {size}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Sort dropdown */}
        <TouchableOpacity
          style={styles.dropdownBtn}
          onPress={() => setPickerSheet({
            title: 'Sort by',
            options: [
              { key: 'added',  label: 'Date Added' },
              { key: 'title',  label: 'Title' },
              { key: 'author', label: 'Author' },
              { key: 'rating', label: 'Rating' },
              { key: 'year',   label: 'Year' },
            ],
            selected: sort,
            onSelect: (key) => { setSort(key); setPickerSheet(null); },
          })}
        >
          <Text style={styles.dropdownBtnText}>
            Sort: {({ added: 'Date', title: 'Title', author: 'Author', rating: 'Rating', year: 'Year' } as Record<string, string>)[sort] || 'Date'}
          </Text>
          <Text style={{ fontSize: 8, color: Colors.muted }}>▼</Text>
        </TouchableOpacity>

        {/* Group dropdown */}
        <TouchableOpacity
          style={styles.dropdownBtn}
          onPress={() => setPickerSheet({
            title: 'Group by',
            options: [
              { key: 'none',   label: 'None' },
              { key: 'status', label: 'Status' },
              { key: 'genre',  label: 'Genre' },
              { key: 'author', label: 'Author' },
              { key: 'series', label: 'Series' },
              { key: 'decade', label: 'Decade' },
            ],
            selected: groupBy,
            onSelect: (key) => { setGroupBy(key); setPickerSheet(null); },
          })}
        >
          <Text style={[styles.dropdownBtnText, groupBy !== 'none' && { color: Colors.rust }]}>
            {groupBy === 'none' ? 'Group' : ({ status: 'Status', genre: 'Genre', author: 'Author', series: 'Series', decade: 'Decade' } as Record<string, string>)[groupBy] || 'Group'}
          </Text>
          <Text style={{ fontSize: 8, color: groupBy !== 'none' ? Colors.rust : Colors.muted }}>▼</Text>
        </TouchableOpacity>
      </View>

      {/* Search bar — sticks to top once scrolled past */}
      <View
        style={styles.searchContainer}
        onLayout={(e) => setSearchBarY(e.nativeEvent.layout.y)}
      >
        <TextInput
          style={styles.searchInput}
          placeholder="Search your library…"
          placeholderTextColor={Colors.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>
    </View>
  );

  const EmptyState = () => (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>📚</Text>
      <Text style={styles.emptyTitle}>
        {filter === 'all' ? 'Your library is empty' : `No books with status "${FILTER_OPTIONS.find(f => f.key === filter)?.label}"`}
      </Text>
      <Text style={styles.emptySubtitle}>
        {filter === 'all' ? 'Search for books to add to your collection.' : 'Try a different filter.'}
      </Text>
      {filter === 'all' && (
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/(tabs)/search')}
        >
          <Text style={styles.addButtonText}>Find Books</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const shelfBooks: ShelfBook[] = entries
    .filter((e) => e.read_status !== 'want' && e.books?.format !== 'eBook' && e.books?.format !== 'Audiobook')
    .map((e) => ({
      id: e.book_id,
      title: e.books.title,
      author: e.books.author,
      genre: e.books.genre,
      published_year: e.books.published_year,
      series_name: e.books.series_name,
      series_number: e.books.series_number,
      read_status: e.read_status,
      user_rating: e.user_rating,
      cover_image_url: e.books.cover_image_url,
      pages: e.books.pages,
    }));

  return (
    <SwipeTabNav current="index">
    <View style={styles.root}>
      {isSearchSticky && !loading && (
        <View style={[styles.searchContainer, styles.stickySearch]}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search your library…"
            placeholderTextColor={Colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      )}
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.rust} />
        </View>
      ) : filter === 'series' ? (
          <FlatList
            data={seriesGroups}
            keyExtractor={(item) => item.name}
            ListHeaderComponent={ListHeader}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📚</Text>
                <Text style={styles.emptyTitle}>No series found</Text>
                <Text style={styles.emptyDesc}>Books with series info will appear here.</Text>
              </View>
            }
            renderItem={({ item: group }) => (
              <View style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <Text style={{ fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), fontSize: 16, fontWeight: '700', color: Colors.ink }}>{group.name}</Text>
                  <Text style={{ fontSize: 12, color: group.readCount === group.books.length ? Colors.sage : Colors.muted, fontWeight: '500' }}>
                    {group.readCount}/{group.books.length} read
                  </Text>
                </View>
                <FlatList
                  data={group.books}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      onPress={() => router.push(`/book/${item.book_id}`)}
                      style={{ width: 60, marginRight: 8 }}
                    >
                      {item.books?.cover_image_url ? (
                        <Image source={{ uri: item.books.cover_image_url }} style={{ width: 60, height: 90, borderRadius: 4 }} />
                      ) : (
                        <View style={{ width: 60, height: 90, borderRadius: 4, backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 8, color: Colors.muted, textAlign: 'center', paddingHorizontal: 2 }}>{item.books?.title}</Text>
                        </View>
                      )}
                      <Text style={{ fontSize: 10, color: Colors.muted, marginTop: 2 }} numberOfLines={1}>
                        #{item.books?.series_number || '?'}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}
            contentContainerStyle={[styles.gridContent, seriesGroups.length === 0 && styles.gridContentEmpty]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />}
            onScroll={handleScroll}
            scrollEventThrottle={16}
          />
        ) : viewMode === 'list' ? (
          <FlatList
            data={groupBy !== 'none'
              ? groups.flatMap(g => [
                  { _type: 'header' as const, label: g.label || '', count: g.entries.length, id: `__header_${g.label}` } as any,
                  ...g.entries,
                ])
              : filtered}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={ListHeader}
            ListEmptyComponent={EmptyState}
            contentContainerStyle={[styles.gridContent, filtered.length === 0 && styles.gridContentEmpty]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />}
            renderItem={({ item }) => {
              if ((item as any)._type === 'header') {
                return (
                  <View style={styles.groupHeader}>
                    <Text style={styles.groupHeaderText}>{(item as any).label}</Text>
                    <Text style={styles.groupHeaderCount}>{(item as any).count}</Text>
                  </View>
                );
              }
              const entry = item as CollectionEntry;
              return (
                <TouchableOpacity
                  style={styles.listRow}
                  onPress={() => router.push(`/book/${entry.book_id}`)}
                  activeOpacity={0.7}
                >
                  {entry.books?.cover_image_url ? (
                    <Image source={{ uri: entry.books.cover_image_url }} style={styles.listCover} />
                  ) : (
                    <View style={[styles.listCover, { backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 8, color: Colors.muted }}>{entry.books?.title?.charAt(0)}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listTitle} numberOfLines={1}>{entry.books?.title}</Text>
                    {entry.books?.author && <Text style={styles.listAuthor} numberOfLines={1}>{entry.books.author}</Text>}
                  </View>
                  {entry.user_rating ? (
                    <Text style={{ fontSize: 12, color: Colors.gold }}>{'★'.repeat(entry.user_rating)}</Text>
                  ) : null}
                </TouchableOpacity>
              );
            }}
          />
        ) : groupBy !== 'none' ? (
          <FlatList
            data={groups}
            keyExtractor={(item) => item.label || '__ungrouped'}
            ListHeaderComponent={ListHeader}
            ListEmptyComponent={EmptyState}
            contentContainerStyle={[styles.gridContent, filtered.length === 0 && styles.gridContentEmpty]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />}
            renderItem={({ item: group }) => (
              <View style={{ marginBottom: 20 }}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupHeaderText}>{group.label}</Text>
                  <Text style={styles.groupHeaderCount}>{group.entries.length}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: GAP }}>
                  {group.entries.map((entry, idx) => (
                    <View key={entry.id} style={{ width: cardWidth }}>
                      <BookCard
                        id={entry.book_id}
                        title={entry.books.title}
                        author={entry.books.author}
                        coverImageUrl={entry.books.cover_image_url}
                        status={entry.read_status}
                        cardWidth={cardWidth}
                        hideText={coverSize === 'S'}
                        onPress={() => router.push(`/book/${entry.book_id}`)}
                        hasPendingCover={pendingCoverIds.has(entry.books.id)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            )}
          />
        ) : (
          <FlatList
            key={COLUMNS}
            data={paddedFiltered}
            numColumns={COLUMNS}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ListHeaderComponent={ListHeader}
            ListEmptyComponent={EmptyState}
            contentContainerStyle={[styles.gridContent, filtered.length === 0 && styles.gridContentEmpty]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={Colors.rust}
              />
            }
            onScroll={handleScroll}
            scrollEventThrottle={16}
          />
        )}

      <ShelfPlannerModal
        visible={showShelfPlanner}
        books={shelfBooks}
        onClose={() => setShowShelfPlanner(false)}
      />

      {/* Cover upload modal */}
      {coverUploadTarget && (
        <CoverUploadModal
          bookId={coverUploadTarget.id}
          bookTitle={coverUploadTarget.title}
          onClose={() => setCoverUploadTarget(null)}
          onSuccess={() => {
            setCoverUploadTarget(null);
            fetchLibrary();
          }}
        />
      )}

      {/* Picker bottom sheet */}
      {pickerSheet && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setPickerSheet(null)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setPickerSheet(null)}
            style={styles.sheetOverlay}
          >
            <View style={styles.sheetContainer}>
              <TouchableOpacity activeOpacity={1}>
                <Text style={styles.sheetTitle}>{pickerSheet.title}</Text>
                {pickerSheet.options.map((opt) => {
                  const isSelected = opt.key === pickerSheet.selected;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.sheetOption, isSelected && styles.sheetOptionSelected]}
                      onPress={() => pickerSheet.onSelect(opt.key)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.sheetOptionText, isSelected && styles.sheetOptionTextSelected]}>
                        {opt.label}
                      </Text>
                      {isSelected && (
                        <Text style={{ color: Colors.rust, fontSize: 16 }}>✓</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={styles.sheetCancel}
                  onPress={() => setPickerSheet(null)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sheetCancelText}>Cancel</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
    </SwipeTabNav>
  );
}

// ---- COVER UPLOAD MODAL (mobile) ----
function CoverUploadModal({
  bookId,
  bookTitle,
  onClose,
  onSuccess,
}: {
  bookId: string;
  bookTitle: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('image/jpeg');
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library to upload a cover.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [2, 3],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setMimeType(result.assets[0].mimeType ?? 'image/jpeg');
      setError(null);
    }
  }

  async function handleSubmit() {
    if (!imageUri) return;
    setUploading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const ext = imageUri.split('.').pop() ?? 'jpg';
      const storagePath = `${user.id}/${bookId}/${Date.now()}.${ext}`;

      const response = await fetch(imageUri);
      const blob = await response.blob();

      if (blob.size > 2 * 1024 * 1024) {
        setError('Image must be under 2 MB.');
        setUploading(false);
        return;
      }

      const { error: uploadErr } = await supabase.storage
        .from('book-covers')
        .upload(storagePath, blob, { contentType: mimeType });

      if (uploadErr) throw uploadErr;

      const { error: fnErr } = await supabase.functions.invoke('submit-cover', {
        body: { bookId, storagePath },
      });

      if (fnErr) {
        await supabase.storage.from('book-covers').remove([storagePath]);
        throw fnErr;
      }

      setDone(true);
      setTimeout(onSuccess, 1600);
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed — please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={uploadStyles.backdrop} onPress={onClose}>
        <Pressable style={uploadStyles.sheet} onPress={() => {}}>
          {done ? (
            <View style={uploadStyles.doneWrap}>
              <Text style={uploadStyles.doneIcon}>✓</Text>
              <Text style={uploadStyles.doneTitle}>Cover submitted!</Text>
              <Text style={uploadStyles.doneSub}>It'll go live once reviewed.</Text>
            </View>
          ) : (
            <>
              <View style={uploadStyles.handle} />
              <Text style={uploadStyles.title}>Add Book Cover</Text>
              <Text style={uploadStyles.bookName}>{bookTitle}</Text>
              <Text style={uploadStyles.hint}>
                Upload a cover for this book. It'll be reviewed before going live.
                {'\n'}JPG, PNG, or WebP · max 2 MB
              </Text>

              {imageUri ? (
                <View style={uploadStyles.previewWrap}>
                  <Image source={{ uri: imageUri }} style={uploadStyles.preview} resizeMode="contain" />
                  <TouchableOpacity onPress={pickImage} style={uploadStyles.changeLink}>
                    <Text style={uploadStyles.changeLinkText}>Choose a different image</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={uploadStyles.dropzone} onPress={pickImage}>
                  <Text style={uploadStyles.dropzoneIcon}>📷</Text>
                  <Text style={uploadStyles.dropzoneText}>Tap to select an image</Text>
                </TouchableOpacity>
              )}

              {error ? <Text style={uploadStyles.error}>{error}</Text> : null}

              <View style={uploadStyles.btnRow}>
                <TouchableOpacity
                  style={[uploadStyles.btnPrimary, (!imageUri || uploading) && uploadStyles.btnDisabled]}
                  onPress={handleSubmit}
                  disabled={!imageUri || uploading}
                >
                  <Text style={uploadStyles.btnPrimaryText}>
                    {uploading ? 'Uploading…' : 'Submit for Review'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={uploadStyles.btnGhost} onPress={onClose}>
                  <Text style={uploadStyles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const uploadStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26,18,8,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fdfaf4',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    borderWidth: 1,
    borderColor: '#d4c9b0',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#d4c9b0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1208',
    marginBottom: 2,
  },
  bookName: {
    fontSize: 14,
    color: '#8a7f72',
    marginBottom: 12,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  hint: {
    fontSize: 13,
    color: '#6b5f52',
    lineHeight: 19,
    marginBottom: 18,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  dropzone: {
    borderWidth: 2,
    borderColor: '#d4c9b0',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 32,
    alignItems: 'center',
    backgroundColor: '#f5f0e8',
    marginBottom: 18,
  },
  dropzoneIcon: { fontSize: 32, marginBottom: 8 },
  dropzoneText: {
    fontSize: 14,
    color: '#8a7f72',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  previewWrap: {
    alignItems: 'center',
    marginBottom: 18,
    gap: 10,
  },
  preview: {
    width: 130,
    height: 195,
    borderRadius: 6,
  },
  changeLink: {},
  changeLinkText: {
    fontSize: 12,
    color: '#8a7f72',
    textDecorationLine: 'underline',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  error: {
    color: '#c0521e',
    fontSize: 13,
    marginBottom: 12,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  btnRow: { flexDirection: 'row', gap: 10 },
  btnPrimary: {
    flex: 1,
    backgroundColor: Colors.rust,
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnPrimaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  btnGhost: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d4c9b0',
    alignItems: 'center',
  },
  btnGhostText: {
    color: '#3a3028',
    fontSize: 15,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  doneWrap: { alignItems: 'center', paddingVertical: 36 },
  doneIcon: { fontSize: 44, color: '#5a7a5a', marginBottom: 12 },
  doneTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#5a7a5a',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 6,
  },
  doneSub: {
    fontSize: 14,
    color: '#8a7f72',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});

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
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
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
  statCardActive: {
    backgroundColor: Colors.rust,
    borderColor: Colors.rust,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.rust,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  statValueActive: {
    color: '#fff',
  },
  statLabel: {
    fontSize: 10,
    color: Colors.muted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  statLabelActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  filterList: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.rust,
    borderColor: Colors.rust,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  chipTextActive: {
    color: Colors.white,
  },
  gridContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  gridContentEmpty: {
    flexGrow: 1,
  },
  gridItem: {
    // No flex: 1 — let cardWidth control sizing to prevent overflow
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
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
  addButton: {
    marginTop: 20,
    backgroundColor: Colors.rust,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  addButtonText: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: 15,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  sizeRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
    alignItems: 'center',
  },
  sizeBtn: {
    width: 32,
    height: 28,
    borderRadius: 6,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeBtnActive: {
    backgroundColor: Colors.rust,
    borderColor: Colors.rust,
  },
  sizeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  sizeBtnTextActive: {
    color: Colors.white,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  groupHeaderText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  groupHeaderCount: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.muted,
    backgroundColor: Colors.border + '66',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '44',
  },
  listCover: {
    width: 40,
    height: 60,
    borderRadius: 4,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  listAuthor: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: Platform.select({ ios: 40, android: 24 }),
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.ink,
    textAlign: 'center',
    marginBottom: 16,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 4,
  },
  sheetOptionSelected: {
    backgroundColor: Colors.rust + '14',
  },
  sheetOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  sheetOptionTextSelected: {
    color: Colors.rust,
    fontWeight: '700',
  },
  sheetCancel: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  sheetCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  dropdownBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  dropdownBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  stickySearch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: Colors.background,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchInput: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: Platform.select({ ios: 10, android: 8 }),
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  valueRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  valueCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.sage,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  valueIcon: {
    fontSize: 20,
  },
  valueAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.sage,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  valueLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  valueCount: {
    fontSize: 10,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});
