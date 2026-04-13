import { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ScrollView, TouchableOpacity, Platform, KeyboardAvoidingView } from 'react-native';
import { Colors } from '../constants/colors';

const TYPES = [
  { value: 'books_count', label: 'Books', icon: '📚' },
  { value: 'pages_count', label: 'Pages', icon: '📖' },
  { value: 'genre_diversity', label: 'Genres', icon: '🎨' },
  { value: 'streak_days', label: 'Streak', icon: '🔥' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (challenge: { title: string; challenge_type: string; target_value: number; month: number; year: number; is_system: boolean }) => Promise<void>;
}

export default function NewChallengeModal({ visible, onClose, onSave }: Props) {
  const [type, setType] = useState('books_count');
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const year = now.getFullYear();

  async function handleSave() {
    if (!title.trim() || !target) return;
    setSaving(true);
    await onSave({ title: title.trim(), challenge_type: type, target_value: parseInt(target), month, year, is_system: false });
    setSaving(false);
    setTitle(''); setTarget('');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.heading}>New Challenge</Text>

            <Text style={styles.label}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              {TYPES.map(t => (
                <TouchableOpacity
                  key={t.value}
                  onPress={() => setType(t.value)}
                  style={[styles.chip, type === t.value && styles.chipActive]}
                >
                  <Text style={[styles.chipText, type === t.value && styles.chipTextActive]}>
                    {t.icon} {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Read 5 books this month"
              placeholderTextColor={Colors.muted}
              style={styles.input}
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Target</Text>
                <TextInput
                  value={target}
                  onChangeText={setTarget}
                  placeholder="e.g., 5"
                  keyboardType="numeric"
                  placeholderTextColor={Colors.muted}
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Month</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <TouchableOpacity
                      key={i}
                      onPress={() => setMonth(i + 1)}
                      style={[styles.monthChip, month === i + 1 && styles.chipActive]}
                    >
                      <Text style={[styles.monthText, month === i + 1 && styles.chipTextActive]}>
                        {new Date(year, i, 1).toLocaleDateString('en-US', { month: 'short' })}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>

            <View style={styles.btnRow}>
              <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={!title.trim() || !target || saving}
                style={[styles.saveBtn, (!title.trim() || !target) && { opacity: 0.5 }]}
              >
                <Text style={styles.saveText}>{saving ? 'Creating...' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  center: { width: '100%', alignItems: 'center' },
  sheet: { backgroundColor: Colors.background, borderRadius: 16, padding: 20, width: '90%', maxWidth: 400 },
  heading: { fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), fontSize: 20, fontWeight: '700', color: Colors.ink, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, marginTop: 12 },
  chipRow: { flexDirection: 'row', marginBottom: 4 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card, marginRight: 6 },
  chipActive: { borderColor: Colors.rust, backgroundColor: '#fdf0ea' },
  chipText: { fontSize: 12, color: Colors.ink },
  chipTextActive: { color: Colors.rust, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10, fontSize: 13, backgroundColor: Colors.card, color: Colors.ink },
  row: { flexDirection: 'row', gap: 12 },
  monthChip: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, marginRight: 4 },
  monthText: { fontSize: 11, color: Colors.ink },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 20, justifyContent: 'flex-end' },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  cancelText: { fontSize: 13, color: Colors.muted },
  saveBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: Colors.rust },
  saveText: { fontSize: 13, fontWeight: '600', color: Colors.white },
});
