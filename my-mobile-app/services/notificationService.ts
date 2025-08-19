
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Настройка поведения уведомлений для показа в активном приложении
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});
export const checkNotificationSettings = async () => {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (Platform.OS === 'android') {
      await Notifications.getNotificationChannelsAsync();
    }
    return settings;
  } catch (error) {
    console.error('Error checking notification settings:', error);
    return null;
  }
};

export const addNotificationListener = (handler: (notification: Notifications.Notification) => void): Notifications.Subscription => {
  return Notifications.addNotificationReceivedListener(handler);
};

export const addNotificationResponseListener = (handler: (response: Notifications.NotificationResponse) => void): Notifications.Subscription => {
  return Notifications.addNotificationResponseReceivedListener(handler);
};

export const requestNotificationPermissions = async (): Promise<boolean> => {
  try {
    if (!Device.isDevice) {
      return false;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('messages', {
          name: 'Messages',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
          sound: 'default',
          enableVibrate: true,
          showBadge: true,
        });
      }

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowDisplayInCarPlay: true,
          allowCriticalAlerts: true,
          allowProvisional: false,
        },
      });
      finalStatus = status;
    }

    return finalStatus === 'granted';
  } catch (error) {
    console.error('Error requesting notification permissions:', error);
    return false;
  }
};

export const registerForPushNotifications = async (): Promise<string | null> => {
  try {
    console.log('📱 [Push] Starting push token registration...');

    if (!Device.isDevice) {
      console.log('⚠️ [Push] Not a physical device, skipping push registration');
      return null;
    }

    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) {
      console.log('❌ [Push] No notification permissions');
      return null;
    }

    // Проверяем наличие projectId
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    console.log('🔑 [Push] EAS Project ID:', projectId);

    if (!projectId) {
      console.error('❌ [Push] No EAS project ID found in Constants.expoConfig.extra.eas.projectId');
      console.log('🔍 [Push] Full config check:', {
        expoConfig: Constants.expoConfig,
        extra: Constants.expoConfig?.extra,
        eas: Constants.expoConfig?.extra?.eas
      });
      return null;
    }

    console.log('🔑 [Push] Attempting to get Expo push token...');

    // Получаем токен с retry логикой
    let token = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts && !token) {
      try {
        attempts++;
        console.log(`🔄 [Push] Attempt ${attempts}/${maxAttempts} to get push token`);

        const tokenResponse = await Notifications.getExpoPushTokenAsync({
          projectId: projectId,
        });

        token = tokenResponse.data;
        console.log('✅ [Push] Successfully got Expo push token:', token.substring(0, 20) + '...');
        break;

      } catch (tokenError) {
        console.error(`❌ [Push] Attempt ${attempts} failed:`, tokenError);

        if (tokenError?.message?.includes('Firebase')) {
          console.error('🔥 [Push] Firebase error detected. This suggests FCM is required but not configured.');

          if (Platform.OS === 'android') {
            console.error('🤖 [Push] Android device detected. FCM credentials may be required for production.');
            console.error('📖 [Push] See: https://docs.expo.dev/push-notifications/fcm-credentials/');

            // Для development режима, можем попробовать без projectId
            if (__DEV__ && attempts === maxAttempts) {
              console.log('🚧 [Push] Attempting development fallback...');
              try {
                const fallbackToken = await Notifications.getExpoPushTokenAsync();
                token = fallbackToken.data;
                console.log('✅ [Push] Fallback token successful:', token.substring(0, 20) + '...');
                break;
              } catch (fallbackError) {
                console.error('❌ [Push] Fallback also failed:', fallbackError);
              }
            }
          }
        }

        if (attempts === maxAttempts) {
          console.error('❌ [Push] All attempts failed. Cannot get push token.');
          return null;
        }

        // Ждем перед следующей попыткой
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }

    if (!token) {
      console.error('❌ [Push] Failed to get push token after all attempts');
      return null;
    }

    // Настраиваем каналы уведомлений для Android
    if (Platform.OS === 'android') {
      try {
        await setupAndroidNotificationChannels();
      } catch (channelError) {
        console.error('⚠️ [Push] Error setting up notification channels:', channelError);
        // Не критичная ошибка, продолжаем
      }
    }

    return token;

  } catch (error) {
    console.error('❌ [Push] Critical error in registerForPushNotifications:', error);
    console.error('❌ [Push] Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return null;
  }
};

export const sendLocalNotification = async (notification: {
  title: string;
  body: string;
  data?: any;
  channelId?: string;
}) => {
  try {
    const notificationContent: Notifications.NotificationContentInput = {
      title: notification.title,
      body: notification.body,
      data: notification.data,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
      sticky: false,
      autoDismiss: true,
    };

    if (Platform.OS === 'android') {
      notificationContent.categoryIdentifier = notification.channelId || 'default';
    }

    await Notifications.scheduleNotificationAsync({
      content: notificationContent,
      trigger: null,
    });
  } catch (error) {
    console.error('Error sending local notification:', error);
    throw error;
  }
};

const setupAndroidNotificationChannels = async () => {
  console.log('📱 [Push] Setting up Android notification channels...');

  await Notifications.setNotificationChannelAsync('default', {
    name: 'Основные уведомления',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF231F7C',
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  });

  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Сообщения',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF231F7C',
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  console.log('✅ [Push] Android notification channels configured');
};

export const sendHighPriorityNotification = async (notification: {
  title: string;
  body: string;
  data?: any;
}) => {
  try {
    // Создаем базовое содержимое уведомления
    const notificationContent: Notifications.NotificationContentInput = {
      title: notification.title,
      body: notification.body,
      data: notification.data,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
    };

    // Добавляем платформо-зависимые настройки
    if (Platform.OS === 'android') {
      // Используем категорию как идентификатор канала
      notificationContent.categoryIdentifier = 'messages';

      // Для Android добавляем цвет
      if (notification.data?.senderId) {
        // Используем badge для группировки по отправителю
        notificationContent.badge = notification.data.senderId
;
      }
      if (notification.data?.message_count > 1) {
        notificationContent.title = `${notification.title} (${notification.data.message_count})`;
      }

    } else if (Platform.OS === 'ios') {
      // Для iOS настраиваем категорию
      notificationContent.categoryIdentifier = 'messages';

      // Для iOS используем subtitle для дополнительной информации
      if (notification.data?.message_count && notification.data.message_count > 1) {
        notificationContent.subtitle = `+${notification.data.message_count - 1} сообщений`;
      }
    }

    // Отправляем уведомление
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: notificationContent,
      trigger: null,
    });

    console.log(`📱 Уведомление отправлено с ID: ${notificationId}`);

    return notificationId;
  } catch (error) {
    console.error('❌ Ошибка при отправке уведомления:', error);
    throw error;
  }
};