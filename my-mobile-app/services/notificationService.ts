
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// ======== ДЕДУПЛИКАЦИЯ СООБЩЕНИЙ ========
const recentMessages = new Map<string, number>();
const recentStatusUpdates = new Map<string, { status: string; timestamp: number }>();
const MESSAGE_DEDUPE_TIMEOUT = 5000; // 5 секунд
const STATUS_THROTTLE_TIMEOUT = 2000; // 2 секунды для статусов

// Функция для очистки старых сообщений
const cleanupOldMessages = () => {
  const now = Date.now();

  // Очистка дубликатов сообщений
  for (const [key, timestamp] of recentMessages.entries()) {
    if (now - timestamp > MESSAGE_DEDUPE_TIMEOUT) {
      recentMessages.delete(key);
    }
  }

  // Очистка статусных обновлений
  for (const [key, data] of recentStatusUpdates.entries()) {
    if (now - data.timestamp > STATUS_THROTTLE_TIMEOUT * 3) {
      recentStatusUpdates.delete(key);
    }
  }
};

// Функция для проверки дубликатов WebSocket сообщений
const isDuplicateMessage = (type: string, data: any): boolean => {
  const messageKey = `${type}_${JSON.stringify(data)}`;
  const now = Date.now();

  // Очищаем старые сообщения периодически
  if (Math.random() < 0.1) { // 10% шанс на очистку при каждом вызове
    cleanupOldMessages();
  }

  // Проверяем на дубликат
  if (recentMessages.has(messageKey)) {
    const lastTime = recentMessages.get(messageKey)!;
    if (now - lastTime < MESSAGE_DEDUPE_TIMEOUT) {
      return true; // Дубликат
    }
  }

  // Добавляем новое сообщение
  recentMessages.set(messageKey, now);
  return false;
};

// Функция для throttling статусных обновлений
const shouldProcessStatusUpdate = (userId: string, status: string): boolean => {
  const statusKey = `user_${userId}`;
  const now = Date.now();

  const lastUpdate = recentStatusUpdates.get(statusKey);

  // Если это первое обновление статуса для пользователя
  if (!lastUpdate) {
    recentStatusUpdates.set(statusKey, { status, timestamp: now });
    return true;
  }

  // Если статус изменился - всегда обрабатываем
  if (lastUpdate.status !== status) {
    recentStatusUpdates.set(statusKey, { status, timestamp: now });
    return true;
  }

  // Если тот же статус, но прошло достаточно времени
  if (now - lastUpdate.timestamp > STATUS_THROTTLE_TIMEOUT) {
    recentStatusUpdates.set(statusKey, { status, timestamp: now });
    return true;
  }

  // Игнорируем частые обновления одного и того же статуса
  return false;
};

// Функция для безопасной обработки ошибок
const getErrorDetails = (error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name
    };
  } else if (typeof error === 'string') {
    return {
      message: error,
      stack: undefined,
      name: 'StringError'
    };
  } else {
    return {
      message: String(error),
      stack: undefined,
      name: 'UnknownError'
    };
  }
};

// ======== НАСТРОЙКА УВЕДОМЛЕНИЙ ========
// Показываем локальные уведомления ТОЛЬКО для активного приложения
// Для закрытого приложения Firebase покажет системные уведомления автоматически
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const AppState = require('react-native').AppState;
    const isActive = AppState.currentState === 'active';

    if (isActive) {
      console.log('🔔 [EXPO] Showing local notification for active app');
    } else {
      console.log('🔔 [EXPO] Blocking local notification - Firebase will handle background notifications');
    }

    return {
      shouldShowBanner: isActive,
      shouldShowList: isActive, 
      shouldPlaySound: isActive,
      shouldSetBadge: true,
    };
  },
});

// Настройка Android каналов уведомлений
const setupAndroidNotificationChannels = async () => {
  try {
    // Канал для сообщений
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Сообщения',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default',
      enableVibrate: true,
      enableLights: true,
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
    });

    // Канал по умолчанию
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Основные уведомления',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default',
      enableVibrate: true,
      enableLights: true,
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch (error) {
    // Тихо обрабатываем ошибки
  }
};

// ======== ЭКСПОРТИРУЕМЫЕ ФУНКЦИИ ========
// Запрос разрешений на уведомления
export const requestNotificationPermissions = async (): Promise<boolean> => {
  try {
    if (!Device.isDevice) {
      return false;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Настраиваем каналы для Android перед запросом разрешений
    if (Platform.OS === 'android') {
      await setupAndroidNotificationChannels();
    }

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowDisplayInCarPlay: true,
          allowCriticalAlerts: false,
          allowProvisional: false,
        },
        android: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowDisplayInCarPlay: false,
        }
      });
      finalStatus = status;
    }

    return finalStatus === 'granted';
  } catch (error) {
    return false;
  }
};

// Регистрация для push уведомлений - ТОЛЬКО Firebase FCM
export const registerForPushNotifications = async (): Promise<string | null> => {
  try {
    if (!Device.isDevice) {
      console.log('🔥 [FCM] Not a physical device, skipping push notification setup');
      return null;
    }

    console.log('🔥 [FCM] Регистрация push-уведомлений ТОЛЬКО через Firebase FCM');

    // Используем Firebase сервис
    const FirebaseNotificationService = require('./firebaseNotificationService').default;
    const firebaseService = FirebaseNotificationService.getInstance();

    // Запрашиваем разрешения через Firebase
    const hasPermission = await firebaseService.requestPermissions();
    if (!hasPermission) {
      console.error('🔥 [FCM] Firebase permissions not granted');
      return null;
    }

    // Получаем FCM токен через Firebase сервис
    const token = await firebaseService.getToken();

    if (!token) {
      console.error('🔥 [FCM] Failed to get Firebase FCM token');
      return null;
    }

    // КРИТИЧНО: отклоняем любые Expo токены
    const isFCMToken = !token.startsWith('ExponentPushToken');
    if (!isFCMToken) {
      console.error('🔥 [FCM] ❌ Получен Expo токен вместо FCM - отклоняем');
      console.error('🔥 [FCM] ❌ Expo токены больше не поддерживаются');

      // Удаляем Expo токен из хранилища
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.removeItem('pushToken');
      await AsyncStorage.removeItem('pushTokenType');

      return null;
    }

    console.log('🔥 [FCM] ✅ Получен валидный Firebase FCM токен');
    console.log('🔥 [FCM] Token type: Native FCM, Length:', token.length);

    return token;

  } catch (error) {
    console.error('🔥 [FCM] Error in Firebase FCM registration:', getErrorDetails(error));
    return null;
  }
};


// Добавление слушателя уведомлений
export const addNotificationListener = (handler: (notification: Notifications.Notification) => void): Notifications.Subscription => {
  return Notifications.addNotificationReceivedListener(handler);
};

// Добавление слушателя ответов на уведомления
export const addNotificationResponseListener = (handler: (response: Notifications.NotificationResponse) => void): Notifications.Subscription => {
  return Notifications.addNotificationResponseReceivedListener(handler);
};

// Отправка уведомления высокого приоритета - только для активного приложения
export const sendHighPriorityNotification = async (notification: {
  title: string;
  body: string;
  data?: any;
}) => {
  try {
    const AppState = require('react-native').AppState;
    const isActive = AppState.currentState === 'active';

    if (!isActive) {
      console.log('🔔 [NOTIFICATION] Blocking local notification - app in background, Firebase will handle');
      return 'blocked-background-mode';
    }

    console.log('🔔 [NOTIFICATION] Creating notification for active app:', notification.title);

    const notificationContent: Notifications.NotificationContentInput = {
      title: notification.title,
      body: notification.body,
      data: notification.data,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
    };

    if (Platform.OS === 'android') {
      notificationContent.categoryIdentifier = 'messages';

      if (notification.data?.senderId) {
        notificationContent.badge = notification.data.senderId;
      }
      if (notification.data?.message_count > 1) {
        notificationContent.title = `${notification.title} (${notification.data.message_count})`;
      }

    } else if (Platform.OS === 'ios') {
      notificationContent.categoryIdentifier = 'messages';

      if (notification.data?.message_count && notification.data.message_count > 1) {
        notificationContent.subtitle = `+${notification.data.message_count - 1} сообщений`;
      }
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: notificationContent,
      trigger: null,
    });

    return notificationId;
  } catch (error) {
    throw error;
  }
};

// ======== WEBSOCKET ОБРАБОТЧИКИ ========
// Обработка WebSocket сообщений с дедупликацией
export const handleWebSocketMessage = (type: string, data: any): boolean => {
  // Специальная обработка для статусных обновлений
  if (type === 'user_status_update') {
    const { user_id, status } = data;

    if (!shouldProcessStatusUpdate(user_id, status)) {
      // Игнорируем частые обновления статуса
      return false;
    }

    return true;
  }

  // Проверяем на дубликат для других типов сообщений
  if (isDuplicateMessage(type, data)) {
    return false;
  }

  return true;
};

// Обработка различных типов WebSocket сообщений
export const processWebSocketMessage = (type: string, data: any) => {
  // Сначала проверяем на дубликаты
  if (!handleWebSocketMessage(type, data)) {
    return; // Сообщение отфильтровано
  }

  // Обрабатываем разные типы сообщений
  switch (type) {
    case 'user_status_update':
      handleUserStatusUpdate(data);
      break;

    case 'message_notification':
      handleMessageNotification(data);
      break;

    case 'typing_indicator':
      handleTypingIndicator(data);
      break;

    case 'initial_notification':
      handleInitialNotification(data);
      break;

    case 'notification_update':
      handleNotificationUpdate(data);
      break;
    case 'messages_by_sender_update':
      handleNotificationUpdate(data);
      break;

    default:
      break;
  }
};

// Обработка статусных обновлений пользователей
const handleUserStatusUpdate = (data: any) => {
  const { user_id, status } = data;
  // Здесь можно добавить логику обновления UI
};

// Обработка уведомлений о сообщениях
const handleMessageNotification = (data: any) => {
  const { sender_name, message_text, chat_id } = data;
  // Здесь можно добавить логику для обновления UI
};

// Обработка индикатора печатания
const handleTypingIndicator = (data: any) => {
  const { user_id, is_typing, chat_id } = data;

  // Для индикаторов печатания используем еще более короткий timeout
  const typingKey = `typing_${chat_id}_${user_id}`;
  const now = Date.now();

  const lastTyping = recentMessages.get(typingKey);
  if (lastTyping && now - lastTyping < 1000) { // 1 секунда для typing
    return; // Игнорируем частые обновления typing
  }

  recentMessages.set(typingKey, now);
};

// Обработка начальных уведомлений
const handleInitialNotification = (data: any) => {
  const { unique_sender_count, messages } = data;

  if (Array.isArray(messages) && messages.length >= 2) {
    const userInfo = messages[0]; // { user: userId }
    const messagesList = messages[1]; // Массив сообщений
    // Здесь можно добавить логику для обновления UI
  }
};

// Обработка обновлений уведомлений
const handleNotificationUpdate = (data: any) => {
  const { unique_sender_count, messages } = data;

  if (Array.isArray(messages) && messages.length >= 2) {
    const userInfo = messages[0]; // { user: userId }
    const messagesList = messages[1]; // Массив сообщений
    // Здесь можно добавить логику для обновления UI
  }
};

// Функция для очистки кеша (вызывать при закрытии приложения)
export const clearNotificationCache = () => {
  recentMessages.clear();
  recentStatusUpdates.clear();
};

// Обработка удаленных уведомлений
export const handleRemoteNotification = (notification: Notifications.Notification) => {
  const data = notification.request.content.data;
  const notificationKey = data?.notification_key ||
    `${notification.request.content.title}_${notification.request.content.body}_${Date.now()}`;

  // НЕ отправляйте локальные уведомления здесь!
  // Система уже показала уведомление
};