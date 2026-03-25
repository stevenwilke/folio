import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Image, StyleSheet, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';

const FORMATS  = ['Hardcover', 'Paperback', 'Mass Market Paperback', 'eBook', 'Audiobook', 'Other'];
const GENRES   = ['Fiction', 'Non-Fiction', 'Mystery', 'Thriller', 'Science Fiction', 'Fantasy', 'Romance', 'Historical Fiction', 'Horror', 'Biography', 'Memoir', 'Self-Help', 'Business', 'Science', 'History', 'Other'];
const STATUSES = [
  { value: 'owned',   label: 'In My Library' },
  { value: 'read',    label: 'Read' },
  { value: 'reading', label: 'Currently Reading' },
  { value: 'want',    label: 'Want to Read' },
] as const;

type Status = typeof STATUSES[number]['value'];

export default function ManualAddScreen() {
  const router = useRouter();

  const [coverUri,   setCoverUri]   = useState<string | null>(null);
  const [title,      setTitle]      = useState('');
  const [author,     setAuthor]     = useState('');
  const [description,setDescription]= useState('');
  const [isbn13,     setIsbn13]     = useState('');
  const [isbn10,     setIsbn10]     = useState('');
  const [publisher,  setPublisher]  = useState('');
  const [year,       setYear]       = useState('');
  const [pages,      setPages]      = useState('');
  const [format,     setFormat]     = useState('');
  const [language,   setLanguage]   = useState('English');
  const [genre,      setGenre]      = useState('');
  const [seriesName, setSeriesName] = useState('');
  const [seriesNum,  setSeriesNum]  = useState('');
  const [status,     setStatus]     = useState<Status>('owned');
  const [saving,     setSaving]     = useState(false);

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [2, 3],
      quality: 0.8,
    });
    if (!result.canceled) setCoverUri(result.assets[0].uri);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [2, 3],
      quality: 0.8,
    });
    if (!result.canceled) setCoverUri(result.assets[0].uri);
  }

  function showImageOptions() {
    Alert.alert('Cover Photo', 'Choose a source', [
      { text: 'Camera',        onPress: takePhoto },
      { text: 'Photo Library', onPress: pickImage },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function save() {
    if (!title.trim())  { Alert.alert('Required', 'Please enter a title.'); return; }
    if (!author.trim()) { Alert.alert('Required', 'Please enter an author.'); return; }

    setSaving(true);

    // Upload cover if chosen
    let coverUrl: string | null = null;
    if (coverUri) {
      try {
        const ext      = coverUri.split('.').pop() ?? 'jpg';
        const path     = `manual/${Date.now()}.${ext}`;
        const response = await fetch(coverUri);
        const blob     = await response.blob();
        const { error: uploadErr } = await supabase.storage
          .from('covers')
          .upload(path, blob, { contentType: `image/${ext}` });
        if (!uploadErr) {
          const { data: { publicUrl } } = supabase.storage.from('covers').getPublicUrl(path);
          coverUrl = publicUrl;
        }
      } catch (e) {
        console.warn('Cover upload failed', e);
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    // Find or create book
    let bookId: string | null = null;

    if (isbn13.trim()) {
      const { data } = await supabase.from('books').select('id').eq('isbn_13', isbn13.trim()).maybeSingle();
      if (data) bookId = data.id;
    }
    if (!bookId && isbn10.trim()) {
      const { data } = await supabase.from('books').select('id').eq('isbn_10', isbn10.trim()).maybeSingle();
      if (data) bookId = data.id;
    }
    if (!bookId) {
      const { data } = await supabase.from('books').select('id')
        .eq('title', title.trim()).eq('author', author.trim()).maybeSingle();
      if (data) bookId = data.id;
    }

    if (!bookId) {
      const { data: newBook, error } = await supabase.from('books').insert({
        title:           title.trim(),
        author:          author.trim(),
        isbn_13:         isbn13.trim()       || null,
        isbn_10:         isbn10.trim()       || null,
        cover_image_url: coverUrl            || null,
        published_year:  year ? parseInt(year) : null,
        genre:           genre               || null,
        description:     description.trim()  || null,
        publisher:       publisher.trim()    || null,
        pages:           pages ? parseInt(pages) : null,
        format:          format              || null,
        language:        language.trim()     || null,
        series_name:     seriesName.trim()   || null,
        series_number:   seriesNum.trim()    || null,
      }).select().single();

      if (error || !newBook) {
        Alert.alert('Error', 'Could not save the book. Please try again.');
        setSaving(false);
        return;
      }
      bookId = newBook.id;
    }

    await supabase.from('collection_entries').upsert(
      { user_id: user.id, book_id: bookId, read_status: status },
      { onConflict: 'user_id,book_id' }
    );

    setSaving(false);
    Alert.alert('Added!', `"${title}" has been added to your library.`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      {/* Cover */}
      <Section title="Cover Photo">
        <TouchableOpacity style={styles.coverBox} onPress={showImageOptions}>
          {coverUri
            ? <Image source={{ uri: coverUri }} style={styles.coverImg} />
            : (
              <View style={styles.coverEmpty}>
                <Text style={styles.coverIcon}>📷</Text>
                <Text style={styles.coverHint}>Tap to add cover</Text>
                <Text style={styles.coverHint2}>Camera or photo library</Text>
              </View>
            )
          }
        </TouchableOpacity>
        {coverUri && (
          <TouchableOpacity onPress={() => setCoverUri(null)}>
            <Text style={styles.clearCover}>Remove photo</Text>
          </TouchableOpacity>
        )}
      </Section>

      {/* Add as */}
      <Section title="Add to Collection As">
        <View style={styles.statusRow}>
          {STATUSES.map(st => (
            <TouchableOpacity
              key={st.value}
              style={[styles.statusBtn, status === st.value && styles.statusBtnActive]}
              onPress={() => setStatus(st.value)}
            >
              <Text style={[styles.statusBtnText, status === st.value && styles.statusBtnTextActive]}>
                {st.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Section>

      {/* Basic info */}
      <Section title="Basic Info">
        <Field label="Title" required>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Book title" placeholderTextColor={Colors.muted} />
        </Field>
        <Field label="Author" required>
          <TextInput style={styles.input} value={author} onChangeText={setAuthor} placeholder="Author name" placeholderTextColor={Colors.muted} />
        </Field>
        <Field label="Description / Synopsis">
          <TextInput style={[styles.input, styles.textarea]} value={description} onChangeText={setDescription} placeholder="What's the book about?" placeholderTextColor={Colors.muted} multiline numberOfLines={4} textAlignVertical="top" />
        </Field>
      </Section>

      {/* Publishing */}
      <Section title="Publishing">
        <Field label="Publisher">
          <TextInput style={styles.input} value={publisher} onChangeText={setPublisher} placeholder="Publisher name" placeholderTextColor={Colors.muted} />
        </Field>
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Field label="Year Published">
              <TextInput style={styles.input} value={year} onChangeText={setYear} placeholder="2023" placeholderTextColor={Colors.muted} keyboardType="numeric" maxLength={4} />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Pages">
              <TextInput style={styles.input} value={pages} onChangeText={setPages} placeholder="320" placeholderTextColor={Colors.muted} keyboardType="numeric" />
            </Field>
          </View>
        </View>
        <Field label="Language">
          <TextInput style={styles.input} value={language} onChangeText={setLanguage} placeholder="English" placeholderTextColor={Colors.muted} />
        </Field>
        <Field label="Format">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
            <View style={styles.chipRow}>
              {FORMATS.map(f => (
                <TouchableOpacity key={f} style={[styles.chip, format === f && styles.chipActive]} onPress={() => setFormat(f === format ? '' : f)}>
                  <Text style={[styles.chipText, format === f && styles.chipTextActive]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Field>
        <Field label="Genre">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
            <View style={styles.chipRow}>
              {GENRES.map(g => (
                <TouchableOpacity key={g} style={[styles.chip, genre === g && styles.chipActive]} onPress={() => setGenre(g === genre ? '' : g)}>
                  <Text style={[styles.chipText, genre === g && styles.chipTextActive]}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Field>
      </Section>

      {/* Identifiers */}
      <Section title="Identifiers">
        <Field label="ISBN-13">
          <TextInput style={styles.input} value={isbn13} onChangeText={setIsbn13} placeholder="978-X-XXX-XXXXX-X" placeholderTextColor={Colors.muted} keyboardType="numeric" maxLength={17} />
        </Field>
        <Field label="ISBN-10">
          <TextInput style={styles.input} value={isbn10} onChangeText={setIsbn10} placeholder="X-XXX-XXXXX-X" placeholderTextColor={Colors.muted} keyboardType="numeric" maxLength={13} />
        </Field>
      </Section>

      {/* Series */}
      <Section title="Series">
        <View style={styles.row2}>
          <View style={{ flex: 2 }}>
            <Field label="Series Name">
              <TextInput style={styles.input} value={seriesName} onChangeText={setSeriesName} placeholder="e.g. Harry Potter" placeholderTextColor={Colors.muted} />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Volume #">
              <TextInput style={styles.input} value={seriesNum} onChangeText={setSeriesNum} placeholder="1" placeholderTextColor={Colors.muted} keyboardType="numeric" />
            </Field>
          </View>
        </View>
      </Section>

      {/* Save */}
      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.saveBtnText}>Add to My Library</Text>
        }
      </TouchableOpacity>

    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}{required && <Text style={{ color: Colors.rust }}> *</Text>}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },

  section:      { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 14 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },

  field:      { marginBottom: 12 },
  fieldLabel: { fontSize: 11, fontWeight: '600', color: '#3a3028', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input:      { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.ink },
  textarea:   { minHeight: 80, textAlignVertical: 'top' },
  row2:       { flexDirection: 'row', gap: 10 },

  // Cover
  coverBox:    { width: 120, aspectRatio: 2/3, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.background, borderWidth: 2, borderColor: Colors.border, borderStyle: 'dashed', alignSelf: 'center', marginBottom: 8 },
  coverImg:    { width: '100%', height: '100%' },
  coverEmpty:  { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 4 },
  coverIcon:   { fontSize: 24 },
  coverHint:   { fontSize: 12, color: Colors.muted, fontWeight: '600', textAlign: 'center' },
  coverHint2:  { fontSize: 10, color: '#b0a898', textAlign: 'center' },
  clearCover:  { fontSize: 12, color: Colors.muted, textAlign: 'center', textDecorationLine: 'underline', marginTop: 4 },

  // Status
  statusRow:       { gap: 8 },
  statusBtn:       { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  statusBtnActive: { borderColor: Colors.rust, backgroundColor: 'rgba(192,82,30,0.08)' },
  statusBtnText:   { fontSize: 14, color: Colors.ink },
  statusBtnTextActive: { color: Colors.rust, fontWeight: '600' },

  // Chips
  chipRow:       { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background },
  chipActive:    { backgroundColor: Colors.rust, borderColor: Colors.rust },
  chipText:      { fontSize: 13, color: Colors.ink },
  chipTextActive:{ color: '#fff', fontWeight: '600' },

  // Save
  saveBtn:     { backgroundColor: Colors.rust, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
});
