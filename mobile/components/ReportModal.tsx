import React, { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput,
  Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { Colors } from '../constants/colors';
import { REPORT_REASONS, reportContent, ContentType, ReportReason } from '../lib/moderation';

interface Props {
  visible: boolean;
  onClose: () => void;
  contentType: ContentType;
  contentId: string;
  reportedUserId?: string | null;
  onReported?: () => void;
}

export default function ReportModal({ visible, onClose, contentType, contentId, reportedUserId, onReported }: Props) {
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setReason('');
    setDetails('');
    setSubmitted(false);
    setError('');
  }

  async function handleSubmit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError('');
    const { error: err } = await reportContent({
      contentType, contentId, reportedUserId, reason: reason as ReportReason, details,
    });
    setSubmitting(false);
    if (err) {
      setError((err as any).message || 'Could not submit report.');
      return;
    }
    setSubmitted(true);
    onReported?.();
    setTimeout(() => { onClose(); reset(); }, 1500);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {submitted ? (
            <View style={styles.successBox}>
              <Text style={styles.checkmark}>✓</Text>
              <Text style={styles.successTitle}>Report submitted</Text>
              <Text style={styles.successSub}>Our team will review it within 24 hours.</Text>
            </View>
          ) : (
            <ScrollView>
              <Text style={styles.title}>Report content</Text>
              <Text style={styles.blurb}>
                Thanks for helping keep Ex Libris safe. An admin will review this within 24 hours.
              </Text>

              <Text style={styles.fieldLabel}>Reason</Text>
              {REPORT_REASONS.map(r => {
                const selected = reason === r.key;
                return (
                  <TouchableOpacity
                    key={r.key}
                    style={[styles.reasonRow, selected && styles.reasonRowSelected]}
                    onPress={() => setReason(r.key)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.radio, selected && styles.radioSelected]}>
                      {selected && <View style={styles.radioDot} />}
                    </View>
                    <Text style={styles.reasonLabel}>{r.label}</Text>
                  </TouchableOpacity>
                );
              })}

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>
                Details <Text style={{ color: Colors.muted, fontWeight: '400' }}>(optional)</Text>
              </Text>
              <TextInput
                style={styles.details}
                value={details}
                onChangeText={setDetails}
                maxLength={500}
                multiline
                placeholder="What specifically is wrong?"
                placeholderTextColor={Colors.muted}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.buttonRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitBtn, (!reason || submitting) && styles.submitBtnDisabled]}
                  onPress={handleSubmit}
                  disabled={!reason || submitting}
                  activeOpacity={0.8}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.submitBtnText}>Submit</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 20, width: '100%', maxWidth: 420, maxHeight: '85%',
  },
  title: {
    fontSize: 18, fontWeight: '700', color: Colors.ink, marginBottom: 6,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  blurb: { color: Colors.muted, fontSize: 13, marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.ink, marginBottom: 6 },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, borderRadius: 6, borderWidth: 1,
    borderColor: Colors.border, marginBottom: 6,
  },
  reasonRowSelected: { borderColor: Colors.rust, backgroundColor: Colors.background },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: Colors.rust },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.rust },
  reasonLabel: { fontSize: 14, color: Colors.ink, flex: 1 },
  details: {
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 6,
    padding: 10, minHeight: 70, fontSize: 14, color: Colors.ink,
    textAlignVertical: 'top',
  },
  error: { color: Colors.rust, fontSize: 13, marginTop: 12 },
  buttonRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  cancelBtnText: { color: Colors.ink, fontSize: 14 },
  submitBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6,
    backgroundColor: Colors.rust, minWidth: 90, alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  successBox: { alignItems: 'center', paddingVertical: 16 },
  checkmark: { fontSize: 32, color: Colors.rust, marginBottom: 8 },
  successTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink, marginBottom: 4 },
  successSub: { fontSize: 13, color: Colors.muted, textAlign: 'center' },
});
