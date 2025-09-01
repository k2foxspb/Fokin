import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_CONFIG } from '../config';
import messaging, {
  FirebaseMessagingTypes, 
  isDeviceRegisteredForRemoteMessages,
  registerDeviceForRemoteMessages,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  getInitialNotification,
  onTokenRefresh
} from '@react-native-firebase/messaging';
import {addNotificationReceivedListener, setNotificationHandler} from "expo-notifications";
import {log} from "expo/build/devtools/logger";
import {async} from "@firebase/util";

// Импортируем типы отдельно
const AuthorizationStatus = messaging.AuthorizationStatus;

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
  private processedNotifications: Set<string> = new Set();

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

      // Проверяем доступность Messaging модулей через экземпляр
      console.log('🔥 [FCM] Checking Firebase Messaging modules...');

      const messagingInstance = messaging();
      console.log('🔥 [FCM] Messaging instance:', !!messagingInstance);

      // Проверяем методы через экземпляр, а не импорты
      // Проверяем методы напрямую через экземпляр
      // Проверяем доступность ключевых методов
      const isRequestPermissionAvailable = typeof messagingInstance.requestPermission === 'function';
      const isGetTokenAvailable = typeof messagingInstance.getToken === 'function';
      const isOnMessageAvailable = typeof messagingInstance.onMessage === 'function';

      console.log('🔥 [FCM] requestPermission available:', isRequestPermissionAvailable);
      console.log('🔥 [FCM] getToken available:', isGetTokenAvailable);
      console.log('🔥 [FCM] onMessage available:', isOnMessageAvailable);

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
          const authStatus = await messaging().requestPermission();

          // Используем константы из messaging()
          const AuthorizationStatus = messaging.AuthorizationStatus;
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

      // Устанавливаем background handler для сохранения данных (без дублирующих уведомлений)
      messaging().setBackgroundMessageHandler(async (remoteMessage) => {
        console.log('🔥 [FCM] Background message received:', remoteMessage.messageId);
        // Только сохраняем данные, НЕ создаем дополнительные уведомления
        // Firebase уже показал системное уведомление автоматически
        await this.handleBackgroundMessage(remoteMessage);
      });
      console.log('🔥 [FCM] Background message handler set (data-only, no duplicate notifications)');

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

      // Сохраняем информацию о новом сообщении БЕЗ создания дополнительного уведомления
      // Firebase уже показал системное уведомление автоматически
      if (remoteMessage.data?.type === 'message_notification') {
        const messageInfo: BackgroundMessageInfo = {
          chatId: remoteMessage.data.chatId,
          senderId: remoteMessage.data.senderId,
          timestamp: Date.now(),
          processed: false,
          messageId: remoteMessage.messageId || ''
        };

        await AsyncStorage.setItem('lastBackgroundMessage', JSON.stringify(messageInfo));
        console.log('🔥 [FCM] Background message info saved - Firebase already showed system notification');
      }

      // Обновляем только бейдж без создания уведомления
      try {
        const Notifications = require('expo-notifications');
        const currentBadge: number = await Notifications.getBadgeCountAsync();
        await Notifications.setBadgeCountAsync(currentBadge + 1);
        console.log('🔥 [FCM] Badge updated to:', currentBadge + 1);
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
    console.log('🔔 [PUSH] === REQUESTING PERMISSIONS ===');

    // Сначала запрашиваем разрешения Expo для локальных уведомлений
    try {
      const Notifications = require('expo-notifications');
      console.log('🔔 [PUSH] Requesting Expo notification permissions...');

      const { status: currentStatus } = await Notifications.getPermissionsAsync();
      console.log('🔔 [PUSH] Current Expo permissions:', currentStatus);

      if (currentStatus !== 'granted') {
        const { status: newStatus } = await Notifications.requestPermissionsAsync();
        console.log('🔔 [PUSH] New Expo permissions:', newStatus);
      }
    } catch (expoError) {
      console.warn('🔔 [PUSH] Expo permissions request failed:', expoError);
    }

    // Приоритет Firebase для remote notifications
    if (this.isFirebaseAvailable) {
      try {
        console.log('🔥 [FCM] Requesting Firebase permissions...');
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === AuthorizationStatus.AUTHORIZED ||
          authStatus === AuthorizationStatus.PROVISIONAL;

        console.log('🔥 [FCM] Firebase auth status:', authStatus, 'enabled:', enabled);

        if (enabled && Platform.OS === 'ios') {
          const isRegistered = await isDeviceRegisteredForRemoteMessages();
          console.log('🔥 [FCM] iOS device registered for remote messages:', isRegistered);
          if (!isRegistered) {
            console.log('🔥 [FCM] Registering iOS device for remote messages...');
            await registerDeviceForRemoteMessages();
          }
        }

        console.log('🔥 [FCM] Firebase permissions granted:', enabled);
        return enabled;
      } catch (error) {
        console.error('🔥 [FCM] Firebase permissions failed:', error);
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
      console.error('🔔 [PUSH] All permission requests failed:', error);
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
      const fcmToken = await messaging().getToken();

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
  private async setupNotificationListeners(): Promise<void> {
    console.log('🔥 [FCM] === setupNotificationListeners CALLED ===');
    console.log('🔥 [FCM] Firebase available:', this.isFirebaseAvailable);

    if (!this.isFirebaseAvailable) {
      console.log('🔥 [FCM] Firebase not available, setting up Expo listeners...');
      this.setupExpoListeners();
      return;
    }

    console.log('🔥 [FCM] === STARTING FIREBASE LISTENERS SETUP ===');

    try {
      console.log('🔥 [FCM] Step 1: Setting up Firebase listeners...');

      console.log('🔥 [FCM] Step 2: Importing Notifications module...');
      const Notifications = require('expo-notifications');
      console.log('🔥 [FCM] ✅ Notifications module imported');

      console.log('🔥 [FCM] Step 3: Skipping local notification handler - Firebase only mode');

      // ЛОКАЛЬНЫЕ УВЕДОМЛЕНИЯ ПОЛНОСТЬЮ ОТКЛЮЧЕНЫ
      // Все уведомления приходят только через Firebase FCM
      console.log('🔥 [FCM] ✅ Local notifications disabled - Firebase FCM only');

      console.log('🔥 [FCM] Step 4: Platform-specific setup...');

      // Дополнительно для Android - создаем высокоприоритетный канал
      if (Platform.OS === 'android') {
        console.log('🔥 [FCM] Step 4a: Creating Android notification channel...');
        try {
          await Notifications.setNotificationChannelAsync('urgent-messages', {
            name: 'Срочные сообщения',
            importance: Notifications.AndroidImportance.MAX, // Максимальная важность
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF0000',
            sound: 'default',
            enableVibrate: true,
            showBadge: true,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            bypassDnd: true, // Обход режима "Не беспокоить"
          });
          console.log('🔥 [FCM] ✅ High priority channel created');
        } catch (channelError) {
          console.error('🔥 [FCM] Failed to create notification channel:', channelError);
        }
      }

      console.log('🔥 [FCM] Step 5: Setting up onMessage listener...');

      // КРИТИЧНО: Сохраняем ссылку на unsubscribe функцию
      try {
        const onMessageUnsubscribe = messaging().onMessage(async (remoteMessage: FirebaseMessagingTypes.RemoteMessage) => {
        console.log('🔥 [FCM] === 🚨 REAL-TIME FOREGROUND MESSAGE RECEIVED 🚨 ===');
        console.log('🔥 [FCM] Message ID:', remoteMessage.messageId);
        console.log('🔥 [FCM] From:', remoteMessage.from);
        console.log('🔥 [FCM] Sent time:', remoteMessage.sentTime);
        console.log('🔥 [FCM] Remote message FULL:', JSON.stringify(remoteMessage, null, 2));

        const messageData: MessageData = {
          title: remoteMessage.notification?.title || 'Новое сообщение',
          body: remoteMessage.notification?.body || 'У вас новое сообщение',
          data: remoteMessage.data || {},
          isFirebase: true
        };

        console.log('🔥 [FCM] ===== PROCESSING HANDLERS =====');
        console.log('🔥 [FCM] Available handlers:', this.messageHandlers.length);

        // Вызываем handlers НЕМЕДЛЕННО
        this.messageHandlers.forEach((handler, index) => {
          try {
            console.log(`🔥 [FCM] 🎯 Executing handler ${index + 1}...`);
            handler(messageData);
            console.log(`🔥 [FCM] ✅ Handler ${index + 1} executed`);
          } catch (error: unknown) {
            console.error(`🔥 [FCM] ❌ Handler ${index + 1} failed:`, error);
          }
        });

        // ПРИНУДИТЕЛЬНОЕ уведомление для активного приложения
        const AppState = require('react-native').AppState;
        const currentState = AppState.currentState;
        console.log('🔥 [FCM] Current app state:', currentState);

        if (currentState === 'active') {
          console.log('🔥 [FCM] App is active - creating local notification for user visibility');

          try {
            // Создаем локальное уведомление для активного приложения
            const activeNotificationId = await Notifications.scheduleNotificationAsync({
              content: {
                title: messageData.title,
                body: messageData.body,
                data: {
                  ...messageData.data,
                  source: 'firebase_active',
                  timestamp: Date.now(),
                },
                sound: 'default',
                ...(Platform.OS === 'android' && {
                  channelId: 'urgent-messages',
                }),
              },
              trigger: null,
            });

            console.log('🔥 [FCM] ✅ Local notification created for active app:', activeNotificationId);

          } catch (error) {
            console.error('🔥 [FCM] ❌ Active app notification failed:', error);
          }
        } else {
          console.log('🔥 [FCM] App in background - Firebase system notification will be shown automatically');
        }
      });

        // ВАЖНО: Сохраняем unsubscribe функцию для очистки
        (this as any).onMessageUnsubscribe = onMessageUnsubscribe;

        console.log('🔥 [FCM] ✅ onMessage listener ACTIVATED and READY for real-time messages');

      } catch (onMessageError) {
        console.error('🔥 [FCM] ❌ Failed to set up onMessage listener:', onMessageError);
        throw onMessageError;
      }

      console.log('🔥 [FCM] Step 6: Setting up notification opened listeners...');

      try {
        // Обработка открытия приложения через уведомление
        messaging().onNotificationOpenedApp((remoteMessage: FirebaseMessagingTypes.RemoteMessage) => {
          console.log('🔥 [FCM] Notification opened app:', remoteMessage);
          this.handleNotificationTap(remoteMessage);
        });

        console.log('🔥 [FCM] ✅ onNotificationOpenedApp listener set');

        // Проверка начального уведомления (если приложение было закрыто)
        messaging().getInitialNotification()
          .then((remoteMessage: FirebaseMessagingTypes.RemoteMessage | null) => {
            if (remoteMessage) {
              console.log('🔥 [FCM] Initial notification:', remoteMessage);
              // Добавляем небольшую задержку для инициализации навигации
              setTimeout(() => {
                this.handleNotificationTap(remoteMessage);
              }, 2000);
            } else {
              console.log('🔥 [FCM] No initial notification');
            }
          })
          .catch((initialError) => {
            console.error('🔥 [FCM] Error getting initial notification:', initialError);
          });

        console.log('🔥 [FCM] ✅ getInitialNotification listener set');

        // Обработка обновления токена
        messaging().onTokenRefresh(async (token: string) => {
          console.log('🔥 [FCM] Token refreshed:', token.substring(0, 20) + '...');
          await AsyncStorage.setItem('fcmToken', token);
          await this.saveTokenToServer(token);
        });

        console.log('🔥 [FCM] ✅ onTokenRefresh listener set');

      } catch (listenersError) {
        console.error('🔥 [FCM] ❌ Error setting up notification listeners:', listenersError);
      }

      console.log('🔥 [FCM] === ALL FIREBASE LISTENERS CONFIGURED ===');

      // КРИТИЧНО: Принудительная активация Firebase messaging
      console.log('🔥 [FCM] === ACTIVATING FIREBASE MESSAGING ===');
      try {
        // Получаем экземпляр messaging для активации
        const messagingInstance = messaging();
        console.log('🔥 [FCM] Messaging instance active:', !!messagingInstance);

        // Проверяем статус разрешений еще раз
        const authStatus = await messagingInstance.hasPermission();
        console.log('🔥 [FCM] Current permission status:', authStatus);

        // Принудительно активируем токен
        const currentToken = await messagingInstance.getToken();
        console.log('🔥 [FCM] Current active token length:', currentToken?.length);

        // ВАЖНО: Принудительно подписываемся на топик для тестирования
        try {
          await messagingInstance.subscribeToTopic('debug_notifications');
          console.log('🔥 [FCM] ✅ Subscribed to debug topic');
        } catch (topicError) {
          console.log('🔥 [FCM] Topic subscription failed (normal):', topicError);
        }

        console.log('🔥 [FCM] ✅ Firebase messaging fully activated and listening');

      } catch (activationError) {
        console.error('🔥 [FCM] ❌ Firebase activation error:', activationError);
      }

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
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
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

  // Публичный метод для инициализации сервиса с полной диагностикой
  async initialize(): Promise<InitResult> {
    try {
      console.log('🔥 [Firebase] === FULL DIAGNOSTIC INITIALIZATION START ===');
      console.log('🔥 [Firebase] Environment:', __DEV__ ? 'development' : 'PRODUCTION');
      console.log('🔥 [Firebase] Platform:', Platform.OS);
      console.log('🔥 [Firebase] Firebase available:', this.isFirebaseAvailable);

      // ПРИНУДИТЕЛЬНАЯ проверка Firebase конфигурации в продакшене
      if (!__DEV__) {
        console.log('🔥 [PROD] === PRODUCTION FIREBASE CHECK ===');
        try {
          const firebase = require('@react-native-firebase/app').default;
          const app = firebase.app();
          console.log('🔥 [PROD] Firebase Project ID:', app.options.projectId);
          console.log('🔥 [PROD] Firebase App ID:', app.options.appId);

          if (!app.options.projectId) {
            console.error('🔥 [PROD] ❌ КРИТИЧЕСКАЯ ОШИБКА: Firebase Project ID не найден!');
            console.error('🔥 [PROD] ❌ Проверьте google-services.json/GoogleService-Info.plist');
          }
        } catch (firebaseError) {
          console.error('🔥 [PROD] ❌ Firebase configuration error:', firebaseError);
        }
      }

      // ШАГ 1: Запрашиваем разрешения с детальной диагностикой
      console.log('🔥 [Firebase] STEP 1: Requesting permissions...');
      const hasPermission = await this.requestPermissions();
      console.log('🔥 [Firebase] Permission result:', hasPermission);

      if (!hasPermission) {
        console.error('🔥 [Firebase] ❌ Permissions denied - stopping initialization');
        // Тихо логируем ошибку разрешений - без алертов  
        console.log('🔥 [Firebase] Permission denied - notifications disabled');
        return { success: false, error: 'Permission denied' };
      }

      // ШАГ 2: Получаем токен с повторными попытками
      console.log('🔥 [Firebase] STEP 2: Getting token...');
      let token = await this.getToken();

      // Повторная попытка получения токена
      if (!token) {
        console.warn('🔥 [Firebase] First token attempt failed, retrying...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Ждем 2 секунды
        token = await this.getToken();
      }

      if (!token) {
        console.error('🔥 [Firebase] ❌ No token received after retry');
        return { success: false, error: 'No token received' };
      }

      // ШАГ 3: Проверяем и логируем тип токена
      const isRealFirebaseToken = !token.startsWith('ExponentPushToken');
      const tokenType = isRealFirebaseToken ? 'Native Firebase FCM' : 'Expo (Firebase unavailable)';

      console.log('🔔 [TOKEN] === TOKEN ANALYSIS ===');
      console.log(`🔔 [TOKEN] Type: ${tokenType}`);
      console.log(`🔔 [TOKEN] Length: ${token.length} characters`);
      console.log(`🔔 [TOKEN] Preview: ${token.substring(0, 30)}...`);
      console.log(`🔔 [TOKEN] Is Firebase: ${isRealFirebaseToken}`);

      if (!isRealFirebaseToken) {
        console.warn('⚠️ [WARNING] Using Expo token - Firebase FCM not available in this build');
        console.warn('⚠️ [WARNING] Background notifications will be limited');
        console.warn('⚠️ [WARNING] Проверьте Firebase конфигурацию в продакшене');
      } else {
        console.log('🔥 [FCM] ✅ Native Firebase FCM token detected - full functionality available!');
      }

      // ШАГ 4: Сохраняем токен на сервере с повторными попытками
      console.log('🔥 [Firebase] STEP 4: Saving token to server...');
      let tokenSaved = await this.saveTokenToServer(token);

      // Повторная попытка сохранения
      if (!tokenSaved) {
        console.warn('🔥 [Firebase] First save attempt failed, retrying...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        tokenSaved = await this.saveTokenToServer(token);
      }

      if (!tokenSaved) {
        console.error('🔥 [Firebase] ❌ Token not saved to server after retry');
        console.error('🔥 [Firebase] ❌ Push уведомления могут не работать');
      } else {
        console.log('🔥 [Firebase] ✅ Token successfully saved to server');
      }

      // ШАГ 5: СНАЧАЛА устанавливаем флаг инициализации
      console.log('🔥 [Firebase] STEP 5: Setting initialization flag...');
      this.isInitialized = true;

      // ШАГ 6: ЗАТЕМ настраиваем слушатели (это важно для правильного порядка)
      console.log('🔥 [Firebase] STEP 6: Setting up notification listeners...');
      try {
        await this.setupNotificationListeners();
        console.log('🔥 [Firebase] ✅ Notification listeners setup completed');
      } catch (listenersError) {
        console.error('🔥 [Firebase] ❌ Listeners setup failed:', listenersError);
        // Не прерываем инициализацию из-за ошибки listeners
      }

      // ШАГ 7: Проверяем итоговую конфигурацию ПОСЛЕ setup  
      console.log('🔥 [Firebase] === FINAL CONFIGURATION CHECK ===');
      console.log('🔥 [Firebase] Initialized:', this.isInitialized);
      console.log('🔥 [Firebase] Firebase available:', this.isFirebaseAvailable);
      console.log('🔥 [Firebase] Message handlers (after setup):', this.messageHandlers.length);
      console.log('🔥 [Firebase] Token saved:', tokenSaved);

      // В продакшене - дополнительная проверка
      if (!__DEV__) {
        console.log('🔥 [PROD] === PRODUCTION VERIFICATION ===');

        // Сохраняем диагностическую информацию
        const diagnosticInfo = {
          timestamp: new Date().toISOString(),
          platform: Platform.OS,
          tokenType: isRealFirebaseToken ? 'fcm' : 'expo',
          tokenLength: token.length,
          firebaseAvailable: this.isFirebaseAvailable,
          tokenSaved: tokenSaved,
          hasPermissions: hasPermission
        };

        await AsyncStorage.setItem('notificationDiagnostic', JSON.stringify(diagnosticInfo));
        console.log('🔥 [PROD] Diagnostic info saved to AsyncStorage');

        // Показываем пользователю статус
        const Alert = require('react-native').Alert;
        Alert.alert(
          'Уведомления настроены', 
          `Тип: ${isRealFirebaseToken ? 'Firebase (полная поддержка)' : 'Expo (ограниченная поддержка)'}\nСтатус: ${tokenSaved ? 'Активны' : 'Проблемы с сервером'}`,
          [{ text: 'OK' }]
        );
      }

      console.log(`🔥 [Firebase] === INITIALIZATION COMPLETED SUCCESSFULLY ===`);
      console.log(`🔥 [Firebase] Final status: ${tokenType}, Token saved: ${tokenSaved}`);

      return { 
        success: true, 
        token, 
        tokenType: isRealFirebaseToken ? 'fcm' : 'expo',
        tokenSaved 
      };

    } catch (error) {
      console.error('🔥 [Firebase] ❌ CRITICAL INITIALIZATION ERROR:', error);
      console.error('🔥 [Firebase] Error details:', String(error));

      // В продакшене сохраняем ошибку для анализа
      if (!__DEV__) {
        try {
          const errorInfo = {
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : 'No stack',
            platform: Platform.OS
          };
          await AsyncStorage.setItem('notificationInitError', JSON.stringify(errorInfo));
        } catch (saveError) {
          console.error('🔥 [Firebase] Could not save error info:', saveError);
        }
      }

      return { success: false, error };
    }
  }

  // Метод для добавления обработчиков сообщений
  addMessageHandler(handler: MessageHandler): void {
    console.log('🔥 [FCM] Adding message handler, current count:', this.messageHandlers.length);
    this.messageHandlers.push(handler);
    console.log('🔥 [FCM] Message handler added, new count:', this.messageHandlers.length);
  }

  // Метод для очистки всех handlers
  clearMessageHandlers(): void {
    console.log('🔥 [FCM] Clearing all message handlers, current count:', this.messageHandlers.length);
    this.messageHandlers = [];
    console.log('🔥 [FCM] All message handlers cleared');
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

  // ЛОКАЛЬНЫЕ УВЕДОМЛЕНИЯ ПОЛНОСТЬЮ УДАЛЕНЫ - ТОЛЬКО FIREBASE FCM

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

  // Тестовый метод для проверки активности Firebase
  async testFirebaseConnection(): Promise<void> {
    try {
      console.log('🧪 [FCM-TEST] === TESTING FIREBASE CONNECTION ===');

      const messagingInstance = messaging();
      const token = await messagingInstance.getToken();
      const hasPermission = await messagingInstance.hasPermission();

      console.log('🧪 [FCM-TEST] Has permission:', hasPermission);
      console.log('🧪 [FCM-TEST] Token active:', !!token);
      console.log('🧪 [FCM-TEST] Handlers registered:', this.messageHandlers.length);
      console.log('🧪 [FCM-TEST] Firebase available:', this.isFirebaseAvailable);

      // Попытка отправить тестовое сообщение через Firebase Console
      console.log('🧪 [FCM-TEST] Send test message to this token:');
      console.log('🧪 [FCM-TEST] Token:', token);

      // КРИТИЧНО: Тестируем onMessage handler принудительно
      console.log('🧪 [FCM-TEST] === TESTING onMessage HANDLER MANUALLY ===');

      try {
        // Имитируем Firebase сообщение для тестирования handler
        const testMessage = {
          messageId: 'test-' + Date.now(),
          notification: {
            title: '🧪 Test Notification',
            body: 'This is a test message to verify handlers work'
          },
          data: {
            type: 'message_notification',
            chatId: '46',
            senderId: '9',
            timestamp: Date.now()
          },
          from: 'test',
          sentTime: Date.now()
        };

        console.log('🧪 [FCM-TEST] Simulating Firebase message...');
        console.log('🧪 [FCM-TEST] Test message:', JSON.stringify(testMessage, null, 2));

        // Вызываем handlers напрямую для тестирования
        const messageData = {
          title: testMessage.notification.title,
          body: testMessage.notification.body,
          data: testMessage.data,
          isFirebase: true
        };

        console.log('🧪 [FCM-TEST] Calling handlers directly with test data...');
        this.messageHandlers.forEach((handler, index) => {
          try {
            console.log(`🧪 [FCM-TEST] Testing handler ${index + 1}...`);
            handler(messageData);
            console.log(`🧪 [FCM-TEST] ✅ Handler ${index + 1} responded successfully`);
          } catch (handlerError) {
            console.error(`🧪 [FCM-TEST] ❌ Handler ${index + 1} failed:`, handlerError);
          }
        });

      } catch (testError) {
        console.error('🧪 [FCM-TEST] Manual handler test failed:', testError);
      }

    } catch (error) {
      console.error('🧪 [FCM-TEST] Test failed:', error);
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