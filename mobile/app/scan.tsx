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
const VISION_KEY = process.env.EXPO_PUBLIC_GOOGLE_VISION_KEY ?? '';

type ScanMode = 'barcode' | 'cover';
type ReadStatus = 'owned' | 'read' | 'reading' | 'want';

const STATUS_OPTIONS: { key: ReadStatus; label: string; color: string }[] = [
  { key: 'owned',   label: 'In Library',  color: Colors.sage },
  { key: 'read',    label: 'Read',         color: Colors.gold },
  { key: 'reading', label: 'Reading',      color: Colors.rust },
  { key: 'want',    label: 'Want to Read', color: '#7a5ea8' },
];

interface BookResult {
  title: string;
  author: string | null;
  isbn13: string | null;
  isbn10: string | null;
  coverUrl: string | null;
  year: number | null;
}

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<ScanMode>('barcode');

  // Barcode state
  const [scanned, setScanned]   = useState(false);
  const [scanning, setScanning] = useState(false);

  // Cover state
  const cameraRef = useRef<CameraView>(null);
  const [takingPhoto, setTakingPhoto]     = useState(false);
  const [coverResults, setCoverResults]   = useState<BookResult[]>([]);
  const [coverQuery, setCoverQuery]       = useState<string>('');

  // Shared
  const [book, setBook]         = useState<BookResult | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [addedAs, setAddedAs]   = useState<ReadStatus | null>(null);
  const [adding, setAdding]     = useState(false);

  // Animated scan line (barcode mode)
  const scanLine = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (mode !== 'barcode') return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [mode]);

  const scanLineY = scanLine.interpolate({
    inputRange: [0, 1],
    outputRange: [0, FRAME_SIZE - 4],
  });

  // ── Barcode handler ──
  async function handleBarcode({ data }: { type: string; data: string }) {
    if (scanned || scanning) return;
    const isIsbn = /^97[89]\d{10}$/.test(data) || /^\d{9}[\dX]$/.test(data) || /^\d{12,13}$/.test(data);
    if (!isIsbn) return;

    setScanned(true);
    setScanning(true);
    setError(null);
    setBook(null);
    setAddedAs(null);

    try {
      const res  = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${data}&format=json&jscmd=data`);
      const json = await res.json();
      const entry = json[`ISBN:${data}`];

      if (!entry) {
        const sr   = await fetch(`https://openlibrary.org/search.json?isbn=${data}&fields=key,title,author_name,isbn,cover_i,first_publish_year&limit=1`);
        const sj   = await sr.json();
        const doc  = sj.docs?.[0];
        if (!doc) { setError(`No book found for barcode:\n${data}`); setScanning(false); return; }
        setBook({
          title: doc.title,
          author: doc.author_name?.[0] ?? null,
          isbn13: doc.isbn?.find((i: string) => i.length === 13) ?? data,
          isbn10: doc.isbn?.find((i: string) => i.length === 10) ?? null,
          coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
          year: doc.first_publish_year ?? null,
        });
      } else {
        setBook({
          title: entry.title,
          author: entry.authors?.[0]?.name ?? null,
          isbn13: entry.identifiers?.isbn_13?.[0] ?? data,
          isbn10: entry.identifiers?.isbn_10?.[0] ?? null,
          coverUrl: entry.cover?.medium ?? entry.cover?.large ?? null,
          year: entry.publish_date ? parseInt(entry.publish_date.slice(-4)) : null,
        });
      }
    } catch {
      setError('Could not look up this book. Check your connection.');
    } finally {
      setScanning(false);
    }
  }

  // ── Cover photo handler ──
  async function handleTakePhoto() {
    if (!cameraRef.current || takingPhoto) return;
    if (!VISION_KEY) {
      setError('Google Vision API key not set.\nAdd EXPO_PUBLIC_GOOGLE_VISION_KEY to your .env file.');
      return;
    }
    setTakingPhoto(true);
    setError(null);
    setBook(null);
    setCoverResults([]);
    setAddedAs(null);

    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      if (!photo?.base64) throw new Error('Failed to capture photo.');

      // Send to Google Vision — request both text annotations (individual blocks with sizes)
      const visionRes = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image: { content: photo.base64 },
              features: [{ type: 'TEXT_DETECTION' }],
            }],
          }),
        }
      );

      // Parse safely — API may return a plain-text error if key is invalid
      const rawBody = await visionRes.text();
      let visionJson: any;
      try {
        visionJson = JSON.parse(rawBody);
      } catch {
        throw new Error(`Vision API error: ${rawBody.slice(0, 120)}`);
      }

      // Check for API-level errors
      const apiError = visionJson.error ?? visionJson.responses?.[0]?.error;
      if (apiError) throw new Error(`Vision API: ${apiError.message ?? JSON.stringify(apiError)}`);

      // textAnnotations[0] = full text; [1..] = individual words with bounding boxes
      const annotations: any[] = visionJson.responses?.[0]?.textAnnotations ?? [];
      const fullText: string   = annotations[0]?.description ?? '';

      if (!fullText.trim()) {
        setError('No text detected on the cover.\nTry better lighting or hold the camera steady.');
        setTakingPhoto(false);
        return;
      }

      // ── Smart title extraction ──
      // Calculate bounding box area for each word/phrase — larger = more prominent = likely title
      const sized = annotations.slice(1).map((ann: any) => {
        const v = ann.boundingPoly?.vertices ?? [];
        const w = Math.abs((v[1]?.x ?? 0) - (v[0]?.x ?? 0));
        const h = Math.abs((v[2]?.y ?? 0) - (v[0]?.y ?? 0));
        return { text: ann.description as string, area: w * h };
      });
      // Sort by size descending — the biggest text is almost always the title
      sized.sort((a, b) => b.area - a.area);

      // Build candidate queries from largest text blocks
      const bigWords    = sized.slice(0, 8).map(s => s.text).join(' ').trim();
      const lines       = fullText.split('\n').map((l: string) => l.trim()).filter(Boolean);
      const firstLine   = lines[0] ?? '';
      const twoLines    = lines.slice(0, 2).join(' ');
      const threeLines  = lines.slice(0, 3).join(' ');

      // Show the most likely query to the user
      setCoverQuery(bigWords || firstLine);

      // Helper: search Open Library with a query
      async function searchOL(q: string): Promise<BookResult[]> {
        if (!q.trim()) return [];
        const r = await fetch(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,isbn,cover_i,first_publish_year&limit=8`
        );
        const j = await r.json();
        return (j.docs ?? []).map((d: any) => ({
          title:    d.title,
          author:   d.author_name?.[0] ?? null,
          isbn13:   d.isbn?.find((i: string) => i.length === 13) ?? null,
          isbn10:   d.isbn?.find((i: string) => i.length === 10) ?? null,
          coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
          year:     d.first_publish_year ?? null,
        }));
      }

      // Try queries in order from most-specific to less-specific
      // Deduplicate by title
      const seen = new Set<string>();
      let docs: BookResult[] = [];

      const queries = [bigWords, firstLine, twoLines, threeLines].filter(
        (q, i, arr) => q && arr.indexOf(q) === i  // unique, non-empty
      );

      for (const q of queries) {
        if (docs.length >= 5) break;
        const results = await searchOL(q);
        for (const r of results) {
          const key = r.title.toLowerCase();
          if (!seen.has(key)) { seen.add(key); docs.push(r); }
          if (docs.length >= 8) break;
        }
      }

      if (!docs.length) {
        setError(`Detected: "${firstLine}"\n\nNo books found. Try holding steady with the title fully visible.`);
      } else {
        setCoverResults(docs);
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setTakingPhoto(false);
    }
  }

  // ── Add to library ──
  async function addToLibrary(b: BookResult, status: ReadStatus) {
    if (adding) return;
    setAdding(true);
    setBook(b);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const payload = { title: b.title, author: b.author, isbn_13: b.isbn13, isbn_10: b.isbn10, cover_image_url: b.coverUrl, published_year: b.year };
      let bookId: string;

      const { data: existing } = await supabase.from('books').select('id')
        .or(b.isbn13 ? `isbn_13.eq.${b.isbn13}` : `title.eq.${b.title}`).limit(1);

      if (existing?.length) {
        bookId = existing[0].id;
        await supabase.from('books').update(payload).eq('id', bookId);
      } else {
        const { data: nb, error: be } = await supabase.from('books').insert(payload).select('id').single();
        if (be) throw be;
        bookId = nb.id;
      }

      const { error: ee } = await supabase.from('collection_entries')
        .upsert({ user_id: user.id, book_id: bookId, read_status: status }, { onConflict: 'user_id,book_id' });
      if (ee) throw ee;

      setAddedAs(status);
      setCoverResults([]);
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
    setCoverResults([]);
    setCoverQuery('');
  }

  function switchMode(m: ScanMode) {
    setMode(m);
    resetScan();
  }

  // ── Permission not yet determined ──
  if (!permission) return <View style={styles.root}><ActivityIndicator color={Colors.rust} /></View>;

  // ── Permission denied ──
  if (!permission.granted) {
    return (
      <View style={[styles.root, { backgroundColor: Colors.background }]}>
        <View style={styles.permBox}>
          <Text style={styles.permIcon}>📷</Text>
          <Text style={styles.permTitle}>Camera Access Needed</Text>
          <Text style={styles.permSub}>Ex Libris needs camera access to scan book barcodes and covers.</Text>
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

  const showResult = scanning || takingPhoto || book || error || coverResults.length > 0;

  return (
    <View style={styles.root}>
      {/* Camera */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={mode === 'barcode' && !scanned ? handleBarcode : undefined}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }}
      />

      {/* Overlay */}
      {mode === 'barcode' && (
        <View style={styles.overlay}>
          <View style={styles.overlayTop} />
          <View style={styles.overlayMiddle}>
            <View style={styles.overlaySide} />
            <View style={styles.frame}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
              {!scanned && (
                <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineY }] }]} />
              )}
            </View>
            <View style={styles.overlaySide} />
          </View>
          <View style={styles.overlayBottom} />
        </View>
      )}

      {/* Cover mode dark vignette */}
      {mode === 'cover' && (
        <View style={styles.coverVignette} pointerEvents="none" />
      )}

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Scan a Book</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Mode toggle */}
      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'barcode' && styles.modeBtnActive]}
          onPress={() => switchMode('barcode')}
        >
          <Text style={[styles.modeBtnText, mode === 'barcode' && styles.modeBtnTextActive]}>
            Barcode
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'cover' && styles.modeBtnActive]}
          onPress={() => switchMode('cover')}
        >
          <Text style={[styles.modeBtnText, mode === 'cover' && styles.modeBtnTextActive]}>
            Cover
          </Text>
        </TouchableOpacity>
      </View>

      {/* Hints */}
      {!showResult && mode === 'barcode' && (
        <View style={styles.hintContainer}>
          <Text style={styles.hintText}>Point at the ISBN barcode on the back of the book</Text>
        </View>
      )}
      {!showResult && mode === 'cover' && (
        <View style={styles.hintContainer}>
          <Text style={styles.hintText}>Frame the front cover clearly, then tap the button</Text>
        </View>
      )}

      {/* Cover snap button */}
      {mode === 'cover' && !showResult && (
        <View style={styles.snapContainer}>
          <TouchableOpacity style={styles.snapBtn} onPress={handleTakePhoto} activeOpacity={0.85}>
            <View style={styles.snapInner} />
          </TouchableOpacity>
        </View>
      )}

      {/* Result sheet */}
      {showResult && (
        <View style={styles.resultSheet}>
          {(scanning || takingPhoto) && (
            <View style={styles.lookingUp}>
              <ActivityIndicator color={Colors.rust} />
              <Text style={styles.lookingUpText}>
                {takingPhoto ? 'Reading the cover…' : 'Looking up book…'}
              </Text>
            </View>
          )}

          {error && !scanning && !takingPhoto && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.scanAgainBtn} onPress={resetScan}>
                <Text style={styles.scanAgainText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Cover mode: multiple results to pick from */}
          {coverResults.length > 0 && !adding && !addedAs && (
            <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
              {coverQuery ? (
                <Text style={styles.detectedLabel}>Detected: "{coverQuery.slice(0, 60)}"</Text>
              ) : null}
              <Text style={styles.addLabel}>Which book is this?</Text>
              {coverResults.map((r, i) => (
                <View key={i} style={styles.coverResultCard}>
                  <View style={styles.coverResultLeft}>
                    {r.coverUrl
                      ? <Image source={{ uri: r.coverUrl }} style={styles.smallCover} resizeMode="cover" />
                      : <FakeCover title={r.title} author={r.author ?? ''} width={44} height={64} />
                    }
                  </View>
                  <View style={styles.coverResultMeta}>
                    <Text style={styles.coverResultTitle} numberOfLines={2}>{r.title}</Text>
                    {r.author && <Text style={styles.coverResultAuthor}>{r.author}</Text>}
                    {r.year   && <Text style={styles.coverResultYear}>{r.year}</Text>}
                  </View>
                  <View style={styles.coverResultActions}>
                    {STATUS_OPTIONS.map(opt => (
                      <TouchableOpacity
                        key={opt.key}
                        style={[styles.miniStatusBtn, { borderColor: opt.color }]}
                        onPress={() => addToLibrary(r, opt.key)}
                      >
                        <Text style={[styles.miniStatusText, { color: opt.color }]}>{opt.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
              <TouchableOpacity style={styles.scanAgainBtn} onPress={resetScan}>
                <Text style={styles.scanAgainText}>Scan Again</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* Barcode mode: single confirmed result */}
          {book && !coverResults.length && !scanning && !takingPhoto && (
            <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
              <View style={styles.bookRow}>
                <View style={styles.bookCover}>
                  {book.coverUrl
                    ? <Image source={{ uri: book.coverUrl }} style={styles.coverImg} resizeMode="cover" />
                    : <FakeCover title={book.title} author={book.author ?? ''} width={72} height={104} />
                  }
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
                    {adding
                      ? <ActivityIndicator color={Colors.rust} style={{ marginVertical: 8 }} />
                      : STATUS_OPTIONS.map(opt => (
                          <TouchableOpacity
                            key={opt.key}
                            style={[styles.statusBtn, { borderColor: opt.color }]}
                            onPress={() => addToLibrary(book, opt.key)}
                          >
                            <Text style={[styles.statusBtnText, { color: opt.color }]}>{opt.label}</Text>
                          </TouchableOpacity>
                        ))
                    }
                  </View>
                  <TouchableOpacity style={styles.scanAgainBtn} onPress={resetScan}>
                    <Text style={styles.scanAgainText}>Scan a Different Book</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          )}

          {/* Adding spinner overlay */}
          {adding && (
            <View style={styles.lookingUp}>
              <ActivityIndicator color={Colors.rust} />
              <Text style={styles.lookingUpText}>Adding to library…</Text>
            </View>
          )}

          {/* Added confirmation for cover mode */}
          {addedAs && !book && (
            <View style={styles.addedRow}>
              <Text style={styles.addedText}>
                ✓ Added as {STATUS_OPTIONS.find(s => s.key === addedAs)?.label}
              </Text>
              <TouchableOpacity style={styles.scanAgainBtn} onPress={resetScan}>
                <Text style={styles.scanAgainText}>Scan Another</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const OVERLAY_COLOR   = 'rgba(0,0,0,0.55)';
const CORNER_SIZE     = 24;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  // Barcode overlay
  overlay: { ...StyleSheet.absoluteFillObject },
  overlayTop:    { flex: 1, backgroundColor: OVERLAY_COLOR },
  overlayMiddle: { flexDirection: 'row', height: FRAME_SIZE },
  overlaySide:   { flex: 1, backgroundColor: OVERLAY_COLOR },
  overlayBottom: { flex: 1, backgroundColor: OVERLAY_COLOR },
  frame: { width: FRAME_SIZE, height: FRAME_SIZE, position: 'relative', overflow: 'hidden' },

  corner: { position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE, borderColor: Colors.rust },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
  scanLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: Colors.rust, opacity: 0.8 },

  // Cover vignette
  coverVignette: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 40,
    borderColor: 'rgba(0,0,0,0.45)',
  },

  // Top bar
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  backBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  topBarTitle: { color: '#fff', fontSize: 17, fontWeight: '700', fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },

  // Mode toggle
  modeToggle: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 86,
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    padding: 3,
  },
  modeBtn:           { paddingHorizontal: 20, paddingVertical: 7, borderRadius: 17 },
  modeBtnActive:     { backgroundColor: Colors.rust },
  modeBtnText:       { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  modeBtnTextActive: { color: '#fff' },

  // Hint
  hintContainer: { position: 'absolute', bottom: 220, left: 0, right: 0, alignItems: 'center' },
  hintText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  // Cover snap button
  snapContainer: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
  snapBtn:   { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  snapInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },

  // Result sheet
  resultSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '60%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 12,
  },
  lookingUp:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  lookingUpText: { fontSize: 15, color: Colors.ink, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  errorBox:      { alignItems: 'center', paddingVertical: 8, gap: 12 },
  errorText:     { fontSize: 13, color: Colors.rust, textAlign: 'center', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }), lineHeight: 19 },

  detectedLabel: { fontSize: 11, color: Colors.muted, marginBottom: 4, fontStyle: 'italic', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  addLabel:      { fontSize: 13, fontWeight: '600', color: Colors.ink, marginBottom: 10, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  // Cover results list
  coverResultCard: { flexDirection: 'row', gap: 10, backgroundColor: Colors.background, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, padding: 10, marginBottom: 8 },
  coverResultLeft: { flexShrink: 0 },
  smallCover:      { width: 44, height: 64, borderRadius: 3 },
  coverResultMeta: { flex: 1, gap: 2 },
  coverResultTitle:  { fontSize: 13, fontWeight: '700', color: Colors.ink, lineHeight: 17, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  coverResultAuthor: { fontSize: 11, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  coverResultYear:   { fontSize: 11, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  coverResultActions: { gap: 4, justifyContent: 'center' },
  miniStatusBtn:   { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1, backgroundColor: Colors.card },
  miniStatusText:  { fontSize: 10, fontWeight: '600', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  // Barcode single result
  bookRow:    { flexDirection: 'row', gap: 14, marginBottom: 16 },
  bookCover:  { flexShrink: 0 },
  coverImg:   { width: 72, height: 104, borderRadius: 4 },
  bookMeta:   { flex: 1, gap: 3 },
  bookTitle:  { fontSize: 16, fontWeight: '700', color: Colors.ink, lineHeight: 21, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  bookAuthor: { fontSize: 13, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  bookYear:   { fontSize: 12, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  bookIsbn:   { fontSize: 11, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  statusButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  statusBtn:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1.5, backgroundColor: Colors.background },
  statusBtnText: { fontSize: 13, fontWeight: '600', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  addedRow:  { alignItems: 'center', gap: 12, paddingVertical: 4 },
  addedText: { fontSize: 15, fontWeight: '700', color: Colors.sage, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  scanAgainBtn:  { alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, marginTop: 4 },
  scanAgainText: { fontSize: 14, color: Colors.ink, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },

  // Permission screen
  permBox:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  permIcon:     { fontSize: 56, marginBottom: 16 },
  permTitle:    { fontSize: 22, fontWeight: '700', color: Colors.ink, textAlign: 'center', marginBottom: 8, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  permSub:      { fontSize: 15, color: Colors.muted, textAlign: 'center', lineHeight: 22, marginBottom: 28, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  primaryBtn:   { backgroundColor: Colors.rust, borderRadius: 10, paddingHorizontal: 32, paddingVertical: 14, marginBottom: 12 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  ghostBtn:     { paddingHorizontal: 24, paddingVertical: 10 },
  ghostBtnText: { fontSize: 15, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
});
