import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, Image, ActivityIndicator, Platform, Alert, ScrollView, KeyboardAvoidingView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';

const TEAL = '#2a9d8f';

interface Props {
  library: any;
  onClose: () => void;
  onSuccess: () => void;
}

/** Resize image and return base64 string (no data: prefix) */
async function resizeAndBase64(uri: string, maxDim = 800): Promise<string> {
  // On React Native we read the file as base64 via fetch + FileReader equivalent
  // For simplicity, we fetch the image and convert via a canvas-like approach
  // In RN, we can just read the file and let the edge function handle sizing
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // Strip the data:image/...;base64, prefix
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default function ScanLibraryModal({ library, onClose, onSuccess }: Props) {
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      setScanResult(null);
      setError(null);
    }
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow access to your camera.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.6,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      setScanResult(null);
      setError(null);
    }
  }

  async function handleScan() {
    if (!photoUri) {
      setError('Please choose a photo first');
      return;
    }
    setScanning(true);
    setError(null);

    try {
      const base64 = await resizeAndBase64(photoUri);
      const { data, error: fnErr } = await supabase.functions.invoke('scan-little-library', {
        body: { imageBase64: base64, mimeType: 'image/jpeg' },
      });

      if (fnErr || data?.error) {
        setError(data?.error || fnErr?.message || 'Could not scan books');
      } else {
        setScanResult(data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }

  async function handleSave() {
    if (!scanResult) return;
    setSaving(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('Not signed in'); setSaving(false); return; }

      let photoUrl: string | null = null;
      if (photoUri) {
        const ext = photoUri.split('.').pop() || 'jpg';
        const path = `${user.id}/${Date.now()}.${ext}`;
        const response = await fetch(photoUri);
        const blob = await response.blob();
        const { error: uploadErr } = await supabase.storage
          .from('library-photos')
          .upload(path, blob, { contentType: `image/${ext}`, upsert: true });
        if (!uploadErr) {
          const { data: { publicUrl } } = supabase.storage.from('library-photos').getPublicUrl(path);
          photoUrl = publicUrl;
        }
      }

      const { error: insertErr } = await supabase.from('little_library_scans').insert({
        library_id: library.id,
        user_id: user.id,
        photo_url: photoUrl,
        books_found: scanResult.books || [],
        note: note.trim() || null,
      });

      if (insertErr) {
        setError(insertErr.message);
        setSaving(false);
        return;
      }

      setSaving(false);
      onSuccess();
    } catch (e: any) {
      setError(e.message || 'Something went wrong');
      setSaving(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardView}>
          <View style={styles.card}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.heading}>📷 Scan Library Contents</Text>
              <Text style={styles.subtitle}>
                Take a photo of the books inside{' '}
                <Text style={{ fontWeight: '600', color: Colors.ink }}>{library.name || library.location_name}</Text>
                {' '}and AI will identify them.
              </Text>

              {/* Photo buttons */}
              <View style={styles.photoRow}>
                <TouchableOpacity onPress={takePhoto} style={styles.photoBtn}>
                  <Text style={styles.photoBtnText}>📷 Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={pickPhoto} style={styles.photoBtn}>
                  <Text style={styles.photoBtnText}>🖼️ Gallery</Text>
                </TouchableOpacity>
                {photoUri && !scanResult && (
                  <TouchableOpacity
                    onPress={handleScan}
                    disabled={scanning}
                    style={[styles.identifyBtn, scanning && { opacity: 0.6 }]}
                  >
                    {scanning ? (
                      <ActivityIndicator size="small" color={Colors.white} />
                    ) : (
                      <Text style={styles.identifyText}>🔍 Identify Books</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>

              {/* Photo preview */}
              {photoUri && (
                <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="contain" />
              )}

              {/* Scanning indicator */}
              {scanning && (
                <View style={styles.scanningRow}>
                  <ActivityIndicator color={TEAL} />
                  <Text style={styles.scanningText}>Scanning books with AI...</Text>
                </View>
              )}

              {/* Scan results */}
              {scanResult && (
                <View style={styles.resultsSection}>
                  <Text style={styles.resultsHeader}>
                    Found {scanResult.books?.length || 0} identifiable books ({scanResult.total_visible || '?'} visible total)
                  </Text>
                  {scanResult.books?.length > 0 && (
                    <View style={styles.bookList}>
                      {scanResult.books.map((b: any, i: number) => (
                        <View key={i} style={styles.bookItem}>
                          <Text style={styles.bookTitle}>{b.title}</Text>
                          {b.author && <Text style={styles.bookAuthor}> by {b.author}</Text>}
                        </View>
                      ))}
                    </View>
                  )}
                  {scanResult.notes && (
                    <Text style={styles.scanNotes}>{scanResult.notes}</Text>
                  )}
                </View>
              )}

              {/* Note input */}
              {scanResult && (
                <View style={styles.field}>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="Optional note (e.g. 'Well-stocked today!')"
                    placeholderTextColor={Colors.muted}
                    style={styles.input}
                    multiline
                    numberOfLines={2}
                  />
                </View>
              )}

              {error && <Text style={styles.error}>{error}</Text>}

              {/* Save button */}
              {scanResult && (
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={saving}
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                >
                  {saving ? (
                    <ActivityIndicator color={Colors.white} />
                  ) : (
                    <Text style={styles.saveText}>Save Inventory Update</Text>
                  )}
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  keyboardView: { width: '100%', alignItems: 'center' },
  card: { backgroundColor: Colors.background, borderRadius: 16, padding: 20, width: '90%', maxHeight: '85%' },
  closeBtn: { position: 'absolute', top: 12, right: 12, zIndex: 1 },
  closeText: { fontSize: 18, color: Colors.muted },
  heading: { fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), fontSize: 20, fontWeight: '700', color: Colors.ink, marginBottom: 4 },
  subtitle: { fontSize: 13, color: Colors.muted, marginBottom: 16 },
  photoRow: { flexDirection: 'row', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  photoBtn: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  photoBtnText: { fontSize: 13, color: Colors.ink },
  identifyBtn: { backgroundColor: TEAL, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  identifyText: { fontSize: 13, fontWeight: '600', color: Colors.white },
  preview: { width: '100%', height: 200, borderRadius: 8, marginBottom: 12 },
  scanningRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 12 },
  scanningText: { fontSize: 13, color: Colors.muted },
  resultsSection: { marginBottom: 14 },
  resultsHeader: { fontSize: 14, fontWeight: '600', color: Colors.ink, marginBottom: 8 },
  bookList: { backgroundColor: Colors.card, borderRadius: 8, padding: 12 },
  bookItem: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  bookTitle: { fontSize: 13, fontWeight: '600', color: Colors.ink },
  bookAuthor: { fontSize: 13, color: Colors.muted },
  scanNotes: { fontSize: 12, color: Colors.muted, fontStyle: 'italic', marginTop: 8 },
  field: { marginBottom: 14 },
  input: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: Colors.ink, textAlignVertical: 'top' },
  error: { fontSize: 12, color: Colors.error, marginBottom: 10 },
  saveBtn: { backgroundColor: TEAL, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  saveText: { fontSize: 15, fontWeight: '700', color: Colors.white },
});
