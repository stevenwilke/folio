import 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { syncCurrentlyReadingWidget } from '../lib/currentlyReadingWidget';

function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();

  // Register for push notifications and handle taps
  usePushNotifications(session);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      syncCurrentlyReadingWidget(session.user.id).catch(() => {});
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!session && !inAuthGroup) {
      // Not signed in — redirect to auth screen
      router.replace('/auth');
    } else if (session && inAuthGroup) {
      // Signed in but on auth screen — redirect to main app
      router.replace('/(tabs)');
    }
  }, [session, segments, loading]);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.rust} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <AuthGate>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.background },
          headerTitleStyle: {
            fontFamily: 'Georgia',
            fontWeight: '700',
            color: Colors.ink,
          },
          headerTintColor: Colors.rust,
          headerShadowVisible: false,
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="scan" options={{ headerShown: false }} />
        <Stack.Screen name="book/[id]" options={{ title: '' }} />
        <Stack.Screen name="stats" options={{ title: 'Reading Stats', headerShown: true }} />
        <Stack.Screen name="valuation" options={{ title: 'Library Value', headerShown: true }} />
        <Stack.Screen name="friends" options={{ title: 'Friends', headerShown: true }} />
        <Stack.Screen name="edit-profile" options={{ title: 'Edit Profile', headerShown: true }} />
        <Stack.Screen name="manual-add" options={{ title: 'Add Book Manually', headerShown: true }} />
        <Stack.Screen name="shelves" options={{ title: 'My Shelves', headerShown: true }} />
        <Stack.Screen name="polls" options={{ title: 'Reading Polls', headerShown: true }} />
        <Stack.Screen name="clubs" options={{ title: 'Book Clubs', headerShown: true }} />
        <Stack.Screen name="author/[name]" options={{ title: 'Author', headerShown: true }} />
        <Stack.Screen name="profile/[username]" options={{ title: 'Profile', headerShown: true }} />
        <Stack.Screen name="badges" options={{ title: 'Badges', headerShown: true }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications', headerShown: true }} />
        <Stack.Screen name="nearby" options={{ title: 'Nearby', headerShown: true }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack>
    </AuthGate>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
