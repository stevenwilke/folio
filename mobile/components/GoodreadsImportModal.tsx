import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';

// ── CSV parsing (same logic as web) ──────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (line[i] === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += line[i];
    }
  }
  result.push(current.trim());
  return result;
}

function cleanIsbn(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9X]/gi, '');
  return cleaned.length >= 10 ? cleaned : null;
}

function mapShelf(shelf: string): string {
  if (shelf === 'read') return 'read';
  if (shelf === 'currently-reading') return 'reading';
  if (shelf === 'to-read') return 'want';
  return 'owned';
}

interface ParsedBook {
  title: string;
  author: string;
  isbn13: string | null;
  isbn10: string | null;
  rating: number | null;
  pages: number | null;
  year: number | null;
  status: string;
  review: string | null;
  format: string | null;
}

function parseGoodreadsCSV(text: string): ParsedBook[] {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return [];

  const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
  const idx = {
    title:  header.indexOf('title'),
    author: header.indexOf('author'),
    isbn:   header.indexOf('isbn'),
    isbn13: header.indexOf('isbn13'),
    rating: header.indexOf('my rating'),
    pages:  header.indexOf('number of pages'),
    year:   header.indexOf('original publication year'),
    shelf:  header.indexOf('exclusive shelf'),
    review: header.indexOf('my review'),
    binding: header.indexOf('binding'),
  };

  return lines.slice(1).map((line) => {
    const cols = parseCSVLine(line);
    return {
      title:  cols[idx.title]  || '',
      author: cols[idx.author] || '',
      isbn13: cleanIsbn(cols[idx.isbn13]),
      isbn10: cleanIsbn(cols[idx.isbn]),
      rating: parseInt(cols[idx.rating]) || null,
      pages:  parseInt(cols[idx.pages])  || null,
      year:   parseInt(cols[idx.year])   || null,
      status: mapShelf(cols[idx.shelf]   || ''),
      review: cols[idx.review]?.trim()   || null,
      format: cols[idx.binding]?.trim()  || null,
    };
  }).filter((b) => b.title);
}

// ── Cover fetching (OL first, Google Books fallback) ──────────────────────────

async function fetchCoverUrl(
  isbn13: string | null,
  isbn10: string | null,
  title: string,
  author: string
): Promise<string | null> {
  // 1. Open Library direct by ISBN
  for (const isbn of [isbn13, isbn10].filter(Boolean) as string[]) {
    try {
      const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
    } catch { /* skip */ }
  }

  // 2. Google Books fallback
  try {
    const isbn = isbn13 || isbn10;
    const q = isbn
      ? `isbn:${isbn}`
      : `intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}`;
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&fields=items(volumeInfo/imageLinks)&maxResults=1`
    );
    if (res.ok) {
      const data = await res.json();
      const links = data?.items?.[0]?.volumeInfo?.imageLinks;
      const raw = links?.large || links?.medium || links?.thumbnail;
      if (raw) {
        return raw
          .replace(/^http:/, 'https:')
          .replace(/&edge=curl/, '')
          .replace(/zoom=\d/, 'zoom=3');
      }
    }
  } catch { /* skip */ }

  return null;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Step = 'instructions' | 'preview' | 'importing' | 'done';

export default function GoodreadsImportModal({ visible, onClose, onImported }: Props) {
  const [step, setStep]         = useState<Step>('instructions');
  const [books, setBooks]       = useState<ParsedBook[]>([]);
  const [done, setDone]         = useState(0);
  const [total, setTotal]       = useState(0);

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === 'ios' ? 'public.comma-separated-values-text' : 'text/comma-separated-values,text/csv,text/plain',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const uri = result.assets[0].uri;
      const text = await FileSystem.readAsStringAsync(uri);
      const parsed = parseGoodreadsCSV(text);

      if (!parsed.length) {
        Alert.alert('No books found', 'Make sure this is a Goodreads library export CSV.');
        return;
      }

      setBooks(parsed);
      setStep('preview');
    } catch (e) {
      Alert.alert('Error', 'Could not read the file. Please try again.');
    }
  }

  async function startImport() {
    setStep('importing');
    setTotal(books.length);
    setDone(0);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { Alert.alert('Error', 'Not signed in.'); setStep('preview'); return; }

    for (let i = 0; i < books.length; i++) {
      const b = books[i];
      try {
        let bookId: string | null = null;

        // Find existing book
        if (b.isbn13) {
          const { data } = await supabase.from('books').select('id').eq('isbn_13', b.isbn13).maybeSingle();
          if (data) bookId = data.id;
        }
        if (!bookId && b.isbn10) {
          const { data } = await supabase.from('books').select('id').eq('isbn_10', b.isbn10).maybeSingle();
          if (data) bookId = data.id;
        }
        if (!bookId) {
          const { data } = await supabase.from('books').select('id')
            .eq('title', b.title).eq('author', b.author).maybeSingle();
          if (data) bookId = data.id;
        }

        // Insert new book
        if (!bookId) {
          const coverUrl = await fetchCoverUrl(b.isbn13, b.isbn10, b.title, b.author);
          const { data: newBook } = await supabase.from('books').insert({
            title: b.title, author: b.author,
            isbn_13: b.isbn13, isbn_10: b.isbn10,
            pages: b.pages, published_year: b.year,
            format: b.format,
            cover_image_url: coverUrl,
          }).select('id').single();
          if (newBook) bookId = newBook.id;
        }

        if (bookId) {
          await supabase.from('collection_entries').upsert({
            user_id:     user.id,
            book_id:     bookId,
            read_status: b.status,
            user_rating: b.rating || null,
            review_text: b.review || null,
          }, { onConflict: 'user_id,book_id' });
        }
      } catch { /* skip failed books */ }

      setDone(i + 1);
    }

    setStep('done');
  }

  function handleClose() {
    setStep('instructions');
    setBooks([]);
    setDone(0);
    setTotal(0);
    onClose();
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Import from Goodreads</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* ── Instructions ── */}
          {step === 'instructions' && (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              <View style={styles.stepRow}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
                <Text style={styles.stepText}>Open Goodreads → My Books → Import/Export → Export Library</Text>
              </View>
              <View style={styles.stepRow}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
                <Text style={styles.stepText}>Download the CSV file to your phone (Files app, email, etc.)</Text>
              </View>
              <View style={styles.stepRow}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>3</Text></View>
                <Text style={styles.stepText}>Tap below to choose the file and import your library</Text>
              </View>

              <TouchableOpacity style={styles.primaryBtn} onPress={pickFile} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Choose CSV File</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* ── Preview ── */}
          {step === 'preview' && (
            <View style={styles.body}>
              <Text style={styles.previewHeading}>
                Found <Text style={{ fontWeight: '700' }}>{books.length} books</Text> in your Goodreads library
              </Text>
              <ScrollView style={styles.previewList} showsVerticalScrollIndicator={false}>
                {books.slice(0, 8).map((b, i) => (
                  <View key={i} style={styles.previewRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewTitle} numberOfLines={1}>{b.title}</Text>
                      <Text style={styles.previewAuthor} numberOfLines={1}>{b.author}</Text>
                    </View>
                    <View style={[styles.statusBadge, STATUS_COLORS[b.status]]}>
                      <Text style={[styles.statusText, { color: STATUS_TEXT[b.status] }]}>
                        {STATUS_LABELS[b.status]}
                      </Text>
                    </View>
                  </View>
                ))}
                {books.length > 8 && (
                  <Text style={styles.moreBooks}>…and {books.length - 8} more books</Text>
                )}
              </ScrollView>
              <View style={styles.footer}>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setStep('instructions')}>
                  <Text style={styles.ghostBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtn} onPress={startImport} activeOpacity={0.85}>
                  <Text style={styles.primaryBtnText}>Import {books.length} Books</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Importing ── */}
          {step === 'importing' && (
            <View style={[styles.body, styles.centered]}>
              <Text style={styles.importingEmoji}>📚</Text>
              <Text style={styles.importingTitle}>
                Importing {done} of {total}…
              </Text>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
              </View>
              <Text style={styles.importingPct}>{pct}% complete</Text>
            </View>
          )}

          {/* ── Done ── */}
          {step === 'done' && (
            <View style={[styles.body, styles.centered]}>
              <Text style={styles.doneEmoji}>✅</Text>
              <Text style={styles.doneTitle}>Import Complete!</Text>
              <Text style={styles.doneSub}>{total} books imported to your library.</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={onImported} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>View My Library</Text>
              </TouchableOpacity>
            </View>
          )}

        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Status label/color helpers ────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  read:    'Read',
  reading: 'Reading',
  want:    'Want',
  owned:   'Owned',
};
const STATUS_COLORS: Record<string, object> = {
  read:    { backgroundColor: 'rgba(90,122,90,0.15)' },
  reading: { backgroundColor: 'rgba(192,82,30,0.12)' },
  want:    { backgroundColor: 'rgba(184,134,11,0.12)' },
  owned:   { backgroundColor: 'rgba(138,127,114,0.15)' },
};
const STATUS_TEXT: Record<string, string> = {
  read:    '#5a7a5a',
  reading: '#c0521e',
  want:    '#b8860b',
  owned:   '#8a7f72',
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(26,18,8,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0d8d0',
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 18,
    fontWeight: '700',
    color: '#2c1a0e',
  },
  closeBtn: {
    fontSize: 18,
    color: '#8a7f72',
  },
  body: {
    padding: 20,
  },
  centered: {
    alignItems: 'center',
    paddingVertical: 32,
  },

  // Instructions
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: '#5a4a3a',
    lineHeight: 20,
  },

  // Preview
  previewHeading: {
    fontSize: 14,
    color: '#5a4a3a',
    marginBottom: 12,
  },
  previewList: {
    maxHeight: 260,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0d8d0',
    borderRadius: 10,
    marginBottom: 16,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0d8d0',
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#2c1a0e',
  },
  previewAuthor: {
    fontSize: 11,
    color: '#8a7f72',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    flexShrink: 0,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  moreBooks: {
    textAlign: 'center',
    fontSize: 12,
    color: '#8a7f72',
    padding: 10,
  },

  // Importing
  importingEmoji: { fontSize: 40, marginBottom: 12 },
  importingTitle: { fontSize: 16, fontWeight: '600', color: '#2c1a0e', marginBottom: 4 },
  progressBg: {
    width: '100%',
    height: 8,
    backgroundColor: '#f0ece6',
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: 12,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.rust,
    borderRadius: 4,
  },
  importingPct: { fontSize: 12, color: '#8a7f72' },

  // Done
  doneEmoji:  { fontSize: 48, marginBottom: 12 },
  doneTitle:  { fontFamily: 'Georgia', fontSize: 20, fontWeight: '700', color: '#2c1a0e', marginBottom: 8 },
  doneSub:    { fontSize: 14, color: '#5a4a3a', marginBottom: 24 },

  // Buttons
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  primaryBtn: {
    backgroundColor: Colors.rust,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  ghostBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c8beb4',
    alignItems: 'center',
    marginTop: 8,
  },
  ghostBtnText: {
    color: '#5a4a3a',
    fontSize: 14,
  },
});
