import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Colors } from '../constants/colors';
import { LinearGradient } from 'expo-linear-gradient';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const TYPE_ICONS: Record<string, string> = {
  friend_request: '👥', friend_accepted: '👥',
  borrow_request: '📚', borrow_approved: '📚', borrow_returned: '📚',
  order_update: '🏪', recommendation: '💌',
  club_activity: '📖', achievement: '🏅', quote_shared: '💬',
  book_drop_claimed: '📍',
};

interface Props {
  notification: {
    id: string;
    type: string;
    title: string;
    body?: string | null;
    is_read: boolean;
    created_at: string;
    link?: string | null;
  };
  onPress?: () => void;
  onDismiss?: () => void;
}

export default function NotificationRow({ notification, onPress, onDismiss }: Props) {
  const icon = TYPE_ICONS[notification.type] || '🔔';

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.row, !notification.is_read && styles.rowUnread]}
      activeOpacity={0.7}
    >
      <LinearGradient colors={['#c0521e', '#b8860b']} style={styles.iconCircle}>
        <Text style={styles.icon}>{icon}</Text>
      </LinearGradient>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>{notification.title}</Text>
        {notification.body ? <Text style={styles.body} numberOfLines={2}>{notification.body}</Text> : null}
      </View>
      <View style={styles.right}>
        <Text style={styles.time}>{timeAgo(notification.created_at)}</Text>
        {onDismiss && !notification.is_read && (
          <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.dismiss}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowUnread: { backgroundColor: 'rgba(192,82,30,0.04)' },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 16 },
  content: { flex: 1 },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
    marginBottom: 2,
  },
  body: { fontSize: 13, color: Colors.muted, lineHeight: 18 },
  right: { alignItems: 'flex-end', gap: 6 },
  time: { fontSize: 11, color: Colors.muted },
  dismiss: { fontSize: 14, color: Colors.muted },
});
