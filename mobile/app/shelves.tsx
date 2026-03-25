import React, { useCallback, useState, useEffect } from 'react';
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
  KeyboardAvoidingView,
  Alert,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Shelf {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  shelf_books: { count: number }[];
}

interface ShelfBook {
  book_id: string;
  books: {
    id: string;
    title: string;
    author: string | null;
    cover_image_url: string | null;
    isbn_13: string | null;
    isbn_10: string | null;
  } | null;
}

interface CollectionBook {
  id: string;
  books: {
    id: string;
    title: string;
    author: string | null;
    cover_image_url: string | null;
    isbn_13: string | null;
    isbn_10: string | null;
  } | null;
}

// ─── Cover helpers ─────────────────────────────────────────────────────────────

function getCoverUrl(
  cover_image_url: string | null,
  isbn_13: string | null,
  isbn_10: string | null
): string | null {
  if (cover_image_url) return cover_image_url;
  const isbn = isbn_13 || isbn_10;
  if (isbn) return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
  return null;
}

const COVER_PLACEHOLDER_COLORS = [
  '#7b4f3a', '#4a6b8a', '#5a7a5a', '#2c3e50',
  '#8b2500', '#b8860b', '#3d5a5a', '#c0521e',
];

function placeholderColor(title: string | null | undefined): string {
  const code = title?.charCodeAt(0) ?? 0;
  return COVER_PLACEHOLDER_COLORS[code % COVER_PLACEHOLDER_COLORS.length];
}

function placeholderColor2(title: string | null | undefined): string {
  const code = title?.charCodeAt(0) ?? 0;
  return COVER_PLACEHOLDER_COLORS[(code + 3) % COVER_PLACEHOLDER_COLORS.length];
}

// ─── MiniCoverPlaceholder ──────────────────────────────────────────────────────

function MiniCoverPlaceholder({ title, style }: { title: string | null | undefined; style?: object }) {
  const c1 = placeholderColor(title);
  const c2 = placeholderColor2(title);
  return (
    <View style={[{ overflow: 'hidden', borderRadius: 4 }, style, { backgroundColor: c1 }]}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          backgroundColor: 'rgba(0,0,0,0.25)',
        }}
      />
      <View
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          padding: 3,
        }}
      >
        <Text
          numberOfLines={3}
          style={{
            fontSize: 6,
            fontWeight: '500',
            color: 'rgba(255,255,255,0.9)',
            lineHeight: 8,
          }}
        >
          {title}
        </Text>
      </View>
    </View>
  );
}

// ─── BookCover ─────────────────────────────────────────────────────────────────

function BookCover({
  uri,
  title,
  width,
  height,
}: {
  uri: string | null;
  title: string | null | undefined;
  width: number;
  height: number;
}) {
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
    <MiniCoverPlaceholder
      title={title}
      style={{ width, height }}
    />
  );
}

// ─── ShelfCoverRow ─────────────────────────────────────────────────────────────

function ShelfCoverRow({ shelfId }: { shelfId: string }) {
  const [covers, setCovers] = useState<
    { cover_image_url: string | null; title: string | null; isbn_13: string | null; isbn_10: string | null }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from('shelf_books')
        .select('books(cover_image_url, title, isbn_13, isbn_10)')
        .eq('shelf_id', shelfId)
        .limit(3);
      if (!cancelled && data) {
        setCovers(
          (data as any[])
            .map((r) => r.books)
            .filter(Boolean)
        );
      }
    }
    load();
    return () => { cancelled = true; };
  }, [shelfId]);

  if (covers.length === 0) {
    return (
      <View style={styles.coverRowEmpty}>
        <Text style={styles.coverRowEmptyIcon}>📚</Text>
      </View>
    );
  }

  return (
    <View style={styles.coverRow}>
      {covers.slice(0, 3).map((book, i) => {
        const uri = getCoverUrl(book.cover_image_url, book.isbn_13, book.isbn_10);
        return (
          <View
            key={i}
            style={[
              styles.coverThumbWrapper,
              { left: i * 22, zIndex: 3 - i },
            ]}
          >
            <BookCover uri={uri} title={book.title} width={40} height={56} />
          </View>
        );
      })}
    </View>
  );
}

// ─── ShelfCard ─────────────────────────────────────────────────────────────────

function ShelfCard({
  shelf,
  onView,
}: {
  shelf: Shelf;
  onView: () => void;
}) {
  const bookCount = shelf.shelf_books?.[0]?.count ?? 0;

  return (
    <View style={styles.shelfCard}>
      <ShelfCoverRow shelfId={shelf.id} />

      <View style={styles.shelfCardBody}>
        <Text style={styles.shelfName} numberOfLines={1}>
          {shelf.name}
        </Text>
        {shelf.description ? (
          <Text style={styles.shelfDesc} numberOfLines={2}>
            {shelf.description}
          </Text>
        ) : null}
        <Text style={styles.shelfMeta}>
          {bookCount} {bookCount === 1 ? 'book' : 'books'}
        </Text>
      </View>

      <TouchableOpacity style={styles.viewButton} onPress={onView} activeOpacity={0.8}>
        <Text style={styles.viewButtonText}>View →</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── CreateShelfModal ─────────────────────────────────────────────────────────

function CreateShelfModal({
  visible,
  userId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setDescription('');
    setError(null);
    setSubmitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError('Shelf name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.from('shelves').insert({
      user_id: userId,
      name: name.trim(),
      description: description.trim() || null,
    });
    if (err) {
      setError('Could not create shelf. Please try again.');
      setSubmitting(false);
    } else {
      reset();
      onCreated();
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.modalOverlay} onPress={handleClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalKAV}
        >
          <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Shelf</Text>
              <TouchableOpacity onPress={handleClose} hitSlop={8}>
                <Text style={styles.modalCloseBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Body */}
            <View style={styles.modalBody}>
              <Text style={styles.fieldLabel}>SHELF NAME *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Summer Reads, Classics, Book Club…"
                placeholderTextColor={Colors.muted}
                value={name}
                onChangeText={setName}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />

              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>DESCRIPTION (OPTIONAL)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="What's this shelf for?"
                placeholderTextColor={Colors.muted}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.btnPrimary, submitting && styles.btnDisabled]}
                  onPress={handleSubmit}
                  disabled={submitting}
                  activeOpacity={0.8}
                >
                  <Text style={styles.btnPrimaryText}>
                    {submitting ? 'Creating…' : 'Create Shelf'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnGhost} onPress={handleClose} activeOpacity={0.7}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ─── AddBooksModal ─────────────────────────────────────────────────────────────

function AddBooksModal({
  visible,
  userId,
  shelfId,
  shelfBookIds,
  onClose,
  onAdded,
}: {
  visible: boolean;
  userId: string;
  shelfId: string;
  shelfBookIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [collection, setCollection] = useState<CollectionBook[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from('collection_entries')
        .select('id, books(id, title, author, cover_image_url, isbn_13, isbn_10)')
        .eq('user_id', userId);
      if (!cancelled) {
        setCollection((data as any[]) || []);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [visible, userId]);

  const filtered = collection.filter((entry) => {
    const book = entry.books;
    if (!book) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      book.title?.toLowerCase().includes(q) ||
      book.author?.toLowerCase().includes(q)
    );
  });

  async function handleAdd(bookId: string) {
    setAddingId(bookId);
    await supabase.from('shelf_books').insert({ shelf_id: shelfId, book_id: bookId });
    setAddingId(null);
    onAdded();
  }

  function handleClose() {
    setSearchQuery('');
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.modalOverlay} onPress={handleClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.addBooksKAV}
        >
          <Pressable style={styles.addBooksBox} onPress={(e) => e.stopPropagation()}>
            {/* Handle bar */}
            <View style={styles.sheetHandle} />

            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Books</Text>
              <TouchableOpacity onPress={handleClose} hitSlop={8}>
                <Text style={styles.modalCloseBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={styles.addBooksSearchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by title or author…"
                placeholderTextColor={Colors.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="search"
              />
            </View>

            {/* List */}
            {loading ? (
              <View style={styles.addBooksLoader}>
                <ActivityIndicator size="small" color={Colors.rust} />
              </View>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={(item) => item.id}
                style={styles.addBooksList}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const book = item.books;
                  if (!book) return null;
                  const uri = getCoverUrl(book.cover_image_url, book.isbn_13, book.isbn_10);
                  const alreadyAdded = shelfBookIds.has(book.id);
                  return (
                    <View style={styles.addBookRow}>
                      <BookCover uri={uri} title={book.title} width={36} height={50} />
                      <View style={styles.addBookInfo}>
                        <Text style={styles.addBookTitle} numberOfLines={2}>
                          {book.title}
                        </Text>
                        {book.author ? (
                          <Text style={styles.addBookAuthor} numberOfLines={1}>
                            {book.author}
                          </Text>
                        ) : null}
                      </View>
                      {alreadyAdded ? (
                        <Text style={styles.alreadyAddedText}>✓ Added</Text>
                      ) : (
                        <TouchableOpacity
                          style={[styles.btnAddSmall, addingId === book.id && styles.btnDisabled]}
                          onPress={() => handleAdd(book.id)}
                          disabled={addingId === book.id}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.btnPrimaryText}>
                            {addingId === book.id ? '…' : 'Add'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.emptySubtitle}>
                    {searchQuery.trim() ? 'No books match your search.' : 'Your collection is empty.'}
                  </Text>
                }
              />
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ─── ShelfDetail ───────────────────────────────────────────────────────────────

function ShelfDetail({
  shelf,
  userId,
  onBack,
  onDeleted,
}: {
  shelf: Shelf;
  userId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [shelfBooks, setShelfBooks] = useState<ShelfBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddBooks, setShowAddBooks] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function fetchShelfBooks() {
    setLoading(true);
    const { data } = await supabase
      .from('shelf_books')
      .select('book_id, books(id, title, author, cover_image_url, isbn_13, isbn_10)')
      .eq('shelf_id', shelf.id);
    setShelfBooks((data as any[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchShelfBooks();
  }, [shelf.id]);

  async function handleRemove(bookId: string) {
    setRemovingId(bookId);
    await supabase
      .from('shelf_books')
      .delete()
      .eq('shelf_id', shelf.id)
      .eq('book_id', bookId);
    setRemovingId(null);
    fetchShelfBooks();
  }

  function handleDeleteShelf() {
    Alert.alert(
      'Delete Shelf',
      `Are you sure you want to delete "${shelf.name}" and all its books?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            await supabase
              .from('shelves')
              .delete()
              .eq('id', shelf.id)
              .eq('user_id', userId);
            onDeleted();
          },
        },
      ]
    );
  }

  const shelfBookIds = new Set(shelfBooks.map((sb) => sb.book_id));

  return (
    <View style={styles.detailRoot}>
      {/* Back row */}
      <TouchableOpacity style={styles.backRow} onPress={onBack} activeOpacity={0.7}>
        <Text style={styles.backText}>← Shelves</Text>
      </TouchableOpacity>

      {/* Header */}
      <View style={styles.detailHeaderRow}>
        <View style={styles.detailHeaderText}>
          <Text style={styles.detailTitle}>{shelf.name}</Text>
          {shelf.description ? (
            <Text style={styles.detailDesc}>{shelf.description}</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() => setShowAddBooks(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.btnPrimaryText}>+ Add Books</Text>
        </TouchableOpacity>
      </View>

      {/* Book list */}
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.rust} />
        </View>
      ) : (
        <FlatList
          data={shelfBooks}
          keyExtractor={(item) => item.book_id}
          contentContainerStyle={[
            styles.detailListContent,
            shelfBooks.length === 0 && styles.detailListEmpty,
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📖</Text>
              <Text style={styles.emptyTitle}>No books on this shelf yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap "+ Add Books" to add from your collection.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const book = item.books;
            if (!book) return null;
            const uri = getCoverUrl(book.cover_image_url, book.isbn_13, book.isbn_10);
            return (
              <View style={styles.shelfBookCard}>
                <BookCover uri={uri} title={book.title} width={60} height={80} />
                <View style={styles.shelfBookInfo}>
                  <Text style={styles.shelfBookTitle} numberOfLines={2}>
                    {book.title}
                  </Text>
                  {book.author ? (
                    <Text style={styles.shelfBookAuthor} numberOfLines={1}>
                      {book.author}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => handleRemove(book.id)}
                  disabled={removingId === book.id}
                  hitSlop={8}
                >
                  <Text style={styles.removeBtnText}>
                    {removingId === book.id ? '…' : '✕'}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          }}
          ListFooterComponent={
            shelfBooks.length > 0 ? (
              <TouchableOpacity
                style={[styles.btnDanger, deleting && styles.btnDisabled, styles.deleteShelfBtn]}
                onPress={handleDeleteShelf}
                disabled={deleting}
                activeOpacity={0.8}
              >
                <Text style={styles.btnDangerText}>
                  {deleting ? 'Deleting…' : 'Delete Shelf'}
                </Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {/* Delete shelf button when list is empty (shown outside FlatList footer) */}
      {!loading && shelfBooks.length === 0 ? (
        <TouchableOpacity
          style={[styles.btnDanger, deleting && styles.btnDisabled, styles.deleteShelfBtnBottom]}
          onPress={handleDeleteShelf}
          disabled={deleting}
          activeOpacity={0.8}
        >
          <Text style={styles.btnDangerText}>
            {deleting ? 'Deleting…' : 'Delete Shelf'}
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* Add Books Modal */}
      <AddBooksModal
        visible={showAddBooks}
        userId={userId}
        shelfId={shelf.id}
        shelfBookIds={shelfBookIds}
        onClose={() => setShowAddBooks(false)}
        onAdded={() => fetchShelfBooks()}
      />
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function ShelvesScreen() {
  const router = useRouter();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [activeShelf, setActiveShelf] = useState<Shelf | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  async function fetchShelves(uid?: string) {
    const id = uid ?? userId;
    if (!id) return;
    const { data } = await supabase
      .from('shelves')
      .select('id, name, description, created_at, shelf_books(count)')
      .eq('user_id', id)
      .order('created_at', { ascending: false });
    setShelves((data as any[]) || []);
  }

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      async function init() {
        setLoading(true);
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) { setLoading(false); return; }
        setUserId(session.user.id);
        await fetchShelves(session.user.id);
        if (!cancelled) setLoading(false);
      }
      init();
      return () => { cancelled = true; };
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchShelves();
    setRefreshing(false);
  }

  // ── Detail view ──
  if (activeShelf && userId) {
    return (
      <ShelfDetail
        shelf={activeShelf}
        userId={userId}
        onBack={() => {
          setActiveShelf(null);
          fetchShelves();
        }}
        onDeleted={() => {
          setActiveShelf(null);
          fetchShelves();
        }}
      />
    );
  }

  // ── Shelf list view ──
  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={shelves}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          shelves.length === 0 && styles.listContentEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.rust}
          />
        }
        renderItem={({ item }) => (
          <ShelfCard
            shelf={item}
            onView={() => setActiveShelf(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📚</Text>
            <Text style={styles.emptyTitle}>No shelves yet</Text>
            <Text style={styles.emptySubtitle}>
              Create a shelf to organise your books into custom reading lists.
            </Text>
            <TouchableOpacity
              style={[styles.btnPrimary, { marginTop: 20 }]}
              onPress={() => setShowCreate(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnPrimaryText}>+ Create your first shelf</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* FAB */}
      {shelves.length > 0 ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setShowCreate(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      ) : null}

      {/* Create Shelf Modal */}
      {userId ? (
        <CreateShelfModal
          visible={showCreate}
          userId={userId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchShelves();
          }}
        />
      ) : null}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

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

  // ── List ──
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  listContentEmpty: {
    flexGrow: 1,
  },

  // ── Shelf card ──
  shelfCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 12,
    gap: 12,
    shadowColor: '#1a1208',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 2,
  },
  coverRow: {
    height: 60,
    position: 'relative',
  },
  coverThumbWrapper: {
    position: 'absolute',
    shadowColor: '#1a1208',
    shadowOffset: { width: 1, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  coverRowEmpty: {
    height: 56,
    width: 48,
    backgroundColor: Colors.background,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverRowEmptyIcon: {
    fontSize: 22,
    opacity: 0.5,
  },
  shelfCardBody: {
    gap: 3,
  },
  shelfName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  shelfDesc: {
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 18,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  shelfMeta: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  viewButton: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.rust,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  viewButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // ── FAB ──
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.rust,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1a1208',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 32,
    marginTop: -1,
  },

  // ── Empty state ──
  emptyState: {
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

  // ── Modal shared ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26,18,8,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalKAV: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  modalBox: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    width: '100%',
    maxWidth: 480,
    shadowColor: '#1a1208',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  modalCloseBtn: {
    fontSize: 16,
    color: Colors.muted,
    padding: 4,
  },
  modalBody: {
    padding: 20,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.muted,
    letterSpacing: 0.8,
    marginBottom: 6,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  textArea: {
    minHeight: 80,
    paddingTop: 10,
  },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    marginTop: 8,
    marginBottom: 4,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },

  // ── Add Books Modal (bottom sheet style) ──
  addBooksKAV: {
    width: '100%',
    justifyContent: 'flex-end',
    flex: 1,
  },
  addBooksBox: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    shadowColor: '#1a1208',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  addBooksSearchRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchInput: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  addBooksLoader: {
    padding: 32,
    alignItems: 'center',
  },
  addBooksList: {
    flexGrow: 0,
  },
  addBookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  addBookInfo: {
    flex: 1,
    gap: 2,
  },
  addBookTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  addBookAuthor: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  alreadyAddedText: {
    fontSize: 12,
    color: Colors.sage,
    fontWeight: '600',
    paddingHorizontal: 8,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // ── Shelf detail ──
  detailRoot: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  backRow: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  backText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.rust,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  detailHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
  },
  detailHeaderText: {
    flex: 1,
    gap: 4,
  },
  detailTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  detailDesc: {
    fontSize: 14,
    color: Colors.muted,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  detailListContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 8,
  },
  detailListEmpty: {
    flexGrow: 1,
  },
  shelfBookCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    shadowColor: '#1a1208',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  shelfBookInfo: {
    flex: 1,
    gap: 3,
  },
  shelfBookTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    lineHeight: 19,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  shelfBookAuthor: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  removeBtn: {
    padding: 6,
    borderRadius: 6,
  },
  removeBtnText: {
    fontSize: 14,
    color: Colors.muted,
    fontWeight: '600',
  },

  // ── Delete shelf ──
  deleteShelfBtn: {
    marginTop: 24,
    marginHorizontal: 0,
  },
  deleteShelfBtnBottom: {
    marginHorizontal: 16,
    marginBottom: 32,
    marginTop: 8,
  },

  // ── Buttons ──
  btnPrimary: {
    backgroundColor: Colors.rust,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnGhostText: {
    color: Colors.ink,
    fontSize: 13,
    fontWeight: '500',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  btnAddSmall: {
    backgroundColor: Colors.rust,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
    minWidth: 44,
  },
  btnDanger: {
    borderWidth: 1,
    borderColor: '#f5c6c6',
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnDangerText: {
    color: '#c0392b',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
