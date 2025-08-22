import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_CONFIG } from '../config';
import { 
  requestPermission, 
  getToken, 
  onMessage, 
  onTokenRefresh,
  getInitialNotification,
  onNotificationOpenedApp,
  setBackgroundMessageHandler,
  isDeviceRegisteredForRemoteMessages,
  registerDeviceForRemoteMessages,
  AuthorizationStatus 
} from '@react-native-firebase/messaging';

/**
 * Умный Firebase сервис с fallback на Expo Notifications
 * Автоматически переключается между Firebase и Expo в зависимости от доступности
 */
class FirebaseNotificationService {
  private static instance: FirebaseNotificationService;
  private isFirebaseAvailable = false;
  private navigationRef: any = null;
  private messageHandlers: Array<(message: any) => void> = [];
  private isInitialized = false;
  private lastNavigationTime = 0;
  private lastChatId: string | null = null;
  private static navigationInProgress = false;
  private static lastGlobalNavigation = 0;

  public static getInstance(): FirebaseNotificationService {
    if (!FirebaseNotificationService.instance) {
      FirebaseNotificationService.instance = new FirebaseNotificationService();
    }
    return FirebaseNotificationService.instance;
  }

  constructor() {
    this.initFirebase();
  }

  // Инициализация Firebase
  private async initFirebase() {
    try {
      // Проверяем доступность Firebase модулей
      const isFirebaseModuleAvailable = typeof requestPermission === 'function';

      if (!isFirebaseModuleAvailable) {
        throw new Error('Firebase modules not available');
      }

      // Проверка разрешений Firebase
      const authStatus = await requestPermission();
      const hasFirebasePermissions = 
        authStatus === AuthorizationStatus.AUTHORIZED || 
        authStatus === AuthorizationStatus.PROVISIONAL;

      if (!hasFirebasePermissions) {
        throw new Error('Firebase permissions not granted');
      }

      this.isFirebaseAvailable = true;
      console.log('🔥 [FCM] Firebase messaging is available');

      // Настройка фонового обработчика с улучшенным логированием
      setBackgroundMessageHandler(async (remoteMessage: any) => {
        console.log('🔥 [FCM] Background message received:', {
          messageId: remoteMessage.messageId,
          from: remoteMessage.from,
          data: remoteMessage.data,
          notification: remoteMessage.notification
        });

        try {
          await this.handleBackgroundMessage(remoteMessage);
        } catch (bgError) {
          console.error('🔥 [FCM] Background message handler error:', bgError);
        }
      });

      console.log('🔥 [FCM] Background message handler configured');

    } catch (error) {
      this.isFirebaseAvailable = false;
      console.log('📱 [EXPO] Firebase not available, using Expo fallback');
      console.log('📱 [EXPO] Firebase init error:', error);
    }
  }

  // Обработка фоновых сообщений
  private async handleBackgroundMessage(remoteMessage: any) {
    try {
      console.log('🔥 [FCM] Processing background message:', {
        messageId: remoteMessage.messageId,
        data: remoteMessage.data,
        notification: remoteMessage.notification,
        timestamp: new Date().toISOString()
      });

      // Сохраняем информацию о новом сообщении без создания дополнительного уведомления
      if (remoteMessage.data?.type === 'message_notification') {
        await AsyncStorage.setItem('lastBackgroundMessage', JSON.stringify({
          chatId: remoteMessage.data.chatId,
          senderId: remoteMessage.data.senderId,
          timestamp: Date.now(),
          processed: false,
          messageId: remoteMessage.messageId
        }));

        console.log('🔥 [FCM] Background message info saved to storage (no duplicate notification created)');
      }

      // Увеличиваем счётчик бейджа
      try {
        const Notifications = require('expo-notifications');
        const currentBadge = await Notifications.getBadgeCountAsync();
        await Notifications.setBadgeCountAsync(currentBadge + 1);
      } catch (badgeError) {
        console.log('🔥 [FCM] Badge update error:', badgeError);
      }

    } catch (error) {
      console.error('🔥 [FCM] Error handling background message:', error);
    }
  }

  // Запрос разрешений с Firebase приоритетом
  async requestPermissions(): Promise<boolean> {
    console.log('🔔 [PUSH] Requesting permissions...');

    // Приоритет Firebase
    if (this.isFirebaseAvailable) {
      try {
        const authStatus = await requestPermission();
        const enabled =
          authStatus === AuthorizationStatus.AUTHORIZED ||
          authStatus === AuthorizationStatus.PROVISIONAL;

        if (enabled && Platform.OS === 'ios') {
          const isRegistered = await isDeviceRegisteredForRemoteMessages();
          if (!isRegistered) {
            await registerDeviceForRemoteMessages();
          }
        }

        console.log('🔥 [FCM] Firebase permissions granted:', enabled);
        return enabled;
      } catch (error) {
        console.log('🔥 [FCM] Firebase permissions failed:', error);
      }
    }

    // Fallback на Expo
    try {
      const Notifications = require('expo-notifications');
      const { status } = await Notifications.requestPermissionsAsync();
      const enabled = status === 'granted';
      console.log('📱 [EXPO] Expo permissions granted:', enabled);
      return enabled;
    } catch (error) {
      console.log('🔔 [PUSH] All permission requests failed:', error);
      return false;
    }
  }

  // Получение FCM токена с fallback и кэшированием
  async getToken(): Promise<string | null> {
    console.log('🔔 [PUSH] Getting push token...');

    // Сначала проверяем кэшированный токен
    try {
      const cachedFCMToken = await AsyncStorage.getItem('fcmToken');
      const cachedExpoToken = await AsyncStorage.getItem('pushToken');
      const tokenType = await AsyncStorage.getItem('pushTokenType');

      // Если есть кэшированный FCM токен и Firebase доступен
      if (cachedFCMToken && this.isFirebaseAvailable && tokenType === 'fcm') {
        console.log('🔥 [FCM] ✅ Using cached FCM token:', cachedFCMToken.substring(0, 20) + '...');
        return cachedFCMToken;
      }

      // Если есть кэшированный Expo токен
      if (cachedExpoToken && tokenType === 'expo') {
        console.log('📱 [EXPO] ✅ Using cached Expo token:', cachedExpoToken.substring(0, 20) + '...');
        return cachedExpoToken;
      }
    } catch (error) {
      console.log('🔔 [PUSH] Error reading cached token:', error);
    }

    // Если кэша нет - запрашиваем новый токен
    console.log('🔔 [PUSH] No cached token found, requesting new one...');

    // Приоритет Firebase FCM
    if (this.isFirebaseAvailable) {
      try {
        // Убеждаемся, что устройство зарегистрировано для iOS
        if (Platform.OS === 'ios') {
          const isRegistered = await isDeviceRegisteredForRemoteMessages();
          if (!isRegistered) {
            console.log('🔥 [FCM] Registering device for remote messages...');
            await registerDeviceForRemoteMessages();
          }
        }

        console.log('🔥 [FCM] Requesting new FCM token...');
        const fcmToken = await getToken();

        if (fcmToken) {
          console.log('🔥 [FCM] ✅ Got new native FCM token:', fcmToken.substring(0, 20) + '...');

          // Сохраняем токен локально
          await AsyncStorage.setItem('fcmToken', fcmToken);
          await AsyncStorage.setItem('pushTokenType', 'fcm');

          // Удаляем старый Expo токен если есть
          await AsyncStorage.removeItem('pushToken');

          return fcmToken;
        } else {
          console.log('🔥 [FCM] ❌ FCM token is null');
        }
      } catch (error) {
        console.log('🔥 [FCM] ❌ FCM token error:', error);
        // Проверяем специфичные ошибки Firebase
        if (error && typeof error === 'object') {
          const errorStr = String(error);
          if (errorStr.includes('MISSING_INSTANCEID_SERVICE') || 
              errorStr.includes('SERVICE_NOT_AVAILABLE')) {
            console.log('🔥 [FCM] Firebase service not properly configured');
          }
        }
      }
    }

    // Fallback на Expo
    try {
      console.log('📱 [EXPO] Falling back to new Expo token...');
      const Notifications = require('expo-notifications');

      const tokenResponse = await Notifications.getExpoPushTokenAsync({
        projectId: '7a408a11-ebbd-48ac-8f31-e0eb0f1bf1d7'
      });

      const expoToken = tokenResponse.data;
      if (expoToken) {
        console.log('📱 [EXPO] ✅ Got new Expo token:', expoToken.substring(0, 20) + '...');
        console.log('⚠️ [WARNING] Using Expo token - background notifications may be limited');

        // Сохраняем токен локально
        await AsyncStorage.setItem('pushToken', expoToken);
        await AsyncStorage.setItem('pushTokenType', 'expo');

        // Удаляем старый FCM токен если есть
        await AsyncStorage.removeItem('fcmToken');

        return expoToken;
      }
    } catch (error) {
      console.log('📱 [EXPO] ❌ Expo token failed:', error);
    }

    console.log('🔔 [PUSH] ❌ No push token available');
    return null;
  }

  // Отправка токена на сервер с проверкой дубликатов
  async saveTokenToServer(token: string): Promise<boolean> {
    try {
      // Проверяем, не отправляли ли мы уже этот токен
      const lastSentToken = await AsyncStorage.getItem('lastSentToken');
      const lastSentTime = await AsyncStorage.getItem('tokenSentAt');

      if (lastSentToken === token && lastSentTime) {
        const timeSince = Date.now() - parseInt(lastSentTime);
        // Если токен тот же и отправлен менее 24 часов назад - пропускаем
        if (timeSince < 24 * 60 * 60 * 1000) {
          console.log('🔥 [Firebase] ✅ Token already sent recently, skipping...');
          return true;
        }
      }

      console.log('🔥 [Firebase] Saving token to server...');

      const userToken = await AsyncStorage.getItem('userToken');
      if (!userToken) {
        console.error('🔥 [Firebase] No auth token found');
        return false;
      }

      // Определяем тип токена
      const isFirebaseToken = !token.startsWith('ExponentPushToken');
      const payload = isFirebaseToken
        ? { fcm_token: token }
        : { expo_push_token: token };

      console.log('🔥 [Firebase] Sending payload:', {
        type: isFirebaseToken ? 'FCM' : 'Expo',
        tokenLength: token.length
      });

      const response = await axios.post(
        `${API_CONFIG.BASE_URL}/chat/api/save-push-token/`,
        payload,
        {
          headers: { 'Authorization': `Token ${userToken}` },
          timeout: 10000
        }
      );

      const success = response.status === 200;
      console.log('🔥 [Firebase] Token save result:', success);

      if (success) {
        // Сохраняем информацию об успешной отправке
        await AsyncStorage.setItem('tokenSentToServer', 'true');
        await AsyncStorage.setItem('tokenSentAt', Date.now().toString());
        await AsyncStorage.setItem('lastSentToken', token);
      }

      return success;
    } catch (error) {
      console.error('🔥 [Firebase] Save token error:', error);
      return false;
    }
  }

  // Настройка обработчиков уведомлений
  private setupNotificationListeners(): void {
    if (!this.isFirebaseAvailable) {
      this.setupExpoListeners();
      return;
    }

    try {
      console.log('🔥 [FCM] Setting up Firebase listeners...');

      // Настраиваем единый обработчик уведомлений для Firebase
      const Notifications = require('expo-notifications');
      Notifications.setNotificationHandler({
        handleNotification: async (notification: any) => {
          console.log('🔥 [FCM] Handling Firebase notification display:', notification.request.identifier);

          // Для Firebase уведомлений в фоне - не показываем дублирующие уведомления
          const isBackground = notification.request.content.data?.fromBackground === true;

          return {
            shouldShowList: !isBackground, // Не показываем если это фоновое уведомление
            shouldPlaySound: true,
            shouldSetBadge: true,
            shouldShowBanner: !isBackground,
          };
        },
      });

      // Обработка уведомлений на переднем плане
      onMessage(async (remoteMessage: any) => {
        console.log('🔥 [FCM] Foreground message received:', remoteMessage);

        const messageData = {
          title: remoteMessage.notification?.title || 'Новое сообщение',
          body: remoteMessage.notification?.body || '',
          data: remoteMessage.data || {},
          isFirebase: true
        };

        // Вызываем все зарегистрированные обработчики
        this.messageHandlers.forEach(handler => {
          try {
            handler(messageData);
          } catch (error) {
            console.error('🔥 [Firebase] Error in message handler:', error);
          }
        });

        // Показываем локальное уведомление если нужно
        if (remoteMessage.data?.type === 'message_notification') {
          await this.showLocalNotification(messageData);
        }
      });

      // Обработка открытия приложения через уведомление
      onNotificationOpenedApp((remoteMessage: any) => {
        console.log('🔥 [FCM] Notification opened app:', remoteMessage);
        this.handleNotificationTap(remoteMessage);
      });

      // Проверка начального уведомления (если приложение было закрыто)
      getInitialNotification()
        .then((remoteMessage: any) => {
          if (remoteMessage) {
            console.log('🔥 [FCM] Initial notification:', remoteMessage);
            // Добавляем небольшую задержку для инициализации навигации
            setTimeout(() => {
              this.handleNotificationTap(remoteMessage);
            }, 2000);
          }
        });

      // Обработка обновления токена
      onTokenRefresh(async (token: string) => {
        console.log('🔥 [FCM] Token refreshed:', token.substring(0, 20) + '...');
        await AsyncStorage.setItem('fcmToken', token);
        await this.saveTokenToServer(token);
      });

      console.log('🔥 [FCM] Firebase listeners configured');

    } catch (error) {
      console.error('🔥 [Firebase] Error setting up Firebase listeners:', error);
      this.setupExpoListeners();
    }
  }

  // Fallback Expo слушатели
  private setupExpoListeners(): void {
    try {
      const Notifications = require('expo-notifications');

      Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          console.log('📱 [EXPO] Handling notification display:', notification.request.identifier);
          return {
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
            shouldShowBanner: true,
          };
        },
      });

      // Слушатель уведомлений
      Notifications.addNotificationReceivedListener((notification: any) => {
        console.log('📱 [EXPO] Expo notification received:', notification);

        // Правильно извлекаем данные
        let notificationData = notification.request?.content?.data || {};

        // Если данные в старом формате dataString, парсим их
        if (typeof notificationData === 'string') {
          try {
            notificationData = JSON.parse(notificationData);
          } catch (parseError) {
            console.warn('📱 [EXPO] Failed to parse notification dataString:', parseError);
            notificationData = {};
          }
        }

        const messageData = {
          title: notification.request?.content?.title || 'Новое сообщение',
          body: notification.request?.content?.body || '',
          data: notificationData,
          isFirebase: false
        };

        this.messageHandlers.forEach(handler => {
          try {
            handler(messageData);
          } catch (error) {
            console.error('📱 [EXPO] Error in Expo message handler:', error);
          }
        });
      });

      // Слушатель нажатий на уведомления
      Notifications.addNotificationResponseReceivedListener((response: any) => {
        console.log('📱 [EXPO] Expo notification response:', response);

        // Извлекаем данные правильно
        let responseData = response.notification?.request?.content?.data || {};
        if (typeof responseData === 'string') {
          try {
            responseData = JSON.parse(responseData);
          } catch (parseError) {
            console.warn('📱 [EXPO] Failed to parse response dataString:', parseError);
            responseData = {};
          }
        }

        this.handleNotificationTap({ data: responseData });
      });

      console.log('📱 [EXPO] Expo listeners set up');
    } catch (error) {
      console.log('🔔 [PUSH] No notification listeners available:', error);
    }
  }

  // Публичный метод для инициализации сервиса
  async initialize(): Promise<{ success: boolean; token?: string | null; tokenType?: string; error?: any }> {
    try {
      console.log('🔥 [Firebase] Initializing notification service...');

      // Запрашиваем разрешения
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        return { success: false, error: 'Permission denied' };
      }

      // Получаем токен
      const token = await this.getToken();
      if (!token) {
        return { success: false, error: 'No token received' };
      }

      // ВАЖНО: Определяем реальный тип токена
      const isRealFirebaseToken = !token.startsWith('ExponentPushToken');
      const tokenType = isRealFirebaseToken ? 'Native Firebase FCM' : 'Expo (Firebase unavailable)';

      console.log(`🔔 [TOKEN TYPE] ${tokenType}`);
      console.log(`🔔 [TOKEN] ${token.substring(0, 30)}...`);

      if (!isRealFirebaseToken) {
        console.warn('⚠️ [WARNING] Using Expo token - Firebase FCM not available in this build');
        console.warn('⚠️ [WARNING] Background notifications will be limited');
      } else {
        console.log('🔥 [FCM] ✅ Native Firebase FCM token detected!');
      }

      // Сохраняем токен на сервере
      const tokenSaved = await this.saveTokenToServer(token);
      if (!tokenSaved) {
        console.warn('🔥 [Firebase] Token not saved to server, but continuing...');
      }

      // Настраиваем слушатели
      this.setupNotificationListeners();

      this.isInitialized = true;

      console.log(`🔥 [Firebase] ✅ Notifications initialized successfully with ${tokenType}`);

      return { success: true, token, tokenType: isRealFirebaseToken ? 'fcm' : 'expo' };

    } catch (error) {
      console.error('🔥 [Firebase] Initialization error:', error);
      return { success: false, error };
    }
  }

  // Метод для добавления обработчиков сообщений
  addMessageHandler(handler: (message: any) => void): void {
    this.messageHandlers.push(handler);
  }

  // Метод для установки навигационной ссылки
  setNavigationRef(ref: any): void {
    this.navigationRef = ref;
  }

  // Обработка нажатия на уведомление - ОТКЛЮЧЕНА
  private handleNotificationTap(message: any) {
    try {
      const data = message.data || message;
      console.log('🔥 [Firebase] ⚠️ Notification tap received but NAVIGATION DISABLED in Firebase service');
      console.log('🔥 [Firebase] Data:', JSON.stringify(data));
      console.log('🔥 [Firebase] Navigation will be handled by NotificationContext only');

      // НE делаем навигацию - только логируем для отладки
      if (data.type === 'message_notification' && data.chatId) {
        console.log('🔥 [Firebase] Would navigate to chat:', data.chatId, 'but navigation is disabled here');
      }
    } catch (error) {
      console.error('🔥 [Firebase] Error processing notification tap:', error);
    }
  }

  // Показ локального уведомления
  private async showLocalNotification(messageData: any) {
    try {
      const Notifications = require('expo-notifications');

      await Notifications.scheduleNotificationAsync({
        content: {
          title: messageData.title,
          body: messageData.body,
          data: messageData.data,
          sound: 'default',
        },
        trigger: null,
      });
    } catch (error) {
      console.log('🔥 [Firebase] Could not show local notification:', error);
    }
  }

  // Проверка отложенной навигации
  private async checkPendingNavigation() {
    try {
      const pendingNavigation = await AsyncStorage.getItem('pendingNavigation');
      if (pendingNavigation) {
        const navData = JSON.parse(pendingNavigation);

        // Проверяем, что навигация не слишком старая (максимум 5 минут)
        if (Date.now() - navData.timestamp < 300000) {
          setTimeout(() => {
            if (this.navigationRef?.current) {
              this.navigationRef.current.navigate(navData.screen, navData.params);
              AsyncStorage.removeItem('pendingNavigation');
            }
          }, 1000);
        } else {
          AsyncStorage.removeItem('pendingNavigation');
        }
      }
    } catch (error) {
      console.log('🔥 [Firebase] Error checking pending navigation:', error);
    }
  }

  // Публичные методы

  // Удаление обработчика сообщений
  removeMessageHandler(handler: (message: any) => void): void {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
      console.log('🔥 [Firebase] Message handler removed, total:', this.messageHandlers.length);
    }
  }

  // Получение статуса
  async getStatus(): Promise<{
    hasPermission: boolean;
    token: string | null;
    isEnabled: boolean;
    type: 'fcm' | 'expo' | null;
  }> {
    try {
      const fcmToken = await AsyncStorage.getItem('fcmToken');
      const expoToken = await AsyncStorage.getItem('pushToken');
      const tokenType = await AsyncStorage.getItem('pushTokenType') as 'fcm' | 'expo' | null;

      const token = fcmToken || expoToken;
      const hasPermission = !!token;

      return {
        hasPermission,
        token,
        isEnabled: hasPermission,
        type: tokenType
      };
    } catch (error) {
      return {
        hasPermission: false,
        token: null,
        isEnabled: false,
        type: null
      };
    }
  }

  // Обновление токена принудительно
  async refreshToken(): Promise<string | null> {
    console.log('🔥 [Firebase] Manually refreshing token...');
    const token = await this.getToken();
    if (token) {
      await this.saveTokenToServer(token);
    }
    return token;
  }
}

export default FirebaseNotificationService;