import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';

// Order must match the visible tab order in mobile/app/(tabs)/_layout.tsx
const TAB_ORDER = ['index', 'search', 'discover', 'feed', 'marketplace'] as const;
type TabName = (typeof TAB_ORDER)[number];

const ROUTE_FOR: Record<TabName, string> = {
  index: '/(tabs)',
  search: '/(tabs)/search',
  discover: '/(tabs)/discover',
  feed: '/(tabs)/feed',
  marketplace: '/(tabs)/marketplace',
};

interface Props {
  current: TabName;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Wrap a tab screen's root with this to enable horizontal swipe navigation
 * to the adjacent bottom tab. Vertical scrolls inside children still work.
 */
export default function SwipeTabNav({ current, children, style }: Props) {
  const router = useRouter();
  const idx = TAB_ORDER.indexOf(current);

  const pan = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-16, 16])
    .onEnd((e) => {
      const { translationX, velocityX } = e;
      const fast = Math.abs(velocityX) > 500;
      const far  = Math.abs(translationX) > 80;
      if (!fast && !far) return;
      if (translationX < 0 && idx < TAB_ORDER.length - 1) {
        const next = TAB_ORDER[idx + 1];
        router.navigate(ROUTE_FOR[next] as any);
      } else if (translationX > 0 && idx > 0) {
        const prev = TAB_ORDER[idx - 1];
        router.navigate(ROUTE_FOR[prev] as any);
      }
    })
    .runOnJS(true);

  return (
    <GestureDetector gesture={pan}>
      <View style={[{ flex: 1 }, style]}>{children}</View>
    </GestureDetector>
  );
}
