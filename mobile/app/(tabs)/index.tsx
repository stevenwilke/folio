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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { BookCard, ReadStatus } from '../../components/BookCard';
import ShelfPlannerModal, { ShelfBook } from '../../components/ShelfPlannerModal';

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
  user_rating: number | null;
  books: {
    id: string;
    title: string;
    author: string | null;
    cover_image_url: string | null;
    genre: string | null;
    published_year: number | null;
    series_name: string | null;
    series_position: number | null;
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
  const [showShelfPlanner, setShowShelfPlanner] = useState(false);
  const [pendingCoverIds, setPendingCoverIds] = useState<Set<string>>(new Set());
  const [coverUploadTarget, setCoverUploadTarget] = useState<{ id: string; title: string } | null>(null);

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
        user_rating,
        books (
          id,
          title,
          author,
          cover_image_url,
          genre,
          published_year,
          series_name,
          series_position
        )
      `)
      .eq('user_id', user.id)
      .order('added_at', { ascending: false });

    if (!error && data) {
      const entries = data as unknown as CollectionEntry[];
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

      {/* Grid size + Shelf Planner */}
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
        <TouchableOpacity
          style={styles.shelfPlannerBtn}
          onPress={() => setShowShelfPlanner(true)}
        >
          <Text style={styles.shelfPlannerBtnText}>📚 Shelf Planner</Text>
        </TouchableOpacity>
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

  const shelfBooks: ShelfBook[] = entries.map((e) => ({
    id: e.book_id,
    title: e.books.title,
    author: e.books.author,
    genre: e.books.genre,
    published_year: e.books.published_year,
    series_name: e.books.series_name,
    series_position: e.books.series_position,
    read_status: e.read_status,
    user_rating: e.user_rating,
  }));

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
    </View>
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
  shelfPlannerBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.rust,
    backgroundColor: Colors.card,
  },
  shelfPlannerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.rust,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});
