import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, Image, ActivityIndicator, Platform, Alert, KeyboardAvoidingView, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';

const TEAL = '#2a9d8f';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddLibraryModal({ onClose, onSuccess }: Props) {
  const [name, setName] = useState('');
  const [locationName, setLocationName] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    getCurrentLocation();
  }, []);

  async function getCurrentLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission is needed to add a library');
        setLocating(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setLatitude(loc.coords.latitude);
      setLongitude(loc.coords.longitude);

      // Reverse geocode to get address
      const [address] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (address) {
        const parts = [address.street, address.city, address.region].filter(Boolean);
        setLocationName(parts.join(', '));
      }
    } catch (e) {
      console.error('Location error:', e);
    } finally {
      setLocating(false);
    }
  }

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow access to your camera.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function handleSubmit() {
    if (!latitude || !longitude) {
      setError('Could not determine your location. Please try again.');
      return;
    }
    if (!locationName.trim()) {
      setError('Please enter an address or location description.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('Not signed in'); setSubmitting(false); return; }

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

      const { error: insertErr } = await supabase.from('little_libraries').insert({
        user_id: user.id,
        latitude,
        longitude,
        location_name: locationName.trim(),
        name: name.trim() || null,
        photo_url: photoUrl,
      });

      if (insertErr) {
        setError(insertErr.message);
        setSubmitting(false);
        return;
      }

      setSubmitting(false);
      onSuccess();
    } catch (e: any) {
      setError(e.message || 'Something went wrong');
      setSubmitting(false);
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
              <Text style={styles.heading}>📚 Add a Little Library</Text>
              <Text style={styles.subtitle}>Share a Free Little Library location with the community</Text>

              {/* Location */}
              <View style={styles.field}>
                <Text style={styles.label}>LOCATION</Text>
                {locating ? (
                  <View style={styles.locatingRow}>
                    <ActivityIndicator size="small" color={TEAL} />
                    <Text style={styles.locatingText}>Getting your location...</Text>
                  </View>
                ) : latitude ? (
                  <View style={styles.locatingRow}>
                    <Text style={styles.coordText}>📍 {latitude.toFixed(4)}, {longitude?.toFixed(4)}</Text>
                    <TouchableOpacity onPress={getCurrentLocation}>
                      <Text style={styles.refreshText}>Refresh</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={getCurrentLocation} style={styles.locBtn}>
                    <Text style={styles.locBtnText}>📍 Get Current Location</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Address */}
              <View style={styles.field}>
                <Text style={styles.label}>ADDRESS</Text>
                <TextInput
                  value={locationName}
                  onChangeText={setLocationName}
                  placeholder="Street address or description"
                  placeholderTextColor={Colors.muted}
                  style={styles.input}
                />
              </View>

              {/* Name */}
              <View style={styles.field}>
                <Text style={styles.label}>NAME (OPTIONAL)</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Oak Street Little Library"
                  placeholderTextColor={Colors.muted}
                  style={styles.input}
                />
              </View>

              {/* Photo */}
              <View style={styles.field}>
                <Text style={styles.label}>PHOTO (OPTIONAL)</Text>
                <View style={styles.photoRow}>
                  <TouchableOpacity onPress={takePhoto} style={styles.photoBtn}>
                    <Text style={styles.photoBtnText}>📷 Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={pickPhoto} style={styles.photoBtn}>
                    <Text style={styles.photoBtnText}>🖼️ Gallery</Text>
                  </TouchableOpacity>
                </View>
                {photoUri && (
                  <Image source={{ uri: photoUri }} style={styles.preview} />
                )}
              </View>

              {error && <Text style={styles.error}>{error}</Text>}

              <TouchableOpacity
                onPress={handleSubmit}
                disabled={submitting}
                style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              >
                {submitting ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={styles.submitText}>Add Little Library</Text>
                )}
              </TouchableOpacity>
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
  subtitle: { fontSize: 13, color: Colors.muted, marginBottom: 18 },
  field: { marginBottom: 14 },
  label: { fontSize: 11, color: Colors.muted, fontWeight: '600', letterSpacing: 0.8, marginBottom: 6 },
  input: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: Colors.ink },
  locatingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locatingText: { fontSize: 13, color: Colors.muted },
  coordText: { fontSize: 13, color: Colors.ink },
  refreshText: { fontSize: 12, color: TEAL, fontWeight: '600' },
  locBtn: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  locBtnText: { fontSize: 13, color: Colors.ink },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoBtn: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  photoBtnText: { fontSize: 13, color: Colors.ink },
  preview: { width: '100%', height: 150, borderRadius: 8, marginTop: 10 },
  error: { fontSize: 12, color: Colors.error, marginBottom: 10 },
  submitBtn: { backgroundColor: TEAL, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 4, marginBottom: 8 },
  submitText: { fontSize: 15, fontWeight: '700', color: Colors.white },
});
