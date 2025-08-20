
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
// Настройка обработчика уведомлений
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    console.log('🔔 [Notification] Handler called:', {
      title: notification.request.content.title,
      body: notification.request.content.body,
    });

    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

// Настройка Android каналов уведомлений
const setupAndroidNotificationChannels = async () => {
  console.log('🤖 Setting up Android notification channels...');

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

    console.log('✅ Android notification channels configured successfully');
  } catch (error) {
    console.error('❌ Error setting up Android notification channels:', getErrorDetails(error));
  }
};

// ======== ЭКСПОРТИРУЕМЫЕ ФУНКЦИИ ========
// Запрос разрешений на уведомления
export const requestNotificationPermissions = async (): Promise<boolean> => {
  try {
    if (!Device.isDevice) {
      console.log('⚠️ Not a physical device, push notifications will not work');
      return false;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    console.log('📱 Current notification permission status:', existingStatus);

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

    console.log('📱 Final notification permission status:', finalStatus);
    return finalStatus === 'granted';
  } catch (error) {
    console.error('Error requesting notification permissions:', getErrorDetails(error));
    return false;
  }
};

// Регистрация для push уведомлений
export const registerForPushNotifications = async (): Promise<string | null> => {
  try {
    console.log('📱 [Push] Starting push token registration...');

    if (!Device.isDevice) {
      console.log('⚠️ [Push] Not a physical device, skipping push registration');
      return null;
    }

    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) {
      console.log('❌ [Push] No notification permissions granted');
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    console.log('🔑 [Push] EAS Project ID:', projectId);

    if (!projectId) {
      console.error('❌ [Push] No EAS project ID found');
      return null;
    }

    let token = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts && !token) {
      try {
        attempts++;
        console.log(`🔄 [Push] Attempt ${attempts}/${maxAttempts} to get push token`);

        // Добавляем таймаут для операции
        const tokenPromise = Notifications.getExpoPushTokenAsync({
          projectId: projectId,
        });

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Token request timeout')), 15000);
        });

        const tokenResponse = await Promise.race([tokenPromise, timeoutPromise]) as any;
        token = tokenResponse.data;
        console.log('✅ [Push] Successfully got Expo push token:', token.substring(0, 50) + '...');
        break;

      } catch (tokenError) {
        const errorDetails = getErrorDetails(tokenError);
        console.error(`❌ [Push] Attempt ${attempts} failed:`, errorDetails);

        // Специальная обработка Firebase ошибок
        if (errorDetails.message?.includes('Firebase') ||
            errorDetails.message?.includes('FCM') ||
            errorDetails.message?.includes('google-services')) {
          console.error('🔥 [Push] Firebase/FCM error detected');

          if (Platform.OS === 'android') {
            console.error('🤖 [Push] For Android production builds, FCM credentials are required');
            console.error('📖 [Push] Please check: https://docs.expo.dev/push-notifications/fcm-credentials/');
          }
        }

        if (errorDetails.message?.includes('timeout')) {
          console.error('⏱️ [Push] Request timed out, retrying...');
        }

        if (attempts === maxAttempts) {
          console.error('❌ [Push] All attempts failed. Cannot get push token.');
          return null;
        }

        // Экспоненциальная задержка между попытками
        const delay = Math.min(1000 * Math.pow(2, attempts), 10000);
        console.log(`⏳ [Push] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    if (!token) {
      console.error('❌ [Push] Failed to get push token after all attempts');
      return null;
    }

    return token;

  } catch (error) {
    const errorDetails = getErrorDetails(error);
    console.error('❌ [Push] Critical error in registerForPushNotifications:', errorDetails);
    return null;
  }
};

// Проверка настроек уведомлений
export const checkNotificationSettings = async () => {
  try {
    const settings = await Notifications.getPermissionsAsync();
    console.log('📱 Current notification settings:', settings);

    if (Platform.OS === 'android') {
      const channels = await Notifications.getNotificationChannelsAsync();
      console.log('🤖 Android notification channels:', channels);
    }

    return settings;
  } catch (error) {
    console.error('Error checking notification settings:', getErrorDetails(error));
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

// Отправка локального уведомления
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

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: notificationContent,
      trigger: null,
    });

    console.log(`📱 Local notification sent with ID: ${notificationId}`);
    return notificationId;
  } catch (error) {
    console.error('Error sending local notification:', getErrorDetails(error));
    throw error;
  }
};

// Отправка уведомления высокого приоритета
export const sendHighPriorityNotification = async (notification: {
  title: string;
  body: string;
  data?: any;
}) => {
  try {
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

    console.log(`📱 High priority notification sent with ID: ${notificationId}`);
    return notificationId;
  } catch (error) {
    console.error('❌ Error sending high priority notification:', getErrorDetails(error));
    throw error;
  }
};

// Функция для тестирования уведомлений
export const sendTestNotification = async () => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Тест уведомления 🔔",
        body: 'Это тестовое уведомление для проверки работы',
        data: { test: true },
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: { seconds: 1 },
    });
    console.log('✅ Test notification scheduled');
  } catch (error) {
    console.error('❌ Error sending test notification:', getErrorDetails(error));
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

    console.log(`👤 [Status] User ${user_id} is now ${status}`);
    return true;
  }

  // Проверяем на дубликат для других типов сообщений
  if (isDuplicateMessage(type, data)) {
    // Логируем дубликаты только для отладки
    if (__DEV__) {
      console.log(`🚫 [WebSocket] Duplicate message ignored: ${type}`);
    }
    return false;
  }

  // Логируем только уникальные сообщения
  console.log(`📨 [WebSocket] Processing message: ${type}`, data);
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

    default:
      console.log(`📨 [WebSocket] Unknown message type: ${type}`, data);
  }
};

// Обработка статусных обновлений пользователей
const handleUserStatusUpdate = (data: any) => {
  const { user_id, status } = data;

  // Здесь можно добавить логику обновления UI
  // Например, обновить индикатор онлайн статуса в списке пользователей

  console.log(`👤 [Status] Processing status update for user ${user_id}: ${status}`);
};

// Обработка уведомлений о сообщениях
const handleMessageNotification = (data: any) => {
  const { sender_name, message_text, chat_id } = data;

  console.log(`💬 [Message] New message from ${sender_name} in chat ${chat_id}`);

  // Здесь можно добавить логику для обновления UI
  // Например, обновить счетчик непрочитанных сообщений
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
  console.log(`⌨️ [Typing] User ${user_id} ${is_typing ? 'started' : 'stopped'} typing in chat ${chat_id}`);
};

// Обработка начальных уведомлений
const handleInitialNotification = (data: any) => {
  const { unique_sender_count, messages } = data;

  console.log(`🔔 [Initial] Received initial notifications: ${unique_sender_count} unique senders`);

  if (Array.isArray(messages) && messages.length >= 2) {
    const userInfo = messages[0]; // { user: userId }
    const messagesList = messages[1]; // Массив сообщений

    if (Array.isArray(messagesList) && messagesList.length > 0) {
      console.log(`📬 [Initial] Processing ${messagesList.length} notification messages`);

      // Здесь можно добавить логику для обновления UI
      // Например, обновить счетчик непрочитанных сообщений
      messagesList.forEach((message, index) => {
        if (message && typeof message === 'object') {
          console.log(`📨 [Initial] Message ${index + 1}:`, {
            sender: message.sender_name || message.sender_id,
            count: message.count,
            lastMessage: message.last_message,
            chatId: message.chat_id
          });
        }
      });
    }
  }
};

// Обработка обновлений уведомлений
const handleNotificationUpdate = (data: any) => {
  const { unique_sender_count, messages } = data;

  console.log(`🔔 [Update] Received notification update: ${unique_sender_count} unique senders`);

  if (Array.isArray(messages) && messages.length >= 2) {
    const userInfo = messages[0]; // { user: userId }
    const messagesList = messages[1]; // Массив сообщений

    if (Array.isArray(messagesList) && messagesList.length > 0) {
      console.log(`📬 [Update] Processing ${messagesList.length} updated messages`);

      // Здесь можно добавить логику для обновления UI
      messagesList.forEach((message, index) => {
        if (message && typeof message === 'object') {
          console.log(`📨 [Update] Message ${index + 1}:`, {
            sender: message.sender_name || message.sender_id,
            count: message.count,
            lastMessage: message.last_message,
            chatId: message.chat_id
          });
        }
      });
    }
  }
};

// Функция для очистки кеша (вызывать при закрытии приложения)
export const clearNotificationCache = () => {
  recentMessages.clear();
  recentStatusUpdates.clear();
  console.log('🧹 [WebSocket] Message cache cleared');
};

// Функция для получения статистики дедупликации
export const getDeduplicationStats = () => {
  cleanupOldMessages(); // Очистка перед подсчетом

  return {
    cachedMessages: recentMessages.size,
    cachedStatuses: recentStatusUpdates.size,
    oldestMessage: recentMessages.size > 0 ? Math.min(...Array.from(recentMessages.values())) : 0,
    newestMessage: recentMessages.size > 0 ? Math.max(...Array.from(recentMessages.values())) : 0,
  };
};

// Обработка удаленных уведомлений
export const handleRemoteNotification = (notification: Notifications.Notification) => {
  const data = notification.request.content.data;
  const notificationKey = data?.notification_key ||
    `${notification.request.content.title}_${notification.request.content.body}_${Date.now()}`;

  console.log('📱 [Push] Remote notification received:', {
    key: notificationKey,
    title: notification.request.content.title,
    body: notification.request.content.body,
    data: data,
  });

  // НЕ отправляйте локальные уведомления здесь!
  // Система уже показала уведомление
};