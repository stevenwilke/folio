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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { BookCard, ReadStatus } from '../../components/BookCard';

type FilterKey = 'all' | ReadStatus;

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'owned', label: 'In Library' },
  { key: 'read', label: 'Read' },
  { key: 'reading', label: 'Reading' },
  { key: 'want', label: 'Want' },
];

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

interface Stats {
  total: number;
  read: number;
  reading: number;
  want: number;
}

type SizeKey = 'S' | 'M' | 'L';
const SIZE_COLUMNS: Record<SizeKey, number> = { S: 3, M: 2, L: 1 };
const SIZE_STORAGE_KEY = 'exlibris-cover-size';

export default function LibraryScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [coverSize, setCoverSize] = useState<SizeKey>('M');

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
        books (
          id,
          title,
          author,
          cover_image_url
        )
      `)
      .eq('user_id', user.id)
      .order('added_at', { ascending: false });

    if (!error && data) {
      setEntries(data as unknown as CollectionEntry[]);

      // New user check: no books + not yet onboarded → show onboarding wizard
      if (data.length === 0) {
        const onboarded = await AsyncStorage.getItem('exlibris-onboarded');
        if (!onboarded) {
          router.replace('/onboarding');
        }
      }
    }
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchLibrary().finally(() => setLoading(false));
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchLibrary();
    setRefreshing(false);
  }

  const filtered =
    filter === 'all' ? entries : entries.filter((e) => e.read_status === filter);

  const stats: Stats = {
    total: entries.length,
    read: entries.filter((e) => e.read_status === 'read').length,
    reading: entries.filter((e) => e.read_status === 'reading').length,
    want: entries.filter((e) => e.read_status === 'want').length,
  };

  const renderItem = ({ item, index }: { item: CollectionEntry; index: number }) => {
    const col = index % COLUMNS;
    const marginLeft  = col === 0 ? 0 : GAP / 2;
    const marginRight = col === COLUMNS - 1 ? 0 : GAP / 2;
    return (
      <View style={[styles.gridItem, { marginLeft, marginRight }]}>
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
      {/* Stats row */}
      <View style={styles.statsRow}>
        {[
          { label: 'Total', value: stats.total },
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

      {/* Filter chips */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={FILTER_OPTIONS}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.filterList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.chip, filter === item.key && styles.chipActive]}
            onPress={() => setFilter(item.key)}
          >
            <Text style={[styles.chipText, filter === item.key && styles.chipTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Grid size control */}
      <View style={styles.sizeRow}>
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

  return (
    <View style={styles.root}>
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.rust} />
        </View>
      ) : (
        <FlatList
          key={COLUMNS}
          data={filtered}
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
        />
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
    flex: 1,
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
    gap: 6,
    justifyContent: 'flex-end',
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
});
