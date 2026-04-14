import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Share,
  Alert,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';

// ── Genre colour palette ──────────────────────────────────────────────────────
const GENRE_COLORS: Record<string, { spine: string; text: string }> = {
  'Science Fiction':    { spine: '#1a5c8a', text: '#e8f4fd' },
  'Fantasy':            { spine: '#5a2d82', text: '#f0e8ff' },
  'Mystery':            { spine: '#1a4d2e', text: '#e8f5ee' },
  'Thriller':           { spine: '#7a1a1a', text: '#ffe8e8' },
  'Horror':             { spine: '#2a0a0a', text: '#ffd0d0' },
  'Romance':            { spine: '#8a1a5c', text: '#ffe8f4' },
  'Historical Fiction': { spine: '#5c3a1a', text: '#fff0e0' },
  'Literary Fiction':   { spine: '#1a5c3a', text: '#e8fff0' },
  'Biography':          { spine: '#4a3a0a', text: '#fff8e0' },
  'Non-Fiction':        { spine: '#1a3a5c', text: '#e0f0ff' },
  'Self-Help':          { spine: '#5c4a1a', text: '#fff5e0' },
  'Young Adult':        { spine: '#1a7a5c', text: '#e0fff8' },
  "Children's":         { spine: '#7a5c1a', text: '#fff8e0' },
  'Graphic Novel':      { spine: '#3a1a7a', text: '#ece8ff' },
  'Poetry':             { spine: '#7a3a5c', text: '#ffe8f4' },
};
const DEFAULT_COLOR = { spine: '#6b5c4a', text: '#fff8f0' };

const GENRE_OVERRIDES_KEY = 'folio-genre-overrides';
const ALL_GENRES = Object.keys(GENRE_COLORS);

function getGenreColor(genre: string | null) {
  if (!genre) return DEFAULT_COLOR;
  for (const [key, val] of Object.entries(GENRE_COLORS)) {
    if (genre.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return DEFAULT_COLOR;
}

function getSpineWidth(pages: number | null) {
  if (!pages) return 22;
  return Math.max(16, Math.min(36, Math.round(pages / 18)));
}

// ── Sort methods ──────────────────────────────────────────────────────────────
const SORT_METHODS = [
  { id: 'alpha-title',  label: 'A–Z by Title',  icon: '🔤' },
  { id: 'alpha-author', label: 'A–Z by Author', icon: '👤' },
  { id: 'genre',        label: 'By Genre',      icon: '📚' },
  { id: 'genre-alpha',  label: 'Genre + Title', icon: '🗂️' },
  { id: 'year',         label: 'By Year',       icon: '📅' },
  { id: 'color',        label: 'Rainbow',       icon: '🌈' },
  { id: 'status',       label: 'By Status',     icon: '✅' },
];

const COLOR_ORDER = [
  'Romance', 'Horror', 'Thriller', 'Literary Fiction', 'Mystery',
  'Historical Fiction', 'Biography', 'Non-Fiction', 'Self-Help',
  'Young Adult', "Children's", 'Science Fiction', 'Fantasy',
  'Graphic Novel', 'Poetry',
];

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ShelfBook {
  id: string;
  title: string;
  author: string | null;
  genre: string | null;
  published_year: number | null;
  series_name?: string | null;
  series_position?: number | null;
  read_status: string;
  user_rating?: number | null;
  // Set internally by ShelfPlannerModal — do not pass from outside
  _originalGenre?: string | null;
  _hasOverride?: boolean;
}

interface AnalysisResult {
  shelf_count: number;
  books_per_shelf: number[];
  total_capacity: number;
  notes?: string;
  recognized_books?: { title: string; author?: string; shelf?: number }[];
}

// ── Sorting ───────────────────────────────────────────────────────────────────
function sortBooks(books: ShelfBook[], method: string): ShelfBook[] {
  const copy = [...books];
  switch (method) {
    case 'alpha-title':
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'alpha-author':
      return copy.sort((a, b) => {
        const aLast = (a.author || 'zzz').split(' ').pop() || '';
        const bLast = (b.author || 'zzz').split(' ').pop() || '';
        return aLast.localeCompare(bLast) || a.title.localeCompare(b.title);
      });
    case 'genre':
    case 'genre-alpha':
      return copy.sort((a, b) => {
        const gA = a.genre || 'zzz';
        const gB = b.genre || 'zzz';
        if (gA !== gB) return gA.localeCompare(gB);
        return method === 'genre-alpha' ? a.title.localeCompare(b.title) : 0;
      });
    case 'year':
      return copy.sort((a, b) => (a.published_year || 9999) - (b.published_year || 9999));
    case 'color':
      return copy.sort((a, b) => {
        const iA = COLOR_ORDER.indexOf(a.genre || '');
        const iB = COLOR_ORDER.indexOf(b.genre || '');
        return (iA === -1 ? 999 : iA) - (iB === -1 ? 999 : iB) || a.title.localeCompare(b.title);
      });
    case 'status': {
      const order: Record<string, number> = { reading: 0, read: 1, want: 2, owned: 3 };
      return copy.sort(
        (a, b) =>
          (order[a.read_status] ?? 9) - (order[b.read_status] ?? 9) ||
          a.title.localeCompare(b.title),
      );
    }
    default:
      return copy;
  }
}

function distributeToShelves(
  books: ShelfBook[],
  shelfCount: number,
  booksPerShelf: number,
): ShelfBook[][] {
  const shelves: ShelfBook[][] = Array.from({ length: shelfCount }, () => []);
  let idx = 0;
  for (const shelf of shelves) {
    while (idx < books.length && shelf.length < booksPerShelf) {
      shelf.push(books[idx++]);
    }
  }
  if (idx < books.length) shelves.push(books.slice(idx));
  return shelves;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  visible: boolean;
  books: ShelfBook[];
  onClose: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ShelfPlannerModal({ visible, books, onClose }: Props) {
  const [step, setStep] = useState<'setup' | 'arrange'>('setup');

  // Setup
  const [shelfCount, setShelfCount] = useState(3);
  const [booksPerShelf, setBooksPerShelf] = useState(30);

  // Photo analysis
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Arrange
  const [sortMethod, setSortMethod] = useState('genre-alpha');
  const [activeTab, setActiveTab] = useState<'visual' | 'guide'>('visual');

  // Genre overrides (persisted to AsyncStorage, keyed by book_id)
  const [genreOverrides, setGenreOverrides] = useState<Record<string, string>>({});
  const [genrePicking, setGenrePicking] = useState<{
    bookId: string;
    currentGenre: string | null;
    originalGenre: string | null;
  } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(GENRE_OVERRIDES_KEY).then((val) => {
      if (val) {
        try { setGenreOverrides(JSON.parse(val)); } catch { /* ignore */ }
      }
    });
  }, []);

  async function setGenreOverride(bookId: string, genre: string | null) {
    const next = { ...genreOverrides };
    if (genre) next[bookId] = genre;
    else delete next[bookId];
    setGenreOverrides(next);
    await AsyncStorage.setItem(GENRE_OVERRIDES_KEY, JSON.stringify(next));
  }

  // Apply overrides before sorting so genre-based sorts use the effective genre
  const booksWithOverrides = books.filter((b) => b.title).map((b) => ({
    ...b,
    genre: b.id in genreOverrides ? genreOverrides[b.id] : b.genre,
    _originalGenre: b.genre,
    _hasOverride: b.id in genreOverrides,
  }));
  const sortedBooks = sortBooks(booksWithOverrides, sortMethod);
  const shelves = distributeToShelves(sortedBooks, shelfCount, booksPerShelf);

  // ── Photo pick + analyze ────────────────────────────────────────────────────
  async function pickAndAnalyzePhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library to use this feature.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
    });

    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      setAnalysisError('Could not read image data.');
      return;
    }

    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('analyze-shelf', {
        body: { imageBase64: asset.base64, mimeType: asset.mimeType || 'image/jpeg' },
      });

      if (error || data?.error) {
        setAnalysisError(data?.error || error?.message || 'Analysis failed');
      } else {
        setAnalysisResult(data as AnalysisResult);
        if (data.shelf_count) setShelfCount(data.shelf_count);
        if (data.books_per_shelf?.length) {
          const avg = Math.round(
            data.books_per_shelf.reduce((a: number, b: number) => a + b, 0) /
              data.books_per_shelf.length,
          );
          setBooksPerShelf(Math.max(5, avg));
        }
      }
    } catch (err: any) {
      setAnalysisError(err?.message || 'Unexpected error');
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Share guide ─────────────────────────────────────────────────────────────
  async function shareGuide() {
    const methodLabel = SORT_METHODS.find((m) => m.id === sortMethod)?.label || sortMethod;
    const lines: string[] = [`📚 Shelf Arrangement Guide\nOrder: ${methodLabel}\n`];
    shelves.forEach((shelf, si) => {
      lines.push(`\nShelf ${si + 1} (${shelf.length} books):`);
      shelf.forEach((book, bi) => {
        lines.push(`  ${bi + 1}. ${book.title}${book.author ? ' — ' + book.author : ''}`);
      });
    });
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // user cancelled — ignore
    }
  }

  // ── Close / reset ───────────────────────────────────────────────────────────
  function handleClose() {
    setStep('setup');
    setAnalysisResult(null);
    setAnalysisError(null);
    onClose();
  }

  // ── Setup step ──────────────────────────────────────────────────────────────
  function renderSetup() {
    const capacity = shelfCount * booksPerShelf;
    const overflow = books.length - capacity;
    return (
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {/* AI photo analysis */}
        <Text style={styles.sectionLabel}>ANALYZE YOUR SHELF (OPTIONAL)</Text>
        <View style={styles.card}>
          <Text style={styles.cardDesc}>
            Pick a photo of your bookcase and AI will automatically detect the number of shelves and
            estimate capacity.
          </Text>
          <TouchableOpacity
            style={[styles.btn, analyzing && styles.btnDisabled]}
            onPress={pickAndAnalyzePhoto}
            disabled={analyzing}
            activeOpacity={0.8}
          >
            {analyzing ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Text style={styles.btnText}>📸  Pick Shelf Photo</Text>
            )}
          </TouchableOpacity>

          {!!analysisError && <Text style={styles.errorText}>{analysisError}</Text>}

          {!!analysisResult && (
            <View style={styles.analysisBox}>
              <Text style={styles.analysisTitle}>✅ Analysis complete!</Text>
              <Text style={styles.analysisLine}>🗄️ {analysisResult.shelf_count} shelves detected</Text>
              <Text style={styles.analysisLine}>📦 ~{analysisResult.total_capacity} book capacity</Text>
              {!!analysisResult.notes && (
                <Text style={styles.analysisNotes}>{analysisResult.notes}</Text>
              )}
              {!!analysisResult.recognized_books?.length && (
                <>
                  <Text style={[styles.analysisLine, { marginTop: 10, fontWeight: '600' }]}>
                    Books I spotted:
                  </Text>
                  {analysisResult.recognized_books.slice(0, 6).map((b, i) => (
                    <Text key={i} style={styles.spottedBook}>
                      • {b.title}{b.author ? ` by ${b.author}` : ''}
                    </Text>
                  ))}
                </>
              )}
            </View>
          )}
        </View>

        {/* Manual config */}
        <Text style={styles.sectionLabel}>CONFIGURE SHELVES</Text>
        <View style={styles.card}>
          <View style={styles.configRow}>
            <View style={styles.configCol}>
              <Text style={styles.configLabel}>Shelves</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => setShelfCount(Math.max(1, shelfCount - 1))}
                >
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepValue}>{shelfCount}</Text>
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => setShelfCount(Math.min(20, shelfCount + 1))}
                >
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.configDivider} />

            <View style={styles.configCol}>
              <Text style={styles.configLabel}>Books per shelf</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => setBooksPerShelf(Math.max(5, booksPerShelf - 5))}
                >
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepValue}>{booksPerShelf}</Text>
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => setBooksPerShelf(Math.min(80, booksPerShelf + 5))}
                >
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.capacityRow}>
            <Text style={styles.capacityText}>
              {shelfCount} × {booksPerShelf} ={' '}
              <Text style={{ fontWeight: '700' }}>{capacity}</Text> capacity
              {overflow > 0 && (
                <Text style={{ color: Colors.rust }}>  ·  {overflow} books overflow</Text>
              )}
            </Text>
          </View>
        </View>

        {/* Genre legend */}
        <Text style={styles.sectionLabel}>GENRE COLOUR GUIDE</Text>
        <View style={styles.card}>
          <View style={styles.legendGrid}>
            {Object.entries(GENRE_COLORS).map(([genre, c]) => (
              <View key={genre} style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: c.spine }]} />
                <Text style={styles.legendLabel}>{genre}</Text>
              </View>
            ))}
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: DEFAULT_COLOR.spine }]} />
              <Text style={styles.legendLabel}>Other</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  }

  // ── Arrange step ────────────────────────────────────────────────────────────
  function renderArrange() {
    return (
      <>
        {/* Sort chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.sortBar}
          contentContainerStyle={styles.sortBarContent}
        >
          {SORT_METHODS.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.sortChip, sortMethod === m.id && styles.sortChipActive]}
              onPress={() => setSortMethod(m.id)}
            >
              <Text
                style={[styles.sortChipText, sortMethod === m.id && styles.sortChipTextActive]}
              >
                {m.icon} {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* View tabs */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'visual' && styles.tabBtnActive]}
            onPress={() => setActiveTab('visual')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'visual' && styles.tabBtnTextActive]}>
              🖼️ Visual
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'guide' && styles.tabBtnActive]}
            onPress={() => setActiveTab('guide')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'guide' && styles.tabBtnTextActive]}>
              📋 List
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'visual' ? (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {shelves.map((shelf, si) => (
              <View key={si} style={styles.shelfContainer}>
                <Text style={styles.shelfLabel}>
                  Shelf {si + 1} · {shelf.length} books
                </Text>
                {/* Book spines */}
                <View style={styles.shelfInner}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.spinesRow}
                  >
                    {shelf.map((book, bi) => {
                      const colors = getGenreColor(book.genre);
                      const spineW = getSpineWidth(book.pages);
                      const spineH = 100 + ((book.title?.charCodeAt(0) || 0) % 5) * 8;
                      return (
                        <View
                          key={book.id || bi}
                          style={[styles.spine, { backgroundColor: colors.spine, width: spineW, height: spineH }]}
                        >
                          <Text
                            style={[styles.spineText, { color: colors.text }]}
                            numberOfLines={5}
                          >
                            {book.title.length > 35 ? book.title.slice(0, 33) + '…' : book.title}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                  {/* Shelf board */}
                  <View style={styles.shelfBoard} />
                </View>
              </View>
            ))}
            <Text style={styles.hint}>
              Scroll each shelf horizontally · Colours represent genre
            </Text>
          </ScrollView>
        ) : (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <TouchableOpacity
              style={[styles.btn, { marginBottom: 16 }]}
              onPress={shareGuide}
              activeOpacity={0.8}
            >
              <Text style={styles.btnText}>📤  Share Arrangement Guide</Text>
            </TouchableOpacity>

            {shelves.map((shelf, si) => (
              <View key={si} style={{ marginBottom: 20 }}>
                <Text style={styles.guideShelfHeader}>
                  Shelf {si + 1} — {shelf.length} books
                </Text>
                {shelf.map((book, bi) => {
                  const gc = getGenreColor(book.genre);
                  return (
                    <View key={book.id || bi} style={styles.guideRow}>
                      <Text style={styles.guideNum}>{bi + 1}.</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.guideTitle} numberOfLines={2}>
                          {book.title}
                        </Text>
                        {!!book.author && (
                          <Text style={styles.guideAuthor} numberOfLines={1}>
                            {book.author}
                          </Text>
                        )}
                      </View>
                      {/* Tappable genre pill */}
                      <TouchableOpacity
                        onPress={() => setGenrePicking({
                          bookId: book.id,
                          currentGenre: book.genre,
                          originalGenre: book._originalGenre ?? null,
                        })}
                        style={[
                          styles.genrePill,
                          {
                            backgroundColor: book.genre ? gc.spine + '28' : Colors.border + '44',
                            borderWidth: book._hasOverride ? 1 : 0,
                            borderColor: gc.spine,
                            borderStyle: 'dashed',
                          },
                        ]}
                        activeOpacity={0.7}
                      >
                        {book._hasOverride && (
                          <Text style={[styles.genrePillText, { color: gc.spine, fontSize: 8, marginRight: 2 }]}>✎</Text>
                        )}
                        <Text style={[styles.genrePillText, { color: book.genre ? gc.spine : Colors.muted }]} numberOfLines={1}>
                          {book.genre ? book.genre.split(' ').slice(0, 2).join(' ') : '+ genre'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        )}
      </>
    );
  }

  // ── Modal ───────────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>📚 Shelf Planner</Text>
            <Text style={styles.subtitle}>
              {step === 'setup'
                ? `Arrange your ${books.length} books`
                : `${shelves.length} shelves · ${sortedBooks.length} books`}
            </Text>
          </View>
          <TouchableOpacity
            onPress={step === 'arrange' ? () => setStep('setup') : handleClose}
            style={styles.closeBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.closeBtnText}>{step === 'arrange' ? '← Back' : '✕'}</Text>
          </TouchableOpacity>
        </View>

        {step === 'setup' ? renderSetup() : renderArrange()}

        {/* Footer (setup only) */}
        {step === 'setup' && (
          <View style={styles.footer}>
            <TouchableOpacity style={styles.btnGhost} onPress={handleClose}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { flex: 1 }]}
              onPress={() => setStep('arrange')}
              activeOpacity={0.8}
            >
              <Text style={styles.btnText}>Plan my shelves →</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Genre picker overlay */}
        {!!genrePicking && (
          <View style={styles.pickerOverlay}>
            <TouchableOpacity
              style={styles.pickerBackdrop}
              activeOpacity={1}
              onPress={() => setGenrePicking(null)}
            />
            <View style={styles.pickerSheet}>
              <Text style={styles.pickerTitle}>Change genre for shelf planning</Text>
              <Text style={styles.pickerSubtitle}>
                This only affects how this book is sorted and coloured in the planner.
              </Text>
              <ScrollView style={styles.pickerList} bounces={false}>
                {/* Reset option — only shown when there's an active override */}
                {genrePicking.originalGenre !== null && genrePicking.currentGenre !== genrePicking.originalGenre && (
                  <TouchableOpacity
                    style={styles.pickerRowReset}
                    onPress={() => {
                      setGenreOverride(genrePicking.bookId, null);
                      setGenrePicking(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.pickerRowResetText}>
                      ↩  Reset to "{genrePicking.originalGenre}"
                    </Text>
                  </TouchableOpacity>
                )}
                {ALL_GENRES.map((genre) => {
                  const gc = getGenreColor(genre);
                  const isSelected = genrePicking.currentGenre === genre;
                  return (
                    <TouchableOpacity
                      key={genre}
                      style={[styles.pickerRow, isSelected && styles.pickerRowSelected]}
                      onPress={() => {
                        setGenreOverride(genrePicking.bookId, genre);
                        setGenrePicking(null);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.pickerSwatch, { backgroundColor: gc.spine }]} />
                      <Text style={[styles.pickerRowText, isSelected && { color: Colors.rust, fontWeight: '700' }]}>
                        {genre}
                      </Text>
                      {isSelected && <Text style={styles.pickerCheck}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TouchableOpacity
                style={styles.pickerCancel}
                onPress={() => setGenrePicking(null)}
                activeOpacity={0.8}
              >
                <Text style={styles.pickerCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const FONT_SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
const FONT_SANS = Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' });

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: FONT_SERIF,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
    fontFamily: FONT_SANS,
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    fontSize: 15,
    color: Colors.muted,
    fontWeight: '600',
    fontFamily: FONT_SANS,
  },

  // Body
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    paddingBottom: 32,
  },

  // Section label
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.muted,
    letterSpacing: 0.7,
    marginBottom: 8,
    marginTop: 4,
    fontFamily: FONT_SANS,
  },

  // Card
  card: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 20,
  },
  cardDesc: {
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 19,
    marginBottom: 14,
    fontFamily: FONT_SANS,
  },

  // Buttons
  btn: {
    backgroundColor: Colors.rust,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONT_SANS,
  },
  btnGhost: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnGhostText: {
    color: Colors.muted,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONT_SANS,
  },

  // Error / analysis
  errorText: {
    color: Colors.error,
    fontSize: 13,
    marginTop: 10,
    fontFamily: FONT_SANS,
  },
  analysisBox: {
    marginTop: 14,
    padding: 12,
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  analysisTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.ink,
    marginBottom: 6,
    fontFamily: FONT_SANS,
  },
  analysisLine: {
    fontSize: 13,
    color: Colors.ink,
    lineHeight: 20,
    fontFamily: FONT_SANS,
  },
  analysisNotes: {
    fontSize: 12,
    color: Colors.muted,
    fontStyle: 'italic',
    marginTop: 6,
    fontFamily: FONT_SANS,
  },
  spottedBook: {
    fontSize: 12,
    color: Colors.muted,
    lineHeight: 18,
    fontFamily: FONT_SANS,
  },

  // Config (stepper)
  configRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  configCol: {
    flex: 1,
    alignItems: 'center',
  },
  configDivider: {
    width: 1,
    backgroundColor: Colors.border,
    alignSelf: 'stretch',
    marginHorizontal: 8,
  },
  configLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.muted,
    marginBottom: 10,
    fontFamily: FONT_SANS,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 18,
    color: Colors.ink,
    lineHeight: 22,
    fontFamily: FONT_SANS,
  },
  stepValue: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.ink,
    minWidth: 32,
    textAlign: 'center',
    fontFamily: FONT_SERIF,
  },
  capacityRow: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
  },
  capacityText: {
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    fontFamily: FONT_SANS,
  },

  // Legend
  legendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    width: '45%',
  },
  legendSwatch: {
    width: 10,
    height: 18,
    borderRadius: 2,
  },
  legendLabel: {
    fontSize: 11,
    color: Colors.ink,
    fontFamily: FONT_SANS,
    flexShrink: 1,
  },

  // Sort bar
  sortBar: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
    flexGrow: 0,
    flexShrink: 0,
  },
  sortBarContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    alignItems: 'center',
  },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  sortChipActive: {
    borderColor: Colors.rust,
    backgroundColor: Colors.rust + '18',
  },
  sortChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.muted,
    fontFamily: FONT_SANS,
  },
  sortChipTextActive: {
    color: Colors.rust,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: {
    borderBottomColor: Colors.rust,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.muted,
    fontFamily: FONT_SANS,
  },
  tabBtnTextActive: {
    color: Colors.rust,
  },

  // Visual shelf
  shelfContainer: {
    marginBottom: 24,
  },
  shelfLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
    fontFamily: FONT_SANS,
  },
  shelfInner: {
    backgroundColor: '#f5efe6',
    borderRadius: 6,
    overflow: 'hidden',
  },
  spinesRow: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 0,
    gap: 3,
    alignItems: 'flex-end',
  },
  spine: {
    borderRadius: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  spineText: {
    fontSize: 7,
    fontWeight: '600',
    textAlign: 'center',
    writingDirection: 'ltr',
    transform: [{ rotate: '-90deg' }],
    width: 90,
    lineHeight: 9,
    fontFamily: FONT_SANS,
  },
  shelfBoard: {
    height: 10,
    backgroundColor: '#b8956a',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  hint: {
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 8,
    fontFamily: FONT_SANS,
  },

  // List / guide
  guideShelfHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.rust,
    paddingBottom: 6,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    fontFamily: FONT_SANS,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '55',
    gap: 8,
  },
  guideNum: {
    width: 24,
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'right',
    marginTop: 1,
    fontFamily: FONT_SANS,
  },
  guideTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: FONT_SANS,
    lineHeight: 18,
  },
  guideAuthor: {
    fontSize: 11,
    color: Colors.muted,
    marginTop: 1,
    fontFamily: FONT_SANS,
  },
  genrePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginTop: 2,
    maxWidth: 80,
  },
  genrePillText: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: FONT_SANS,
  },

  // Genre picker overlay
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  pickerSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    maxHeight: '75%',
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.ink,
    textAlign: 'center',
    marginBottom: 4,
    fontFamily: FONT_SANS,
  },
  pickerSubtitle: {
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'center',
    marginBottom: 14,
    fontFamily: FONT_SANS,
    lineHeight: 16,
  },
  pickerList: {
    flexGrow: 0,
  },
  pickerRowReset: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.rust + '12',
    marginBottom: 8,
  },
  pickerRowResetText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.rust,
    fontFamily: FONT_SANS,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 10,
  },
  pickerRowSelected: {
    backgroundColor: Colors.rust + '12',
  },
  pickerSwatch: {
    width: 10,
    height: 22,
    borderRadius: 2,
  },
  pickerRowText: {
    flex: 1,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: FONT_SANS,
  },
  pickerCheck: {
    fontSize: 14,
    color: Colors.rust,
    fontWeight: '700',
    fontFamily: FONT_SANS,
  },
  pickerCancel: {
    marginTop: 10,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  pickerCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.muted,
    fontFamily: FONT_SANS,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
});
