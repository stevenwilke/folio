import { useEffect, useRef } from 'react'
import { Platform, Alert } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { Session } from '@supabase/supabase-js'

// How foreground notifications behave
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

export function usePushNotifications(session: Session | null) {
  const router = useRouter()
  const notificationListener = useRef<Notifications.EventSubscription>()
  const responseListener = useRef<Notifications.EventSubscription>()

  useEffect(() => {
    if (!session?.user?.id) return

    registerForPushNotifications(session.user.id)

    // Foreground notification received
    notificationListener.current = Notifications.addNotificationReceivedListener(
      notification => {
        // Notification received while app is open — it shows automatically
        console.log('Notification received:', notification)
      }
    )

    // User tapped a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      response => {
        const data = response.notification.request.content.data as Record<string, string>
        handleNotificationTap(data, router)
      }
    )

    return () => {
      notificationListener.current?.remove()
      responseListener.current?.remove()
    }
  }, [session?.user?.id])
}

async function registerForPushNotifications(userId: string) {
  if (!Device.isDevice) {
    // Push notifications only work on real devices
    return
  }

  // Check/request permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') {
    return // User declined — respect their choice silently
  }

  // Android needs a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Ex Libris',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#c0521e',
    })
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: 'folio', // matches slug in app.json
    })
    const token = tokenData.data

    // Save token to Supabase (upsert so re-installs update cleanly)
    await supabase
      .from('push_tokens')
      .upsert(
        {
          user_id: userId,
          token,
          platform: Platform.OS,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,token' }
      )
  } catch (err) {
    console.warn('Push token registration failed:', err)
  }
}

function handleNotificationTap(
  data: Record<string, string>,
  router: ReturnType<typeof useRouter>
) {
  if (!data?.type) return

  switch (data.type) {
    case 'friend_request':
      router.push('/friends')
      break
    case 'friend_accepted':
      router.push(`/profile/${data.username}`)
      break
    case 'loan_request':
      router.push('/(tabs)/loans')
      break
    case 'loan_accepted':
    case 'loan_declined':
      router.push('/(tabs)/loans')
      break
    case 'book_club_post':
      router.push('/clubs')
      break
    case 'poll':
      router.push('/polls')
      break
    default:
      router.push('/(tabs)')
  }
}
