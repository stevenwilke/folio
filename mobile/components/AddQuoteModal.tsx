import { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, TouchableOpacity, Platform, KeyboardAvoidingView } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  visible: boolean;
  bookTitle: string;
  onClose: () => void;
  onSave: (quote: { quote_text: string; page_number: number | null; note: string | null }) => Promise<void>;
}

export default function AddQuoteModal({ visible, bookTitle, onClose, onSave }: Props) {
  const [text, setText] = useState('');
  const [page, setPage] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true);
    await onSave({
      quote_text: text.trim(),
      page_number: page ? parseInt(page) : null,
      note: note.trim() || null,
    });
    setSaving(false);
    setText(''); setPage(''); setNote('');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.heading}>Save Quote</Text>
            <Text style={styles.sub}>from {bookTitle}</Text>

            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Enter a memorable quote..."
              placeholderTextColor={Colors.muted}
              multiline
              style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            />

            <View style={styles.row}>
              <TextInput
                value={page}
                onChangeText={setPage}
                placeholder="Page #"
                keyboardType="numeric"
                placeholderTextColor={Colors.muted}
                style={[styles.input, { flex: 0, width: 70 }]}
              />
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Note (optional)"
                placeholderTextColor={Colors.muted}
                style={[styles.input, { flex: 1 }]}
              />
            </View>

            <View style={styles.btnRow}>
              <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={!text.trim() || saving}
                style={[styles.saveBtn, !text.trim() && { opacity: 0.5 }]}
              >
                <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Quote'}</Text>
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
  heading: { fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }), fontSize: 20, fontWeight: '700', color: Colors.ink, marginBottom: 2 },
  sub: { fontSize: 13, color: Colors.muted, marginBottom: 14 },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10, fontSize: 13, backgroundColor: Colors.card, color: Colors.ink, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 8 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 10, justifyContent: 'flex-end' },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  cancelText: { fontSize: 13, color: Colors.muted },
  saveBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: Colors.rust },
  saveText: { fontSize: 13, fontWeight: '600', color: Colors.white },
});
