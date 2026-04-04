import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  Platform,
  Pressable,
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
  /** Called when the user taps the camera button on a cover-less book */
  onAddCover?: () => void;
  /** True while a user's cover submission is awaiting review */
  hasPendingCover?: boolean;
}

export function BookCard({
  title,
  author,
  coverImageUrl,
  status,
  onPress,
  cardWidth = 160,
  onAddCover,
  hasPendingCover,
}: BookCardProps) {
  const [imgError, setImgError] = React.useState(false);
  const coverWidth = cardWidth - 16;
  const coverHeight = Math.round(coverWidth * 1.5);

  return (
    <TouchableOpacity
      style={[styles.card, { width: cardWidth }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.coverWrapper}>
        {coverImageUrl && !imgError ? (
          <Image
            source={{ uri: coverImageUrl }}
            style={[styles.cover, { width: coverWidth, height: coverHeight }]}
            resizeMode="cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={{ width: coverWidth, height: coverHeight }}>
            <FakeCover
              title={title}
              author={author}
              width={coverWidth}
              height={coverHeight}
              showText={true}
            />
            {/* Camera button or pending badge — only when onAddCover is provided */}
            {onAddCover && (
              <Pressable
                style={styles.addCoverOverlay}
                onPress={(e) => { e.stopPropagation?.(); onAddCover(); }}
                hitSlop={8}
              >
                {hasPendingCover ? (
                  <View style={styles.pendingBadge}>
                    <Text style={styles.pendingText}>Pending</Text>
                  </View>
                ) : (
                  <View style={styles.cameraBtn}>
                    <Text style={styles.cameraBtnText}>📷</Text>
                  </View>
                )}
              </Pressable>
            )}
          </View>
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
  addCoverOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  cameraBtn: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  cameraBtnText: {
    fontSize: 14,
    lineHeight: 18,
  },
  pendingBadge: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  pendingText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 9,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
  },
});
