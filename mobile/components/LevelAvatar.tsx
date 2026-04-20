import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { getLevelInfo } from '../lib/level';

interface Props {
  src?: string | null;
  name?: string;
  size?: number;
  level?: number | null;
  points?: number | null;
  showChip?: boolean;
}

/**
 * Avatar with a level ring and small numeric chip in the corner.
 * Keep visual parity with src/components/LevelAvatar.jsx on web.
 */
export default function LevelAvatar({
  src,
  name = '?',
  size = 48,
  level,
  points,
  showChip = true,
}: Props) {
  const lvl = level && level > 0 ? level : 1;
  const info = getLevelInfo(lvl, points || 0);
  const ringWidth = Math.max(2, Math.round(size / 18));
  const chipSize = Math.max(16, Math.round(size * 0.36));
  const outerSize = size + ringWidth * 2;
  const initial = (name || '?').charAt(0).toUpperCase();

  return (
    <View
      style={{
        width: outerSize,
        height: outerSize,
        position: 'relative',
      }}
    >
      <View
        style={{
          width: outerSize,
          height: outerSize,
          borderRadius: outerSize / 2,
          borderWidth: ringWidth,
          borderColor: info.ring,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: '#e5dfd5',
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {src ? (
            <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} />
          ) : (
            <Text
              style={{
                fontFamily: 'Georgia',
                fontWeight: '700',
                color: '#6a5b4a',
                fontSize: Math.round(size * 0.42),
              }}
            >
              {initial}
            </Text>
          )}
        </View>
      </View>
      {showChip && (
        <View
          accessibilityLabel={`Level ${info.level}`}
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: chipSize,
            height: chipSize,
            borderRadius: chipSize / 2,
            backgroundColor: info.ring,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: '#fff',
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowOffset: { width: 0, height: 1 },
            shadowRadius: 2,
            elevation: 2,
          }}
        >
          <Text
            style={{
              color: '#fff',
              fontWeight: '800',
              fontSize: Math.max(9, Math.round(chipSize * 0.58)),
              lineHeight: Math.max(10, Math.round(chipSize * 0.66)),
            }}
          >
            {info.level}
          </Text>
        </View>
      )}
    </View>
  );
}
