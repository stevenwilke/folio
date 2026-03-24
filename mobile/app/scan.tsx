import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
  Platform,
  Animated,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
import { FakeCover } from '../components/FakeCover';

const { width: SCREEN_W } = Dimensions.get('window');
const FRAME_SIZE = SCREEN_W * 0.7;

type ReadStatus = 'owned' | 'read' | 'reading' | 'want';
const STATUS_OPTIONS: { key: ReadStatus; label: string; color: string }[] = [
  { key: 'owned',   label: 'In Library', color: Colors.sage },
  { key: 'read',    label: 'Read',        color: Colors.gold },
  { key: 'reading', label: 'Reading',     color: Colors.rust },
  { key: 'want',    label: 'Want to Read',color: '#7a5ea8' },
];

interface BookResult {
  title: string;
  author: string | null;
  isbn13: string | null;
  isbn10: string | null;
  coverUrl: string | null;
  year: number | null;
  subjects: string[];
}

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [book, setBook] = useState<BookResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addedAs, setAddedAs] = useState<ReadStatus | null>(null);
  const [adding, setAdding] = useState(false);

  // Animated scan line
  const scanLine = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const scanLineY = scanLine.interpolate({
    inputRange: [0, 1],
    outputRange: [0, FRAME_SIZE - 4],
  });

  async function handleBarcode({ data }: { type: string; data: string }) {
    if (scanned || scanning) return;
    // Only handle ISBN-style barcodes (EAN-13 starting with 978/979, or EAN-8/UPC)
    const isIsbn = /^97[89]\d{10}$/.test(data) || /^\d{9}[\dX]$/.test(data) || /^\d{8}$/.test(data) || /^\d{12,13}$/.test(data);
    if (!isIsbn) return;

    setScanned(true);
    setScanning(true);
    setError(null);
    setBook(null);
    setAddedAs(null);

    try {
      // Open Library Books API by ISBN
      const res = await fetch(
        `https://openlibrary.org/api/books?bibkeys=ISBN:${data}&format=json&jscmd=data`
      );
      const json = await res.json();
      const key = `ISBN:${data}`;
      const entry = json[key];

      if (!entry) {
        // Fallback: try search API
        const searchRes = await fetch(
          `https://openlibrary.org/search.json?isbn=${data}&fields=key,title,author_name,isbn,cover_i,first_publish_year,subject&limit=1`
        );
        const searchJson = await searchRes.json();
        const doc = searchJson.docs?.[0];
        if (!doc) {
          setError(`No book found for barcode:\n${data}`);
          setScanning(false);
          return;
        }
        setBook({
          title: doc.title,
          author: doc.author_name?.[0] ?? null,
          isbn13: doc.isbn?.find((i: string) => i.length === 13) ?? data,
          isbn10: doc.isbn?.find((i: string) => i.length === 10) ?? null,
          coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
          year: doc.first_publish_year ?? null,
          subjects: (doc.subject ?? []).slice(0, 5),
        });
      } else {
        const author = entry.authors?.[0]?.name ?? null;
        const isbn13 = entry.identifiers?.isbn_13?.[0] ?? data;
        const isbn10 = entry.identifiers?.isbn_10?.[0] ?? null;
        const coverId = entry.cover?.medium ?? entry.cover?.large ?? entry.cover?.small ?? null;
        setBook({
          title: entry.title,
          author,
          isbn13,
          isbn10,
          coverUrl: coverId ?? null,
          year: entry.publish_date ? parseInt(entry.publish_date.slice(-4)) : null,
          subjects: (entry.subjects ?? []).slice(0, 5).map((s: any) => typeof s === 'string' ? s : s.name),
        });
      }
    } catch {
      setError('Could not look up this book. Check your connection.');
    } finally {
      setScanning(false);
    }
  }

  async function addToLibrary(status: ReadStatus) {
    if (!book || adding) return;
    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const bookPayload = {
        title: book.title,
        author: book.author,
        isbn_13: book.isbn13,
        isbn_10: book.isbn10,
        cover_image_url: book.coverUrl,
        published_year: book.year,
      };

      let bookId: string;
      const { data: existing } = await supabase
        .from('books').select('id')
        .or(book.isbn13
          ? `isbn_13.eq.${book.isbn13}`
          : `title.eq.${book.title}`)
        .limit(1);

      if (existing && existing.length > 0) {
        bookId = existing[0].id;
        await supabase.from('books').update(bookPayload).eq('id', bookId);
      } else {
        const { data: newBook, error: bookErr } = await supabase
          .from('books').insert(bookPayload).select('id').single();
        if (bookErr) throw bookErr;
        bookId = newBook.id;
      }

      const { error: entryErr } = await supabase
        .from('collection_entries')
        .upsert({ user_id: user.id, book_id: bookId, read_status: status }, { onConflict: 'user_id,book_id' });
      if (entryErr) throw entryErr;

      setAddedAs(status);
    } catch (err: any) {
      setError(err.message ?? 'Could not add book.');
    } finally {
      setAdding(false);
    }
  }

  function resetScan() {
    setScanned(false);
    setBook(null);
    setError(null);
    setAddedAs(null);
  }

  // ── Permission not yet determined ──
  if (!permission) {
    return <View style={styles.root}><ActivityIndicator color={Colors.rust} /></View>;
  }

  // ── Permission denied ──
  if (!permission.granted) {
    return (
      <View style={styles.root}>
        <View style={styles.permBox}>
          <Text style={styles.permIcon}>📷</Text>
          <Text style={styles.permTitle}>Camera Access Needed</Text>
          <Text style={styles.permSub}>
            Folio needs camera access to scan book barcodes (ISBN).
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghostBtn} onPress={() => router.back()}>
            <Text style={styles.ghostBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Camera */}
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarcode}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }}
      />

      {/* Dark overlay with cutout frame */}
      <View style={styles.overlay}>
        <View style={styles.overlayTop} />
        <View style={styles.overlayMiddle}>
          <View style={styles.overlaySide} />
          {/* Scan frame */}
          <View style={styles.frame}>
            {/* Corner markers */}
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
            {/* Animated scan line */}
            {!scanned && (
              <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineY }] }]} />
            )}
          </View>
          <View style={styles.overlaySide} />
        </View>
        <View style={styles.overlayBottom} />
      </View>

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Scan a Book</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Hint text */}
      {!scanned && (
        <View style={styles.hintContainer}>
          <Text style={styles.hintText}>Point at the barcode on the back of a book</Text>
        </View>
      )}

      {/* Result card */}
      {(scanning || book || error) && (
        <View style={styles.resultSheet}>
          {scanning && (
            <View style={styles.lookingUp}>
              <ActivityIndicator color={Colors.rust} />
              <Text style={styles.lookingUpText}>Looking up book…</Text>
            </View>
          )}

          {error && !scanning && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.scanAgainBtn} onPress={resetScan}>
                <Text style={styles.scanAgainText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}

          {book && !scanning && (
            <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
              <View style={styles.bookRow}>
                <View style={styles.bookCover}>
                  {book.coverUrl ? (
                    <Image source={{ uri: book.coverUrl }} style={styles.coverImg} resizeMode="cover" />
                  ) : (
                    <FakeCover title={book.title} author={book.author ?? ''} width={72} height={104} />
                  )}
                </View>
                <View style={styles.bookMeta}>
                  <Text style={styles.bookTitle} numberOfLines={3}>{book.title}</Text>
                  {book.author && <Text style={styles.bookAuthor}>{book.author}</Text>}
                  {book.year   && <Text style={styles.bookYear}>{book.year}</Text>}
                  {book.isbn13 && <Text style={styles.bookIsbn}>ISBN {book.isbn13}</Text>}
                </View>
              </View>

              {addedAs ? (
                <View style={styles.addedRow}>
                  <Text style={styles.addedText}>
                    ✓ Added as {STATUS_OPTIONS.find(s => s.key === addedAs)?.label}
                  </Text>
                  <TouchableOpacity style={styles.scanAgainBtn} onPress={resetScan}>
                    <Text style={styles.scanAgainText}>Scan Another</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.addLabel}>Add to your library as:</Text>
                  <View style={styles.statusButtons}>
                    {adding ? (
                      <ActivityIndicator color={Colors.rust} style={{ marginVertical: 8 }} />
                    ) : (
                      STATUS_OPTIONS.map(opt => (
                        <TouchableOpacity
                          key={opt.key}
                          style={[styles.statusBtn, { borderColor: opt.color }]}
                          onPress={() => addToLibrary(opt.key)}
                        >
                          <Text style={[styles.statusBtnText, { color: opt.color }]}>{opt.label}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                  <TouchableOpacity style={styles.scanAgainBtn} onPress={resetScan}>
                    <Text style={styles.scanAgainText}>Scan a Different Book</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const OVERLAY_COLOR = 'rgba(0,0,0,0.55)';
const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  // Overlay
  overlay: { ...StyleSheet.absoluteFillObject },
  overlayTop: { flex: 1, backgroundColor: OVERLAY_COLOR },
  overlayMiddle: { flexDirection: 'row', height: FRAME_SIZE },
  overlaySide: { flex: 1, backgroundColor: OVERLAY_COLOR },
  overlayBottom: { flex: 1, backgroundColor: OVERLAY_COLOR },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    position: 'relative',
    overflow: 'hidden',
  },

  // Corner markers
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: Colors.rust,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },

  // Scan line
  scanLine: {
    position: 'absolute',
    left: 0, right: 0,
    height: 2,
    backgroundColor: Colors.rust,
    opacity: 0.8,
  },

  // Top bar
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40, height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  topBarTitle: {
    color: '#fff', fontSize: 17, fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },

  // Hint
  hintContainer: {
    position: 'absolute',
    bottom: 220,
    left: 0, right: 0,
    alignItems: 'center',
  },
  hintText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },

  // Result sheet
  resultSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '55%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 12,
  },
  lookingUp: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  lookingUpText: { fontSize: 15, color: Colors.ink, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  errorBox: { alignItems: 'center', paddingVertical: 8, gap: 12 },
  errorText: { fontSize: 14, color: '#c0521e', textAlign: 'center', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  // Book result
  bookRow: { flexDirection: 'row', gap: 14, marginBottom: 16 },
  bookCover: { flexShrink: 0 },
  coverImg: { width: 72, height: 104, borderRadius: 4 },
  bookMeta: { flex: 1, gap: 3 },
  bookTitle: {
    fontSize: 16, fontWeight: '700', color: Colors.ink, lineHeight: 21,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  bookAuthor: { fontSize: 13, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  bookYear:   { fontSize: 12, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  bookIsbn:   { fontSize: 11, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  addLabel: {
    fontSize: 13, fontWeight: '600', color: Colors.ink, marginBottom: 8,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  statusButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  statusBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1.5,
    backgroundColor: Colors.background,
  },
  statusBtnText: {
    fontSize: 13, fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  addedRow: { alignItems: 'center', gap: 12, paddingVertical: 4 },
  addedText: {
    fontSize: 15, fontWeight: '700', color: Colors.sage,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  scanAgainBtn: {
    alignSelf: 'center',
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
    marginTop: 4,
  },
  scanAgainText: {
    fontSize: 14, color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // Permission screen
  permBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 32, backgroundColor: Colors.background,
  },
  permIcon: { fontSize: 56, marginBottom: 16 },
  permTitle: {
    fontSize: 22, fontWeight: '700', color: Colors.ink, textAlign: 'center', marginBottom: 8,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  permSub: {
    fontSize: 15, color: Colors.muted, textAlign: 'center', lineHeight: 22, marginBottom: 28,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  primaryBtn: {
    backgroundColor: Colors.rust, borderRadius: 10,
    paddingHorizontal: 32, paddingVertical: 14, marginBottom: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  ghostBtn: {
    paddingHorizontal: 24, paddingVertical: 10,
  },
  ghostBtnText: { fontSize: 15, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
});
