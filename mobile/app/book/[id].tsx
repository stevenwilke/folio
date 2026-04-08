import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
  useWindowDimensions,
  RefreshControl,
  TextInput,
  Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/colors';
import { FakeCover } from '../../components/FakeCover';
import { ReadStatus } from '../../components/BookCard';

interface Book {
  id: string;
  title: string;
  author: string | null;
  cover_image_url: string | null;
  published_year: number | null;
  genre: string | null;
  description: string | null;
  isbn_13: string | null;
  isbn_10: string | null;
  series_name?: string | null;
  series_number?: number | null;
}

interface CollectionEntry {
  id: string;
  read_status: ReadStatus;
  user_rating: number | null;
  review_text: string | null;
  current_page: number | null;
}

const STATUS_OPTIONS: { key: ReadStatus; label: string }[] = [
  { key: 'owned', label: 'In Library' },
  { key: 'read', label: 'Read' },
  { key: 'reading', label: 'Reading' },
  { key: 'want', label: 'Want to Read' },
];

function MobileFriendStats({ stats }: { stats: any[] | null }) {
  if (stats === null) return <Text style={mfs.muted}>Checking friends…</Text>;
  if (!stats.length) return <Text style={mfs.muted}>👥 No friends have read this yet</Text>;
  const withRating = stats.filter((s: any) => s.user_rating);
  const avg = withRating.length
    ? (withRating.reduce((sum: number, s: any) => sum + s.user_rating, 0) / withRating.length).toFixed(1) : null;
  const names = stats.map((s: any) => s.profiles?.username).filter(Boolean);
  const display = names.length === 1 ? names[0]
    : names.length === 2 ? `${names[0]} and ${names[1]}`
    : `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 > 1 ? 's' : ''}`;
  return (
    <View style={mfs.row}>
      <Text style={mfs.base}>👥 <Text style={mfs.bold}>{display}</Text> {stats.length === 1 ? 'has' : 'have'} read this</Text>
      {avg ? <Text style={mfs.avg}> · avg ★{avg}</Text> : null}
    </View>
  );
}
const mfs = StyleSheet.create({
  row:  { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 6 },
  base: { fontSize: 12, color: '#3a3028', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  bold: { fontWeight: '700' },
  avg:  { fontSize: 12, color: '#b8860b', fontWeight: '600', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  muted:{ fontSize: 12, color: '#8a7f72', fontStyle: 'italic', marginTop: 6, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
});

function formatJournalDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const [book, setBook] = useState<Book | null>(null);
  const [entry, setEntry] = useState<CollectionEntry | null>(null);
  const [communityRating, setCommunityRating] = useState<number | null>(null);
  const [friendStats, setFriendStats] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewText, setReviewText] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);

  // Cover upload
  const [coverUploading, setCoverUploading] = useState(false);

  // Feature 1: Reading Journal
  const [journalEntries, setJournalEntries] = useState<{id: string, content: string, created_at: string}[]>([]);
  const [newJournalEntry, setNewJournalEntry] = useState('');
  const [savingJournal, setSavingJournal] = useState(false);

  // Feature 2: Series Tracking
  const [seriesBooks, setSeriesBooks] = useState<any[]>([]);
  const [seriesOwned, setSeriesOwned] = useState<Record<string, string>>({});

  const coverWidth = Math.min(width * 0.4, 180);
  const coverHeight = Math.round(coverWidth * 1.5);

  async function fetchJournal(bookId: string, userId: string) {
    const { data } = await supabase
      .from('journal_entries')
      .select('id, content, created_at')
      .eq('user_id', userId)
      .eq('book_id', bookId)
      .order('created_at', { ascending: false });
    setJournalEntries(data || []);
  }

  async function handleCoverUpload() {
    if (!book) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    setCoverUploading(true);
    try {
      const asset = result.assets[0];
      const ext   = asset.mimeType?.includes('png') ? 'png' : 'jpg';
      const path  = `${book.id}.${ext}`;
      const bytes = Uint8Array.from(atob(asset.base64!), c => c.charCodeAt(0));
      const { error } = await supabase.storage
        .from('book-covers')
        .upload(path, bytes, { contentType: asset.mimeType || 'image/jpeg', upsert: true });
      if (!error) {
        const { data } = supabase.storage.from('book-covers').getPublicUrl(path);
        await supabase.from('books').update({ cover_image_url: data.publicUrl }).eq('id', book.id);
        setBook(prev => prev ? { ...prev, cover_image_url: data.publicUrl } : prev);
      }
    } catch { /* silent */ }
    setCoverUploading(false);
  }

  async function fetchSeries(book: Book, userId: string | null) {
    if (!book.series_name) return;
    const { data: series } = await supabase
      .from('books')
      .select('id, title, series_number, cover_image_url, isbn_13, isbn_10')
      .eq('series_name', book.series_name)
      .order('series_number', { ascending: true });

    setSeriesBooks(series || []);

    if (series?.length && userId) {
      const { data: owned } = await supabase
        .from('collection_entries')
        .select('book_id, read_status')
        .eq('user_id', userId)
        .in('book_id', series.map((b: any) => b.id));
      const map: Record<string, string> = {};
      owned?.forEach((o: any) => { map[o.book_id] = o.read_status; });
      setSeriesOwned(map);
    }
  }

  async function fetchBook() {
    if (!id) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: bookData }, { data: entryData }, { data: ratingsData }] =
      await Promise.all([
        supabase.from('books').select('*').eq('id', id).single(),
        supabase
          .from('collection_entries')
          .select('id, read_status, user_rating, review_text, current_page')
          .eq('book_id', id)
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('collection_entries')
          .select('user_rating')
          .eq('book_id', id)
          .not('user_rating', 'is', null),
      ]);

    if (bookData) setBook(bookData);
    if (entryData) setEntry(entryData);
    if (entryData?.review_text) setReviewText(entryData.review_text);
    if (entryData?.current_page) setCurrentPage(entryData.current_page);

    // Friend stats
    setFriendStats(null);
    const { data: fs } = await supabase.from('friendships').select('requester_id, addressee_id')
      .eq('status', 'accepted').or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
    const friendIds = (fs || []).map((f: any) => f.requester_id === user.id ? f.addressee_id : f.requester_id);
    if (friendIds.length) {
      const { data: friendEntries } = await supabase.from('collection_entries')
        .select('user_rating, profiles(username)').eq('book_id', id).in('user_id', friendIds);
      setFriendStats(friendEntries || []);
    } else {
      setFriendStats([]);
    }

    if (ratingsData && ratingsData.length > 0) {
      const sum = ratingsData.reduce(
        (acc: number, r: { user_rating: number }) => acc + r.user_rating,
        0
      );
      setCommunityRating(Math.round((sum / ratingsData.length) * 10) / 10);
    } else {
      setCommunityRating(null);
    }

    // Fetch journal entries
    await fetchJournal(id, user.id);

    // Fetch series books if applicable
    if (bookData?.series_name) {
      await fetchSeries(bookData, user.id);
    }
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchBook().finally(() => setLoading(false));
    }, [id])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchBook();
    setRefreshing(false);
  }

  async function setStatus(status: ReadStatus) {
    if (!book) return;
    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (entry) {
        // Update existing entry
        const { data, error } = await supabase
          .from('collection_entries')
          .update({ read_status: status })
          .eq('id', entry.id)
          .select('id, read_status, user_rating, review_text, current_page')
          .single();
        if (error) throw error;
        setEntry(data);
      } else {
        // Insert new entry
        const { data, error } = await supabase
          .from('collection_entries')
          .insert({
            user_id: user.id,
            book_id: book.id,
            read_status: status,
          })
          .select('id, read_status, user_rating, review_text, current_page')
          .single();
        if (error) throw error;
        setEntry(data);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not save status.');
    } finally {
      setSaving(false);
    }
  }

  async function setRating(rating: number) {
    if (!book) return;
    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (entry) {
        const { data, error } = await supabase
          .from('collection_entries')
          .update({ user_rating: rating })
          .eq('id', entry.id)
          .select('id, read_status, user_rating, review_text, current_page')
          .single();
        if (error) throw error;
        setEntry(data);
      } else {
        const { data, error } = await supabase
          .from('collection_entries')
          .insert({
            user_id: user.id,
            book_id: book.id,
            read_status: 'owned',
            user_rating: rating,
          })
          .select('id, read_status, user_rating, review_text, current_page')
          .single();
        if (error) throw error;
        setEntry(data);
      }

      // Re-fetch community rating
      const { data: ratingsData } = await supabase
        .from('collection_entries')
        .select('user_rating')
        .eq('book_id', book.id)
        .not('user_rating', 'is', null);

      if (ratingsData && ratingsData.length > 0) {
        const sum = ratingsData.reduce(
          (acc: number, r: { user_rating: number }) => acc + r.user_rating,
          0
        );
        setCommunityRating(Math.round((sum / ratingsData.length) * 10) / 10);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not save rating.');
    } finally {
      setSaving(false);
    }
  }

  async function saveReview() {
    if (!entry) return;
    setSavingReview(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      await supabase.from('collection_entries')
        .update({ review_text: reviewText.trim() || null })
        .eq('id', entry.id);
      setReviewSaved(true);
      setTimeout(() => setReviewSaved(false), 3000);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not save review.');
    } finally {
      setSavingReview(false);
    }
  }

  async function saveProgress(pageStr: string) {
    const page = Math.max(0, parseInt(pageStr) || 0);
    setCurrentPage(page);
    if (!entry) return;

    const totalPages = (book as any)?.pages;
    if (totalPages && page >= totalPages) {
      // Auto-mark as finished when page count reaches total pages
      const { data } = await supabase.from('collection_entries')
        .update({ current_page: totalPages, read_status: 'read' })
        .eq('id', entry.id)
        .select('id, read_status, user_rating, review_text, current_page')
        .single();
      if (data) setEntry(data);
      setCurrentPage(totalPages);
    } else {
      await supabase.from('collection_entries')
        .update({ current_page: page > 0 ? page : null })
        .eq('id', entry.id);
    }
  }

  async function markAsFinished() {
    if (!entry || !book) return;
    setSaving(true);
    try {
      const totalPages = (book as any)?.pages;
      const updateData: any = { read_status: 'read' };
      if (totalPages) updateData.current_page = totalPages;

      const { data, error } = await supabase.from('collection_entries')
        .update(updateData)
        .eq('id', entry.id)
        .select('id, read_status, user_rating, review_text, current_page')
        .single();
      if (error) throw error;
      if (data) {
        setEntry(data);
        if (totalPages) setCurrentPage(totalPages);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not mark as finished.');
    } finally {
      setSaving(false);
    }
  }

  async function removeFromCollection() {
    if (!entry || !book) return;
    Alert.alert(
      'Remove book?',
      `Remove "${book.title}" from your collection?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            await supabase
              .from('collection_entries')
              .delete()
              .eq('id', entry.id)
              .eq('user_id', user.id);
            router.back();
          },
        },
      ]
    );
  }

  async function saveJournalEntry() {
    if (!newJournalEntry.trim()) return;
    if (!id) return;
    setSavingJournal(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('journal_entries').insert({
        user_id: user.id,
        book_id: id,
        content: newJournalEntry.trim(),
      });
      if (error) throw error;
      setNewJournalEntry('');
      await fetchJournal(id, user.id);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not save journal entry.');
    } finally {
      setSavingJournal(false);
    }
  }

  async function deleteJournalEntry(entryId: string) {
    Alert.alert(
      'Delete entry?',
      'This journal entry will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            await supabase.from('journal_entries').delete().eq('id', entryId);
            await fetchJournal(id!, user.id);
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  if (!book) {
    return (
      <View style={styles.loader}>
        <Text style={styles.errorText}>Book not found.</Text>
      </View>
    );
  }

  const currentStatus = entry?.read_status ?? null;
  const currentRating = entry?.user_rating ?? 0;

  // Series progress stats
  const totalInSeries = seriesBooks.length;
  const readCount = seriesBooks.filter((b: any) => seriesOwned[b.id] === 'read').length;
  const progressPct = totalInSeries > 0 ? Math.round((readCount / totalInSeries) * 100) : 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: book.title,
          headerStyle: { backgroundColor: Colors.background },
          headerTitleStyle: {
            fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
            fontWeight: '700',
            color: Colors.ink,
            fontSize: 16,
          },
          headerTintColor: Colors.rust,
          headerShadowVisible: false,
        }}
      />

      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rust} />
        }
      >
        {/* Cover + title section */}
        <View style={styles.heroSection}>
          <View style={[styles.coverContainer, { position: 'relative' }]}>
            {book.cover_image_url ? (
              <Image
                source={{ uri: book.cover_image_url }}
                style={[styles.coverImage, { width: coverWidth, height: coverHeight }]}
                resizeMode="cover"
              />
            ) : (
              <FakeCover
                title={book.title}
                author={book.author}
                width={coverWidth}
                height={coverHeight}
              />
            )}
            {/* Upload cover button */}
            <TouchableOpacity
              onPress={handleCoverUpload}
              disabled={coverUploading}
              style={[coverUploadBtnStyle, { bottom: 6, right: 6 }]}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 14 }}>{coverUploading ? '⏳' : '📷'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heroInfo}>
            <Text style={styles.bookTitle}>{book.title}</Text>
            {book.author ? (
              <TouchableOpacity
                onPress={() => router.push(`/author/${encodeURIComponent(book.author!)}` as any)}
                activeOpacity={0.7}
              >
                <Text style={[styles.bookAuthor, styles.bookAuthorLink]}>{book.author}</Text>
              </TouchableOpacity>
            ) : null}
            {book.published_year ? (
              <Text style={styles.bookMeta}>{book.published_year}</Text>
            ) : null}
            {book.genre ? (
              <Text style={styles.bookMeta}>{book.genre}</Text>
            ) : null}

            {/* Community rating */}
            {communityRating !== null ? (
              <View style={styles.communityRating}>
                <Text style={styles.communityRatingStars}>
                  {'★'.repeat(Math.round(communityRating))}
                  {'☆'.repeat(5 - Math.round(communityRating))}
                </Text>
                <Text style={styles.communityRatingValue}>
                  {communityRating}/5 community
                </Text>
              </View>
            ) : null}

            {/* Friend stats */}
            <MobileFriendStats stats={friendStats} />
          </View>
        </View>

        {/* Status buttons */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your Status</Text>
          <View style={styles.statusButtons}>
            {STATUS_OPTIONS.map((opt) => {
              const isActive = currentStatus === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.statusBtn,
                    isActive && {
                      backgroundColor: Colors.status[opt.key],
                      borderColor: Colors.status[opt.key],
                    },
                  ]}
                  onPress={() => setStatus(opt.key)}
                  disabled={saving}
                >
                  <Text
                    style={[
                      styles.statusBtnText,
                      isActive && styles.statusBtnTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Star rating */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your Rating</Text>
          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity
                key={star}
                onPress={() => setRating(star)}
                disabled={saving}
                style={styles.starBtn}
              >
                <Text
                  style={[
                    styles.star,
                    star <= currentRating ? styles.starFilled : styles.starEmpty,
                  ]}
                >
                  {star <= currentRating ? '★' : '☆'}
                </Text>
              </TouchableOpacity>
            ))}
            {currentRating > 0 && (
              <Text style={styles.ratingLabel}>{currentRating}/5</Text>
            )}
          </View>
        </View>

        {/* Review text */}
        {entry && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Your Review</Text>
            <TextInput
              style={[styles.reviewInput]}
              value={reviewText}
              onChangeText={setReviewText}
              placeholder="What did you think of this book? (optional)"
              placeholderTextColor={Colors.muted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.saveReviewBtn, savingReview && { opacity: 0.6 }]}
              onPress={saveReview}
              disabled={savingReview}
            >
              {savingReview
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.saveReviewBtnText}>{reviewSaved ? '✓ Saved!' : 'Save Review'}</Text>
              }
            </TouchableOpacity>
          </View>
        )}

        {/* Reading Journal — only shown when book is in collection */}
        {entry && (
          <View style={styles.journalCard}>
            <View style={styles.journalHeader}>
              <Text style={styles.journalTitle}>Reading Journal</Text>
              <View style={styles.privateBadge}>
                <Text style={styles.privateBadgeText}>Private</Text>
              </View>
            </View>

            <TextInput
              style={styles.journalInput}
              value={newJournalEntry}
              onChangeText={setNewJournalEntry}
              placeholder="Write a dated note about your reading…"
              placeholderTextColor={Colors.muted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.saveJournalBtn, savingJournal && { opacity: 0.6 }]}
              onPress={saveJournalEntry}
              disabled={savingJournal}
            >
              {savingJournal
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.saveJournalBtnText}>Save Entry</Text>
              }
            </TouchableOpacity>

            {journalEntries.length > 0 && (
              <View style={styles.journalEntriesList}>
                {journalEntries.map((je) => (
                  <View key={je.id} style={styles.journalEntry}>
                    <View style={styles.journalEntryTopRow}>
                      <Text style={styles.journalEntryDate}>{formatJournalDate(je.created_at)}</Text>
                      <TouchableOpacity
                        style={styles.journalDeleteBtn}
                        onPress={() => deleteJournalEntry(je.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.journalDeleteBtnText}>×</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.journalEntryText}>{je.content}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Reading progress — only shown when currently reading + book has page count */}
        {entry?.read_status === 'reading' && (book as any).pages ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Reading Progress</Text>
            <View style={styles.progressRow}>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, {
                  width: `${Math.min(100, Math.round((currentPage / ((book as any).pages)) * 100))}%` as any
                }]} />
              </View>
              <Text style={styles.progressPct}>
                {currentPage > 0
                  ? `${Math.min(100, Math.round((currentPage / ((book as any).pages)) * 100))}%`
                  : '0%'}
              </Text>
            </View>
            <View style={styles.pageInputRow}>
              <TextInput
                style={styles.pageInput}
                value={currentPage > 0 ? String(currentPage) : ''}
                onChangeText={saveProgress}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={Colors.muted}
              />
              <Text style={styles.pageOf}>of {(book as any).pages} pages</Text>
            </View>
          </View>
        ) : null}

        {/* Mark as Finished — shown when status is 'reading' */}
        {entry?.read_status === 'reading' ? (
          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.markFinishedBtn, saving && { opacity: 0.6 }]}
              onPress={markAsFinished}
              disabled={saving}
              activeOpacity={0.8}
            >
              <Text style={styles.markFinishedBtnText}>
                {saving ? 'Saving...' : '\u2713 Mark as Finished'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Series Tracking — shown above description when series_name is set */}
        {book.series_name && seriesBooks.length > 0 && (
          <View style={styles.seriesCard}>
            <Text style={styles.seriesTitle}>{book.series_name}</Text>
            <View style={styles.seriesSubRow}>
              <Text style={styles.seriesMeta}>
                Book {book.series_number} of {totalInSeries}
              </Text>
              {readCount > 0 && (
                <Text style={styles.seriesMeta}>
                  {'  ·  '}You&apos;ve read {readCount} of {totalInSeries}
                </Text>
              )}
            </View>

            {/* Progress bar */}
            <View style={styles.seriesProgressRow}>
              <View style={styles.seriesProgressBg}>
                <View style={[styles.seriesProgressFill, { width: `${progressPct}%` as any }]} />
              </View>
              <Text style={styles.seriesProgressPct}>{progressPct}%</Text>
            </View>

            {/* Book covers scroll */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.seriesScroll}
              contentContainerStyle={styles.seriesScrollContent}
            >
              {seriesBooks.map((b: any) => {
                const isCurrent = b.id === book.id;
                const status = seriesOwned[b.id];
                const isRead = status === 'read';
                const isReading = status === 'reading';

                // Cover URI: book cover_image_url or Open Library fallback
                const isbn = b.isbn_13 || b.isbn_10;
                const coverUri = b.cover_image_url
                  || (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg` : null);

                let dotLabel = '○';
                let dotColor: string = Colors.muted;
                if (isCurrent) {
                  dotLabel = '●';
                  dotColor = Colors.rust;
                } else if (isRead) {
                  dotLabel = '✓';
                  dotColor = Colors.sage;
                } else if (isReading) {
                  dotLabel = '📖';
                  dotColor = Colors.gold;
                }

                let statusLabel = 'None';
                if (isCurrent) statusLabel = 'This';
                else if (isRead) statusLabel = 'Read';
                else if (isReading) statusLabel = 'Reading';
                else if (status === 'want') statusLabel = 'Want';
                else if (status === 'owned') statusLabel = 'Owned';

                return (
                  <TouchableOpacity
                    key={b.id}
                    style={styles.seriesCoverItem}
                    onPress={() => router.push(`/book/${b.id}`)}
                    activeOpacity={0.75}
                  >
                    <View style={[
                      styles.seriesCoverWrap,
                      isCurrent && styles.seriesCoverCurrent,
                    ]}>
                      {coverUri ? (
                        <Image
                          source={{ uri: coverUri }}
                          style={styles.seriesCoverImg}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.seriesCoverPlaceholder}>
                          <Text style={styles.seriesCoverPlaceholderText} numberOfLines={3}>
                            {b.title}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.seriesDot, { color: dotColor }]}>{dotLabel}</Text>
                    <Text style={styles.seriesStatusLabel}>{statusLabel}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Description */}
        {book.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>About</Text>
            <Text style={styles.description}>{book.description}</Text>
          </View>
        ) : null}

        {/* Book metadata */}
        {book.isbn_13 ? (
          <View style={styles.section}>
            <Text style={styles.metaRow}>
              <Text style={styles.metaKey}>ISBN-13: </Text>
              <Text style={styles.metaValue}>{book.isbn_13}</Text>
            </Text>
          </View>
        ) : null}

        {/* Buy on Bookshop.org */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.bookshopBtn}
            onPress={() => {
              const isbn = book.isbn_13 || book.isbn_10;
              const url = isbn
                ? `https://bookshop.org/a/122832/${isbn}`
                : `https://bookshop.org/search?keywords=${encodeURIComponent(book.title)}`;
              Linking.openURL(url);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.bookshopBtnText}>Buy new on Bookshop.org →</Text>
          </TouchableOpacity>
        </View>

        {/* Remove from collection */}
        {entry ? (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={removeFromCollection}
            >
              <Text style={styles.removeBtnText}>Remove from collection</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const coverUploadBtnStyle = {
  position: 'absolute' as const,
  backgroundColor: 'rgba(0,0,0,0.65)',
  borderRadius: 8,
  padding: 6,
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
};

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
  errorText: {
    fontSize: 16,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  heroSection: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
    alignItems: 'flex-start',
  },
  coverContainer: {
    flexShrink: 0,
    shadowColor: Colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  coverImage: {
    borderRadius: 6,
  },
  heroInfo: {
    flex: 1,
    gap: 6,
    paddingTop: 4,
  },
  bookTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    lineHeight: 26,
  },
  bookAuthor: {
    fontSize: 14,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  bookAuthorLink: {
    color: Colors.rust,
    textDecorationLine: 'underline',
  },
  bookMeta: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  communityRating: {
    marginTop: 6,
    gap: 2,
  },
  communityRatingStars: {
    fontSize: 16,
    color: Colors.gold,
    letterSpacing: 2,
  },
  communityRatingValue: {
    fontSize: 11,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  statusButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  statusBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  statusBtnTextActive: {
    color: Colors.white,
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starBtn: {
    padding: 2,
  },
  star: {
    fontSize: 32,
    lineHeight: 36,
  },
  starFilled: {
    color: Colors.gold,
  },
  starEmpty: {
    color: Colors.border,
  },
  ratingLabel: {
    fontSize: 14,
    color: Colors.muted,
    marginLeft: 8,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  description: {
    fontSize: 14,
    color: Colors.ink,
    lineHeight: 22,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  metaRow: {
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  metaKey: {
    fontWeight: '600',
    color: Colors.muted,
  },
  metaValue: {
    color: Colors.ink,
  },
  reviewInput: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.ink,
    minHeight: 100,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
    marginBottom: 10,
  },
  saveReviewBtn: {
    backgroundColor: Colors.rust,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveReviewBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  progressBarBg: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: Colors.rust, borderRadius: 3 },
  progressPct: { fontSize: 13, fontWeight: '600', color: Colors.rust, minWidth: 36, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  pageInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageInput: { width: 72, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: Colors.ink, textAlign: 'center', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  pageOf: { fontSize: 13, color: Colors.muted, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  markFinishedBtn: {
    backgroundColor: Colors.sage,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center' as const,
  },
  markFinishedBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  bookshopBtn: {
    borderWidth: 1.5,
    borderColor: Colors.rust,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center' as const,
    backgroundColor: 'transparent',
  },
  bookshopBtnText: {
    color: Colors.rust,
    fontSize: 14,
    fontWeight: '600' as const,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  removeBtn: {
    borderWidth: 1.5,
    borderColor: '#c0392b',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  removeBtnText: {
    color: '#c0392b',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // ── Reading Journal ──────────────────────────────────────────────────────────
  journalCard: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: Colors.gold,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 20,
    shadowColor: Colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  journalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  journalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  privateBadge: {
    backgroundColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  privateBadgeText: {
    fontSize: 10,
    color: Colors.muted,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  journalInput: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.ink,
    minHeight: 90,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
    marginBottom: 10,
  },
  saveJournalBtn: {
    backgroundColor: Colors.gold,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 4,
  },
  saveJournalBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  journalEntriesList: {
    marginTop: 12,
    gap: 10,
  },
  journalEntry: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 10,
  },
  journalEntryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  journalEntryDate: {
    fontSize: 11,
    color: Colors.muted,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  journalDeleteBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  journalDeleteBtnText: {
    fontSize: 18,
    color: Colors.muted,
    lineHeight: 20,
  },
  journalEntryText: {
    fontSize: 14,
    color: Colors.ink,
    lineHeight: 21,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },

  // ── Series Tracking ──────────────────────────────────────────────────────────
  seriesCard: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 20,
    shadowColor: Colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 2,
  },
  seriesTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    marginBottom: 4,
  },
  seriesSubRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  seriesMeta: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  seriesProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  seriesProgressBg: {
    flex: 1,
    height: 6,
    backgroundColor: Colors.background,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  seriesProgressFill: {
    height: '100%',
    backgroundColor: Colors.sage,
    borderRadius: 3,
  },
  seriesProgressPct: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.sage,
    minWidth: 34,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  seriesScroll: {
    marginHorizontal: -4,
  },
  seriesScrollContent: {
    paddingHorizontal: 4,
    gap: 10,
  },
  seriesCoverItem: {
    alignItems: 'center',
    width: 64,
  },
  seriesCoverWrap: {
    width: 56,
    height: 80,
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  seriesCoverCurrent: {
    borderWidth: 2,
    borderColor: Colors.rust,
  },
  seriesCoverImg: {
    width: '100%',
    height: '100%',
  },
  seriesCoverPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  seriesCoverPlaceholderText: {
    fontSize: 8,
    color: Colors.muted,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  seriesDot: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 16,
  },
  seriesStatusLabel: {
    fontSize: 10,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
    marginTop: 1,
  },
});
