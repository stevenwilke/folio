import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabConfig {
  name: string;
  title: string;
  icon: IoniconName;
  activeIcon: IoniconName;
}

const TABS: TabConfig[] = [
  {
    name: 'index',
    title: 'Library',
    icon: 'book-outline',
    activeIcon: 'book',
  },
  {
    name: 'search',
    title: 'Search',
    icon: 'search-outline',
    activeIcon: 'search',
  },
  {
    name: 'discover',
    title: 'Discover',
    icon: 'compass-outline',
    activeIcon: 'compass',
  },
  {
    name: 'feed',
    title: 'Feed',
    icon: 'radio-outline',
    activeIcon: 'radio',
  },
  {
    name: 'profile',
    title: 'Profile',
    icon: 'person-outline',
    activeIcon: 'person',
  },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
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
          fontFamily: Platform.select({
            ios: 'System',
            android: 'sans-serif',
            default: 'sans-serif',
          }),
          marginBottom: Platform.OS === 'ios' ? 0 : 4,
        },
        headerStyle: {
          backgroundColor: Colors.background,
        },
        headerTitleStyle: {
          fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
          fontWeight: '700',
          color: Colors.ink,
          fontSize: 20,
        },
        headerShadowVisible: false,
        headerTintColor: Colors.rust,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? tab.activeIcon : tab.icon}
                size={size}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
