import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Colors } from '../constants/colors';
import { FakeCover } from './FakeCover';

export type ReadStatus = 'owned' | 'read' | 'reading' | 'want';

const STATUS_LABELS: Record<ReadStatus, string> = {
  owned: 'In Library',
  read: 'Read',
  reading: 'Reading',
  want: 'Want to Read',
};

interface BookCardProps {
  id: string;
  title: string;
  author?: string | null;
  coverImageUrl?: string | null;
  status?: ReadStatus | null;
  onPress?: () => void;
  cardWidth?: number;
}

export function BookCard({
  title,
  author,
  coverImageUrl,
  status,
  onPress,
  cardWidth = 160,
}: BookCardProps) {
  const coverWidth = cardWidth - 16;
  const coverHeight = Math.round(coverWidth * 1.5);

  return (
    <TouchableOpacity
      style={[styles.card, { width: cardWidth }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.coverWrapper}>
        {coverImageUrl ? (
          <Image
            source={{ uri: coverImageUrl }}
            style={[styles.cover, { width: coverWidth, height: coverHeight }]}
            resizeMode="cover"
          />
        ) : (
          <FakeCover
            title={title}
            author={author}
            width={coverWidth}
            height={coverHeight}
          />
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {author ? (
          <Text style={styles.author} numberOfLines={1}>
            {author}
          </Text>
        ) : null}
        {status ? (
          <View style={[styles.badge, { backgroundColor: Colors.statusBg[status] }]}>
            <Text style={[styles.badgeText, { color: Colors.status[status] }]}>
              {STATUS_LABELS[status]}
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
    overflow: 'hidden',
  },
  coverWrapper: {
    padding: 8,
    paddingBottom: 4,
  },
  cover: {
    borderRadius: 3,
  },
  info: {
    padding: 8,
    paddingTop: 4,
    gap: 3,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    lineHeight: 17,
  },
  author: {
    fontSize: 11,
    color: Colors.muted,
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});
