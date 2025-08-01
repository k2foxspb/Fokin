import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Настройка поведения уведомлений
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,  // Добавлено
    shouldShowList: true,    // Добавлено
  }),
});

export const requestNotificationPermissions = async (): Promise<boolean> => {
  try {
    if (!Device.isDevice) {
      console.log('Must use physical device for Push Notifications');
      return false;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return false;
    }

    console.log('Notification permissions granted');
    return true;
  } catch (error) {
    console.error('Error requesting notification permissions:', error);
    return false;
  }
};

export const registerForPushNotifications = async (): Promise<string | null> => {
  try {
    if (!Device.isDevice) {
      console.log('Must use physical device for Push Notifications');
      return null;
    }

    // Проверяем разрешения
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) {
      return null;
    }

    // Получаем токен
    const token = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    });

    console.log('Expo Push Token:', token.data);

    // Настраиваем канал уведомлений для Android
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
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
}) => {
  try {
    console.log('Sending local notification:', notification);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: notification.title,
        body: notification.body,
        data: notification.data,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null, // Показать немедленно
    });

    console.log('Local notification sent successfully');
  } catch (error) {
    console.error('Error sending local notification:', error);
    throw error;
  }
};

export const addNotificationListener = (handler: (notification: Notifications.Notification) => void) => {
  return Notifications.addNotificationReceivedListener(handler);
};

export const addNotificationResponseListener = (handler: (response: Notifications.NotificationResponse) => void) => {
  return Notifications.addNotificationResponseReceivedListener(handler);
};