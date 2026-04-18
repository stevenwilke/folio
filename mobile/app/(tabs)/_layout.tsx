import { Tabs, useRouter, usePathname } from 'expo-router';
import { Platform, TouchableOpacity, Image, View, Text, DeviceEventEmitter } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export const SHELF_PLANNER_EVENT = 'folio:open-shelf-planner';
import { Colors } from '../../constants/colors';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabConfig {
  name: string;
  title: string;
  icon: IoniconName;
  activeIcon: IoniconName;
}

const TABS: TabConfig[] = [
  { name: 'index',       title: 'Library',   icon: 'book-outline',       activeIcon: 'book' },
  { name: 'search',      title: 'Search',    icon: 'search-outline',     activeIcon: 'search' },
  { name: 'discover',    title: 'Discover',  icon: 'compass-outline',    activeIcon: 'compass' },
  { name: 'feed',        title: 'Feed',      icon: 'radio-outline',      activeIcon: 'radio' },
  { name: 'marketplace', title: 'Market',    icon: 'storefront-outline', activeIcon: 'storefront' },
];

const HIDDEN_TABS = ['profile', 'loans'];

function NotificationBell() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function fetchCount() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;

      // Count unread notifications
      const { count: notifCount } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      // Count pending friend requests
      const { count: friendCount } = await supabase
        .from('friendships')
        .select('id', { count: 'exact', head: true })
        .eq('friend_id', user.id)
        .eq('status', 'pending');

      if (mounted) setUnreadCount((notifCount || 0) + (friendCount || 0));
    }
    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return (
    <TouchableOpacity
      onPress={() => router.push('/notifications')}
      style={{ marginRight: 12, padding: 6 }}
      activeOpacity={0.7}
    >
      <Ionicons name="notifications-outline" size={22} color={Colors.ink} />
      {unreadCount > 0 && (
        <View style={{
          position: 'absolute', top: 2, right: 2,
          minWidth: 16, height: 16, borderRadius: 8,
          backgroundColor: Colors.rust,
          alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: 3,
        }}>
          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function ShelfPlannerButton() {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <TouchableOpacity
      onPress={() => {
        const onLibrary = pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/index';
        if (!onLibrary) router.push('/(tabs)');
        // Emit after navigation so the Library screen listener picks it up on mount/focus
        setTimeout(() => DeviceEventEmitter.emit(SHELF_PLANNER_EVENT), onLibrary ? 0 : 150);
      }}
      style={{ marginRight: 8, padding: 6 }}
      activeOpacity={0.7}
      accessibilityLabel="Open shelf planner"
    >
      <Ionicons name="albums-outline" size={22} color={Colors.ink} />
    </TouchableOpacity>
  );
}

function HeaderRight() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <ShelfPlannerButton />
      <NotificationBell />
      <AvatarButton />
    </View>
  );
}

function AvatarButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [username, setUsername] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('profiles').select('avatar_url, username').eq('id', user.id).single()
        .then(({ data }) => {
          if (data?.avatar_url) setAvatarUrl(data.avatar_url);
          if (data?.username) setUsername(data.username);
        });
    });
  }, []);

  const isOnProfile = pathname === '/profile' || pathname === '/(tabs)/profile';

  return (
    <TouchableOpacity
      onPress={() => {
        if (isOnProfile) {
          router.back();
        } else {
          router.push('/(tabs)/profile');
        }
      }}
      style={{ marginRight: 16 }}
      activeOpacity={0.7}
    >
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={{ width: 32, height: 32, borderRadius: 16, borderWidth: isOnProfile ? 2 : 0, borderColor: Colors.rust }} />
      ) : (
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.rust, justifyContent: 'center', alignItems: 'center', borderWidth: isOnProfile ? 2 : 0, borderColor: Colors.ink }}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{(username || '?').charAt(0).toUpperCase()}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        animation: 'fade',
        animationDuration: 150,
        tabBarActiveTintColor: Colors.rust,
        tabBarInactiveTintColor: Colors.tabInactive,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingTop: 4,
          height: Platform.select({ ios: 84, android: 60, default: 60 }),
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' }),
          marginBottom: Platform.OS === 'ios' ? 0 : 4,
        },
        headerStyle: { backgroundColor: Colors.background },
        headerTitleStyle: {
          fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
          fontWeight: '700',
          color: Colors.ink,
          fontSize: 20,
        },
        headerShadowVisible: false,
        headerTintColor: Colors.rust,
        headerRight: () => <HeaderRight />,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? tab.activeIcon : tab.icon} size={size} color={color} />
            ),
          }}
        />
      ))}
      {HIDDEN_TABS.map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            href: null,
            headerRight: () => <HeaderRight />,
          }}
        />
      ))}
    </Tabs>
  );
}
