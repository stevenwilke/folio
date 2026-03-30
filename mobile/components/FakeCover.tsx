import React from 'react';
import { StyleSheet, Text, View, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';

interface FakeCoverProps {
  title: string;
  author?: string | null;
  width?: number;
  height?: number;
  showText?: boolean;
}

// Generate a pair of gradient colors from the book title
function getGradientColors(title: string): [string, string] {
  const palettes: [string, string][] = [
    ['#c0521e', '#8b3a15'], // rust
    ['#5a7a5a', '#3d5c3d'], // sage
    ['#b8860b', '#8a6408'], // gold
    ['#4a6fa5', '#2d4d7a'], // blue
    ['#7b5ea7', '#5a3f82'], // purple
    ['#2d7d6f', '#1f5c56'], // teal
    ['#a05c3b', '#7a3f22'], // brown
    ['#6b7c5a', '#4e5c3e'], // olive
    ['#8b4a6b', '#6a2f4e'], // mauve
    ['#3a6b8a', '#254f6b'], // steel blue
  ];

  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash + title.charCodeAt(i)) % palettes.length;
  }

  return palettes[hash];
}

export function FakeCover({ title, author, width = 80, height = 120, showText = true }: FakeCoverProps) {
  const [startColor, endColor] = getGradientColors(title);
  const initial = title.trim().charAt(0).toUpperCase();

  return (
    <LinearGradient
      colors={[startColor, endColor]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.container, { width, height }]}
    >
      {/* Decorative spine line */}
      <View style={styles.spineLine} />

      <View style={styles.content}>
        <Text style={[styles.initial, { fontSize: width * 0.35 }]}>{initial}</Text>
        {showText && width >= 60 && (
          <Text
            style={[styles.title, { fontSize: Math.max(7, width * 0.11) }]}
            numberOfLines={3}
          >
            {title}
          </Text>
        )}
        {showText && author && width >= 80 && (
          <Text
            style={[styles.author, { fontSize: Math.max(6, width * 0.09) }]}
            numberOfLines={2}
          >
            {author}
          </Text>
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  spineLine: {
    position: 'absolute',
    left: 8,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  content: {
    flex: 1,
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  initial: {
    color: 'rgba(255,255,255,0.9)',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontWeight: '700',
    marginBottom: 4,
  },
  title: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 11,
  },
  author: {
    color: 'rgba(255,255,255,0.65)',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontWeight: '400',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 10,
  },
});
