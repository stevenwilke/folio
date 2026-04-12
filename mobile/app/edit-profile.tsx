import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';

export default function EditProfileScreen() {
  const router = useRouter();
  const [username,     setUsername]     = useState('');
  const [bio,          setBio]          = useState('');
  const [paypalHandle, setPaypalHandle] = useState('');
  const [venmoHandle,  setVenmoHandle]  = useState('');
  const [saving,       setSaving]       = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [userId,       setUserId]       = useState<string | null>(null);
  const [bannerUrl,    setBannerUrl]    = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.back(); return; }
      setUserId(user.id);
      const { data } = await supabase
        .from('profiles')
        .select('username, bio, paypal_handle, venmo_handle, banner_url')
        .eq('id', user.id)
        .single();
      if (data) {
        setUsername(data.username || '');
        setBio(data.bio || '');
        setPaypalHandle(data.paypal_handle || '');
        setVenmoHandle(data.venmo_handle || '');
        setBannerUrl(data.banner_url || null);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function changeAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow access to your photo library.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (result.canceled || !userId) return;
    setSaving(true);
    try {
      const uri = result.assets[0].uri;
      const ext = uri.split('.').pop() ?? 'jpg';
      const path = `${userId}/avatar.${ext}`;
      const response = await fetch(uri);
      const blob = await response.blob();
      const { error: uploadError } = await supabase.storage.from('avatars')
        .upload(path, blob, { upsert: true, contentType: `image/${ext}` });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
      Alert.alert('Updated', 'Profile photo updated!');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not upload photo.');
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    const u = username.trim();
    if (!u) { Alert.alert('Required', 'Username cannot be empty.'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(u)) {
      Alert.alert('Invalid', 'Username can only contain letters, numbers, and underscores.');
      return;
    }
    setSaving(true);

    // Normalise payment handles — strip leading @ and URL prefixes
    const paypal = paypalHandle.trim().replace(/^https?:\/\/paypal\.me\//i, '').replace(/^@/, '');
    const venmo  = venmoHandle.trim().replace(/^@/, '');

    // Check uniqueness — case-insensitive
    const { data: existing } = await supabase.from('profiles').select('id')
      .ilike('username', u).neq('id', userId ?? '').maybeSingle();
    if (existing) { Alert.alert('Taken', 'That username is already taken.'); setSaving(false); return; }

    const { error } = await supabase.from('profiles')
      .update({
        username:       u,
        bio:            bio.trim() || null,
        paypal_handle:  paypal || null,
        venmo_handle:   venmo  || null,
      })
      .eq('id', userId ?? '');
    setSaving(false);
    if (error) { Alert.alert('Error', 'Could not save changes.'); return; }
    Alert.alert('Saved!', 'Your profile has been updated.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      {/* Profile Photo */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profile Photo</Text>
        <TouchableOpacity style={styles.avatarBtn} onPress={changeAvatar} disabled={saving}>
          <Text style={styles.avatarBtnText}>📷  Change Profile Photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.avatarBtn, { marginTop: 8, borderColor: Colors.error }]} onPress={async () => {
          if (!userId) return;
          setSaving(true);
          await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
          setSaving(false);
          Alert.alert('Removed', 'Profile photo removed.');
        }} disabled={saving}>
          <Text style={[styles.avatarBtnText, { color: Colors.error }]}>Remove Profile Photo</Text>
        </TouchableOpacity>
      </View>

      {/* Banner */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Banner Image</Text>
        <TouchableOpacity style={styles.avatarBtn} onPress={async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) { Alert.alert('Permission needed'); return; }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true, aspect: [3, 1], quality: 0.8,
          });
          if (result.canceled || !userId) return;
          setSaving(true);
          try {
            const uri = result.assets[0].uri;
            const ext = uri.split('.').pop() ?? 'jpg';
            const path = `${userId}/banner.${ext}`;
            const response = await fetch(uri);
            const blob = await response.blob();
            await supabase.storage.from('banners').upload(path, blob, { upsert: true, contentType: `image/${ext}` });
            const { data: { publicUrl } } = supabase.storage.from('banners').getPublicUrl(path);
            await supabase.from('profiles').update({ banner_url: publicUrl }).eq('id', userId);
            setBannerUrl(publicUrl);
            Alert.alert('Updated', 'Banner image updated!');
          } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Could not upload banner.');
          } finally { setSaving(false); }
        }} disabled={saving}>
          <Text style={styles.avatarBtnText}>{bannerUrl ? '🖼  Change Banner' : '🖼  Add Banner'}</Text>
        </TouchableOpacity>
        {bannerUrl && (
          <TouchableOpacity style={[styles.avatarBtn, { marginTop: 8, borderColor: Colors.error }]} onPress={async () => {
            if (!userId) return;
            setSaving(true);
            await supabase.from('profiles').update({ banner_url: null }).eq('id', userId);
            setBannerUrl(null);
            setSaving(false);
            Alert.alert('Removed', 'Banner image removed.');
          }} disabled={saving}>
            <Text style={[styles.avatarBtnText, { color: Colors.error }]}>Remove Banner</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Basic Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Basic Info</Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Username <Text style={{ color: Colors.rust }}>*</Text></Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="your_username"
            placeholderTextColor={Colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>Letters, numbers, and underscores only.</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Bio</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell people a little about yourself…"
            placeholderTextColor={Colors.muted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>
      </View>

      {/* Payment Methods */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>💳 Marketplace Payments</Text>
        <Text style={styles.paymentDesc}>
          Let buyers pay you via PayPal or Venmo when you sell books on the marketplace.
        </Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>PayPal Username</Text>
          <TextInput
            style={styles.input}
            value={paypalHandle}
            onChangeText={setPaypalHandle}
            placeholder="your-paypal-username"
            placeholderTextColor={Colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>Just your username — e.g. "janedoe" (not the full URL).</Text>
        </View>

        <View style={[styles.field, { marginBottom: 0 }]}>
          <Text style={styles.fieldLabel}>Venmo Handle</Text>
          <TextInput
            style={styles.input}
            value={venmoHandle}
            onChangeText={setVenmoHandle}
            placeholder="your-venmo-handle"
            placeholderTextColor={Colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>Without the @, e.g. "janedoe".</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, saving && { opacity: 0.6 }]}
        onPress={save}
        disabled={saving}
      >
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.saveBtnText}>Save Changes</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: Colors.background },
  loader:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  content:     { padding: 16, paddingBottom: 40 },
  section:     { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 14 },
  sectionTitle:{ fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },
  paymentDesc: { fontSize: 13, color: Colors.muted, lineHeight: 18, marginBottom: 14, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  field:       { marginBottom: 14 },
  fieldLabel:  { fontSize: 11, fontWeight: '600', color: '#3a3028', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input:       { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.ink },
  textarea:    { minHeight: 80 },
  hint:        { fontSize: 11, color: Colors.muted, marginTop: 4 },
  avatarBtn:   { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 14, alignItems: 'center' },
  avatarBtnText:{ fontSize: 14, color: Colors.rust, fontWeight: '600', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }) },
  saveBtn:     { backgroundColor: Colors.rust, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
});
