import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_CONFIG } from '../config';

// Configure notifications to show when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Interface for notification data
interface MessageNotification {
  title: string;
  body: string;
  data?: object;
}

/**
 * Request permission for push notifications
 * @returns {Promise<boolean>} Whether permission was granted
 */
export const requestNotificationPermissions = async (): Promise<boolean> => {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // If we don't have permission yet, ask for it
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    // If we still don't have permission, return false
    if (finalStatus !== 'granted') {
      console.log('Permission for notifications was denied');
      return false;
    }

    // Get the token for this device
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    return true;
  } catch (error) {
    console.error('Error requesting notification permissions:', error);
    return false;
  }
};

/**
 * Send push token to server
 * @param {string} token The push token to send
 * @returns {Promise<boolean>} Whether the token was successfully sent
 */
export const sendPushTokenToServer = async (token: string): Promise<boolean> => {
  try {
    const userToken = await AsyncStorage.getItem('userToken');
    if (!userToken) {
      console.log('User not authenticated, cannot send push token');
      return false;
    }

    const response = await fetch(`${API_CONFIG.BASE_URL}/api/notifications/register-device/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${userToken}`,
      },
      body: JSON.stringify({
        token: token,
        device_type: Platform.OS,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to register push token: ${response.status}`);
    }

    console.log('Push token successfully registered with server');
    return true;
  } catch (error) {
    console.error('Error sending push token to server:', error);
    return false;
  }
};

/**
 * Register for push notifications
 * @returns {Promise<string|null>} The push token or null if registration failed
 */
export const registerForPushNotifications = async (): Promise<string | null> => {
  try {
    // Check if we have permission
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) {
      return null;
    }

    // Get the token
    const token = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    });

    // Store the token
    await AsyncStorage.setItem('pushToken', token.data);
    
    // Send the token to the server
    const sent = await sendPushTokenToServer(token.data);
    if (!sent) {
      console.warn('Failed to send push token to server. Notifications may not work when app is closed.');
    }
    
    console.log('Push token:', token.data);
    
    return token.data;
  } catch (error) {
    console.error('Error registering for push notifications:', error);
    return null;
  }
};

/**
 * Send a local notification
 * @param {MessageNotification} notification The notification to send
 * @returns {Promise<string>} The notification ID
 */
export const sendLocalNotification = async (
  notification: MessageNotification
): Promise<string> => {
  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        sound: true,
      },
      trigger: null, // Send immediately
    });
    return notificationId;
  } catch (error) {
    console.error('Error sending local notification:', error);
    throw error;
  }
};

/**
 * Add a notification listener
 * @param {Function} handler The function to call when a notification is received
 * @returns {Subscription} A subscription that you can call remove() on when you're done
 */
export const addNotificationListener = (
  handler: (notification: Notifications.Notification) => void
) => {
  return Notifications.addNotificationReceivedListener(handler);
};

/**
 * Add a notification response listener (when user taps on notification)
 * @param {Function} handler The function to call when a notification response is received
 * @returns {Subscription} A subscription that you can call remove() on when you're done
 */
export const addNotificationResponseListener = (
  handler: (response: Notifications.NotificationResponse) => void
) => {
  return Notifications.addNotificationResponseReceivedListener(handler);
};

/**
 * Get all delivered notifications
 * @returns {Promise<Notifications.Notification[]>} The delivered notifications
 */
export const getDeliveredNotifications = async () => {
  return await Notifications.getPresentedNotificationsAsync();
};

/**
 * Dismiss all notifications
 * @returns {Promise<void>}
 */
export const dismissAllNotifications = async () => {
  return await Notifications.dismissAllNotificationsAsync();
};