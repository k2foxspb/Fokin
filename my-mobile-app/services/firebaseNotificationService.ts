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
  AuthorizationStatus,
  FirebaseMessagingTypes
} from '@react-native-firebase/messaging';

// Интерфейсы для типизации
interface MessageData {
  title: string;
  body: string;
  data: Record<string, any>;
  isFirebase: boolean;
}

interface RemoteMessage {
  messageId?: string;
  from?: string;
  data?: Record<string, any>;
  notification?: {
    title?: string;
    body?: string;
    sound?: string;
  };
}

interface BackgroundMessageInfo {
  chatId: string;
  senderId: string;
  timestamp: number;
  processed: boolean;
  messageId: string;
}

interface NotificationStatus {
  hasPermission: boolean;
  token: string | null;
  isEnabled: boolean;
  type: 'fcm' | 'expo' | null;
}

interface InitResult {
  success: boolean;
  token?: string | null;
  tokenType?: string;
  error?: any;
}

type MessageHandler = (message: MessageData) => void;
type NavigationRef = any; // Можно заменить на конкретный тип навигации если известен

/**
 * Умный Firebase сервис с fallback на Expo Notifications
 * Автоматически переключается между Firebase и Expo в зависимости от доступности
 */
class FirebaseNotificationService {
  private static instance: FirebaseNotificationService;
  private isFirebaseAvailable: boolean = false;
  private navigationRef: NavigationRef = null;
  private messageHandlers: MessageHandler[] = [];
  private isInitialized: boolean = false;
  private lastNavigationTime: number = 0;
  private lastChatId: string | null = null;
  private static navigationInProgress: boolean = false;
  private static lastGlobalNavigation: number = 0;

  public static getInstance(): FirebaseNotificationService {
    if (!FirebaseNotificationService.instance) {
      FirebaseNotificationService.instance = new FirebaseNotificationService();
    }
    return FirebaseNotificationService.instance;
  }

  constructor() {
    this.initFirebase();
  }

  // Инициализация Firebase с улучшенной диагностикой
  private async initFirebase(): Promise<void> {
    try {
      console.log('🔥 [FCM] === STARTING FIREBASE INITIALIZATION ===');
      console.log('🔥 [FCM] Platform:', Platform.OS);

      // Проверяем, что Firebase App инициализирован
      try {
        const firebase = require('@react-native-firebase/app').default;
        console.log('🔥 [FCM] Firebase App module imported successfully');

        // Проверяем конфигурацию Firebase
        const app = firebase.app();
        console.log('🔥 [FCM] Firebase App Name:', app.name);
        console.log('🔥 [FCM] Firebase Project ID:', app.options.projectId);

        // Дополнительная проверка для Android
        if (Platform.OS === 'android') {
          console.log('🔥 [FCM] Android Package Name:', app.options.appId);
          if (!app.options.projectId || !app.options.appId) {
            throw new Error('Missing Firebase Android configuration');
          }
        }

        // Дополнительная проверка для iOS  
        if (Platform.OS === 'ios') {
          console.log('🔥 [FCM] iOS Bundle ID:', app.options.appId);
          if (!app.options.projectId || !app.options.appId) {
            console.warn('🔥 [FCM] ⚠️ iOS Firebase configuration may be incomplete');
          }
        }

        // Проверяем статус Firebase App
        const apps = firebase.apps;
        console.log('🔥 [FCM] Firebase apps count:', apps.length);

        if (apps.length === 0) {
          console.error('🔥 [FCM] ❌ No Firebase apps found - initialization failed');
          console.error('🔥 [FCM] ❌ Проверьте google-services.json/GoogleService-Info.plist');
          throw new Error('Firebase App not initialized');
        }

        const defaultApp = firebase.app();
        console.log('🔥 [FCM] Firebase App name:', defaultApp.name);
        console.log('🔥 [FCM] Firebase App options:', defaultApp.options);

      } catch (appError: unknown) {
        console.error('🔥 [FCM] ❌ Firebase App initialization error:', appError);
        throw new Error(`Firebase App failed: ${appError}`);
      }

      // Проверяем доступность Messaging модулей
      console.log('🔥 [FCM] Checking Firebase Messaging modules...');

      const isRequestPermissionAvailable = typeof requestPermission === 'function';
      const isGetTokenAvailable = typeof getToken === 'function';

      console.log('🔥 [FCM] requestPermission available:', isRequestPermissionAvailable);
      console.log('🔥 [FCM] getToken available:', isGetTokenAvailable);

      if (!isRequestPermissionAvailable || !isGetTokenAvailable) {
        console.error('🔥 [FCM] ❌ Firebase Messaging functions not available');
        console.error('🔥 [FCM] ❌ Проверьте установку @react-native-firebase/messaging');
        throw new Error('Firebase Messaging modules not available');
      }

      // Для Android - пропускаем проверку разрешений на этапе инициализации
      if (Platform.OS === 'android') {
        console.log('🔥 [FCM] Android detected - skipping permission check during init');
        this.isFirebaseAvailable = true;
      } else {
        // Для iOS - проверяем разрешения
        console.log('🔥 [FCM] iOS detected - checking permissions...');
        try {
          const authStatus = await requestPermission();
          const hasFirebasePermissions = 
            authStatus === AuthorizationStatus.AUTHORIZED || 
            authStatus === AuthorizationStatus.PROVISIONAL;

          console.log('🔥 [FCM] iOS permission status:', authStatus);

          if (!hasFirebasePermissions) {
            console.warn('🔥 [FCM] iOS permissions not granted, but continuing initialization');
          }

          this.isFirebaseAvailable = true;
        } catch (permError) {
          console.error('🔥 [FCM] iOS permission check failed:', permError);
          throw new Error(`iOS permissions failed: ${permError}`);
        }
      }

      console.log('🔥 [FCM] ✅ Firebase messaging is available');

      // Настройка фонового обработчика
      try {
        setBackgroundMessageHandler(async (remoteMessage: FirebaseMessagingTypes.RemoteMessage) => {
          console.log('🔥 [FCM] Background message received:', {
            messageId: remoteMessage.messageId,
            from: remoteMessage.from,
            data: remoteMessage.data,
            notification: remoteMessage.notification
          });

          try {
            await this.handleBackgroundMessage(remoteMessage);
          } catch (bgError: unknown) {
            console.error('🔥 [FCM] Background message handler error:', bgError);
          }
        });

        console.log('🔥 [FCM] ✅ Background message handler configured');
      } catch (bgHandlerError) {
        console.error('🔥 [FCM] Background handler setup failed:', bgHandlerError);
      }

      console.log('🔥 [FCM] === FIREBASE INITIALIZATION COMPLETED ===');

    } catch (error) {
      this.isFirebaseAvailable = false;
      console.error('🔥 [FCM] ❌ Firebase initialization failed:', error);
      console.error('🔥 [FCM] ❌ Детали ошибки:', String(error));
      console.error('🔥 [FCM] ❌ Push-уведомления через FCM недоступны');

      // Подробная диагностика
      this.diagnoseFirebaseIssue(error);
    }
  }

  // Обработка фоновых сообщений
  private async handleBackgroundMessage(remoteMessage: FirebaseMessagingTypes.RemoteMessage): Promise<void> {
    try {
      console.log('🔥 [FCM] Processing background message:', {
        messageId: remoteMessage.messageId,
        data: remoteMessage.data,
        notification: remoteMessage.notification,
        timestamp: new Date().toISOString()
      });

      // Сохраняем информацию о новом сообщении без создания дополнительного уведомления
      if (remoteMessage.data?.type === 'message_notification') {
        const messageInfo: BackgroundMessageInfo = {
          chatId: remoteMessage.data.chatId,
          senderId: remoteMessage.data.senderId,
          timestamp: Date.now(),
          processed: false,
          messageId: remoteMessage.messageId || ''
        };

        await AsyncStorage.setItem('lastBackgroundMessage', JSON.stringify(messageInfo));
        console.log('🔥 [FCM] Background message info saved to storage (no duplicate notification created)');
      }

      // Увеличиваем счётчик бейджа
      try {
        const Notifications = require('expo-notifications');
        const currentBadge: number = await Notifications.getBadgeCountAsync();
        await Notifications.setBadgeCountAsync(currentBadge + 1);
      } catch (badgeError: unknown) {
        console.log('🔥 [FCM] Badge update error:', badgeError);
      }

    } catch (error: unknown) {
      console.error('🔥 [FCM] Error handling background message:', error);
    }
  }

  // Диагностика проблем Firebase
  private diagnoseFirebaseIssue(error: unknown): void {
    const errorStr = String(error);

    console.log('🔥 [FCM] 🔍 ДИАГНОСТИКА FIREBASE:');

    if (errorStr.includes('Firebase App not initialized')) {
      console.error('🔥 [FCM] 💡 РЕШЕНИЕ: Проверьте файлы конфигурации Firebase');
      console.error('🔥 [FCM]   Android: my-mobile-app/google-services.json');
      console.error('🔥 [FCM]   iOS: my-mobile-app/GoogleService-Info.plist');
      console.error('🔥 [FCM]   Bundle ID должен совпадать в Firebase Console');
    } else if (errorStr.includes('SERVICE_NOT_AVAILABLE')) {
      console.error('🔥 [FCM] 💡 РЕШЕНИЕ: Firebase сервис недоступен');
      console.error('🔥 [FCM]   1. Проверьте интернет соединение');
      console.error('🔥 [FCM]   2. Убедитесь что Firebase проект активен');
      console.error('🔥 [FCM]   3. Проверьте ограничения Firebase Console');
    } else if (errorStr.includes('MISSING_INSTANCEID_SERVICE')) {
      console.error('🔥 [FCM] 💡 РЕШЕНИЕ: Instance ID service не найден');
      console.error('🔥 [FCM]   1. Перезагрузите приложение');
      console.error('🔥 [FCM]   2. Проверьте правильность google-services.json');
      console.error('🔥 [FCM]   3. Убедитесь что Cloud Messaging API включен в Firebase');
    } else if (errorStr.includes('messaging not available')) {
      console.error('🔥 [FCM] 💡 РЕШЕНИЕ: @react-native-firebase/messaging не установлен');
      console.error('🔥 [FCM]   1. yarn add @react-native-firebase/messaging');
      console.error('🔥 [FCM]   2. npx pod-install (для iOS)');
      console.error('🔥 [FCM]   3. Перезагрузите приложение');
    }

    console.error('🔥 [FCM] 📋 Общие шаги решения проблем:');
    console.error('🔥 [FCM]   1. Убедитесь что Firebase проект настроен');
    console.error('🔥 [FCM]   2. Проверьте Bundle ID/Package name совпадают');
    console.error('🔥 [FCM]   3. Cloud Messaging API включен в Firebase Console');
    console.error('🔥 [FCM]   4. Перезагрузите приложение полностью');
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

  // Получение ТОЛЬКО FCM токена (без Expo fallback)
  async getToken(): Promise<string | null> {
    console.log('🔥 [FCM] Getting Firebase FCM token...');

    // Очищаем любые старые Expo токены при старте
    try {
      await AsyncStorage.removeItem('pushToken');
      const oldTokenType = await AsyncStorage.getItem('pushTokenType');
      if (oldTokenType === 'expo') {
        await AsyncStorage.removeItem('pushTokenType');
        console.log('🔥 [FCM] Удален старый Expo токен из кэша');
      }
    } catch (error) {
      console.log('🔥 [FCM] Error cleaning old tokens:', error);
    }

    // Проверяем кэшированный FCM токен
    try {
      const cachedFCMToken = await AsyncStorage.getItem('fcmToken');
      const tokenType = await AsyncStorage.getItem('pushTokenType');

      if (cachedFCMToken && this.isFirebaseAvailable && tokenType === 'fcm') {
        console.log('🔥 [FCM] ✅ Using cached FCM token:', cachedFCMToken.substring(0, 20) + '...');
        return cachedFCMToken;
      }
    } catch (error) {
      console.log('🔥 [FCM] Error reading cached FCM token:', error);
    }

    // ТОЛЬКО Firebase FCM - с повторной попыткой инициализации
    if (!this.isFirebaseAvailable) {
      console.warn('🔥 [FCM] ⚠️ Firebase не инициализирован, попытка повторной инициализации...');

      // Попытка повторной инициализации
      await this.initFirebase();

      if (!this.isFirebaseAvailable) {
        console.error('🔥 [FCM] ❌ Firebase все еще недоступен после повторной инициализации');
        console.error('🔥 [FCM] ❌ Проверьте настройки Firebase:');
        console.error('🔥 [FCM]   - google-services.json/GoogleService-Info.plist присутствуют?');
        console.error('🔥 [FCM]   - Firebase проект настроен корректно?');
        console.error('🔥 [FCM]   - @react-native-firebase/messaging установлен?');
        console.error('🔥 [FCM]   - Cloud Messaging API включен в Firebase Console?');
        return null;
      }

      console.log('🔥 [FCM] ✅ Повторная инициализация успешна');
    }

    try {
      // Убеждаемся, что устройство зарегистрировано для iOS
      if (Platform.OS === 'ios') {
        const isRegistered = await isDeviceRegisteredForRemoteMessages();
        if (!isRegistered) {
          console.log('🔥 [FCM] Registering iOS device for remote messages...');
          await registerDeviceForRemoteMessages();
        }
      }

      console.log('🔥 [FCM] Requesting new Firebase FCM token...');
      const fcmToken = await getToken();

      if (!fcmToken) {
        throw new Error('Firebase getToken() returned null');
      }

      // КРИТИЧНО: проверяем, что это НЕ Expo токен
      if (fcmToken.startsWith('ExponentPushToken')) {
        console.error('🔥 [FCM] ❌ Firebase вернул Expo токен - это ошибка конфигурации!');
        console.error('🔥 [FCM] ❌ Проверьте Firebase настройки в app.json и google-services.json');
        return null;
      }

      console.log('🔥 [FCM] ✅ Получен валидный Firebase FCM токен');
      console.log('🔥 [FCM] Token length:', fcmToken.length, 'chars');

      // Сохраняем ТОЛЬКО FCM токен
      await AsyncStorage.setItem('fcmToken', fcmToken);
      await AsyncStorage.setItem('pushTokenType', 'fcm');

      return fcmToken;

    } catch (error) {
      console.error('🔥 [FCM] ❌ Ошибка получения FCM токена:', error);

      // Детализированная диагностика ошибок
      if (error && typeof error === 'object') {
        const errorStr = String(error);
        if (errorStr.includes('MISSING_INSTANCEID_SERVICE')) {
          console.error('🔥 [FCM] ❌ Firebase Instance ID service не настроен');
        } else if (errorStr.includes('SERVICE_NOT_AVAILABLE')) {
          console.error('🔥 [FCM] ❌ Firebase сервис недоступен');
        } else if (errorStr.includes('TOO_MANY_REQUESTS')) {
          console.error('🔥 [FCM] ❌ Слишком много запросов, попробуйте позже');
        }
      }

      return null;
    }
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
      onMessage(async (remoteMessage: FirebaseMessagingTypes.RemoteMessage) => {
        console.log('🔥 [FCM] Foreground message received:', remoteMessage);

        const messageData: MessageData = {
          title: remoteMessage.notification?.title || 'Новое сообщение',
          body: remoteMessage.notification?.body || '',
          data: remoteMessage.data || {},
          isFirebase: true
        };

        // Вызываем все зарегистрированные обработчики
        this.messageHandlers.forEach(handler => {
          try {
            handler(messageData);
          } catch (error: unknown) {
            console.error('🔥 [Firebase] Error in message handler:', error);
          }
        });

        // Показываем локальное уведомление если нужно
        if (remoteMessage.data?.type === 'message_notification') {
          await this.showLocalNotification(messageData);
        }
      });

      // Обработка открытия приложения через уведомление
      onNotificationOpenedApp((remoteMessage: FirebaseMessagingTypes.RemoteMessage) => {
        console.log('🔥 [FCM] Notification opened app:', remoteMessage);
        this.handleNotificationTap(remoteMessage);
      });

      // Проверка начального уведомления (если приложение было закрыто)
      getInitialNotification()
        .then((remoteMessage: FirebaseMessagingTypes.RemoteMessage | null) => {
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
  async initialize(): Promise<InitResult> {
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
  addMessageHandler(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  // Метод для установки навигационной ссылки
  setNavigationRef(ref: NavigationRef): void {
    this.navigationRef = ref;
  }

  // Обработка нажатия на уведомление - ОТКЛЮЧЕНА
  private handleNotificationTap(message: FirebaseMessagingTypes.RemoteMessage | RemoteMessage): void {
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
  private async showLocalNotification(messageData: MessageData): Promise<void> {
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
    } catch (error: unknown) {
      console.log('🔥 [Firebase] Could not show local notification:', error);
    }
  }

  // Проверка отложенной навигации
  private async checkPendingNavigation(): Promise<void> {
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
  removeMessageHandler(handler: MessageHandler): void {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
      console.log('🔥 [Firebase] Message handler removed, total:', this.messageHandlers.length);
    }
  }

  // Получение статуса
  async getStatus(): Promise<NotificationStatus> {
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
    } catch (error: unknown) {
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