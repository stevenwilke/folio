import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  quoteText: string;
  bookTitle?: string;
  bookAuthor?: string | null;
  pageNumber?: number | null;
  note?: string | null;
  username?: string | null;
  onShare?: () => void;
  onDelete?: () => void;
}

export default function QuoteCard({ quoteText, bookTitle, bookAuthor, pageNumber, note, username, onShare, onDelete }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.quote}>"{quoteText}"</Text>
      <View style={styles.attribution}>
        <Text style={styles.source}>
          — <Text style={styles.bookTitle}>{bookTitle}</Text>
          {bookAuthor ? <Text> by {bookAuthor}</Text> : null}
          {pageNumber ? <Text> · p.{pageNumber}</Text> : null}
        </Text>
        {username && <Text style={styles.savedBy}>Saved by {username}</Text>}
      </View>
      {note && <Text style={styles.note}>Note: {note}</Text>}
      {(onShare || onDelete) && (
        <View style={styles.actions}>
          {onShare && (
            <TouchableOpacity onPress={onShare} style={styles.shareBtn}>
              <Text style={styles.shareText}>Share to Feed</Text>
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity onPress={onDelete}>
              <Text style={styles.deleteText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
  },
  quote: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontSize: 15,
    fontStyle: 'italic',
    color: Colors.ink,
    lineHeight: 22,
    marginBottom: 8,
  },
  attribution: { gap: 2 },
  source: { fontSize: 12, color: Colors.muted },
  bookTitle: { fontWeight: '600', color: Colors.ink },
  savedBy: { fontSize: 11, color: Colors.muted },
  note: { fontSize: 12, color: Colors.muted, marginTop: 6, fontStyle: 'normal' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  shareBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8 },
  shareText: { fontSize: 11, color: Colors.rust, fontWeight: '500' },
  deleteText: { fontSize: 12, color: Colors.muted, paddingHorizontal: 6 },
});
