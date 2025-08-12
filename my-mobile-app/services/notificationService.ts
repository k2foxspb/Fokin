
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
    if (!Device.isDevice) {
      return null;
    }

    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) {
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    });

    // Настраиваем каналы уведомлений для Android
    if (Platform.OS === 'android') {
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
    }

    return token.data;
  } catch (error) {
    console.error('Error getting push token:', error);
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
      if (notification.data?.sender_id) {
        // Используем badge для группировки по отправителю
        notificationContent.badge = notification.data.sender_id;
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