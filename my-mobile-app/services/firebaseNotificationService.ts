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
import { router } from 'expo-router';

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

/**
 * Умный Firebase сервис с fallback на Expo Notifications
 * Автоматически переключается между Firebase и Expo в зависимости от доступности
 */
class FirebaseNotificationService {
  private static instance: FirebaseNotificationService;
  private isFirebaseAvailable: boolean = false;
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

        if (apps.length === 0) {
          console.error('🔥 [FCM] ❌ No Firebase apps found - initialization failed');
          console.error('🔥 [FCM] ❌ Проверьте google-services.json/GoogleService-Info.plist');
          throw new Error('Firebase App not initialized');
        }

        const defaultApp = firebase.app();

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
        this.isFirebaseAvailable = true;
      } else {
        try {
          const authStatus = await messaging().requestPermission();

          // Используем константы из messaging()
          const AuthorizationStatus = messaging.AuthorizationStatus;
          const hasFirebasePermissions = 
            authStatus === AuthorizationStatus.AUTHORIZED || 
            authStatus === AuthorizationStatus.PROVISIONAL;

          if (!hasFirebasePermissions) {
            console.warn('🔥 [FCM] iOS permissions not granted, but continuing initialization');
          }

          this.isFirebaseAvailable = true;
        } catch (permError) {
          console.error('🔥 [FCM] iOS permission check failed:', permError);
          throw new Error(`iOS permissions failed: ${permError}`);
        }
      }

      // Устанавливаем background handler для сохранения данных (без дублирующих уведомлений)
      messaging().setBackgroundMessageHandler(async (remoteMessage) => {
        // Только сохраняем данные, НЕ создаем дополнительные уведомления
        // Firebase уже показал системное уведомление автоматически
        await this.handleBackgroundMessage(remoteMessage);
      });

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
      }

      // Обновляем только бейдж без создания уведомления
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

    // Сначала запрашиваем разрешения Expo для локальных уведомлений
    try {
      const Notifications = require('expo-notifications');

      const { status: currentStatus } = await Notifications.getPermissionsAsync();

      if (currentStatus !== 'granted') {
        const { status: newStatus } = await Notifications.requestPermissionsAsync();
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
      return enabled;
    } catch (error) {
      console.error('🔔 [PUSH] All permission requests failed:', error);
      return false;
    }
  }

  // Получение ТОЛЬКО FCM токена (без Expo fallback)
  async getToken(): Promise<string | null> {

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
          return true;
        }
      }
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
    if (!this.isFirebaseAvailable) {
      this.setupExpoListeners();
      return;
    }

    try {
      const Notifications = require('expo-notifications');


      // Дополнительно для Android - создаем высокоприоритетный канал с группировкой
      if (Platform.OS === 'android') {
        try {
          // Создаем группу уведомлений
          await Notifications.setNotificationChannelGroupAsync('app-messages', {
            name: 'Сообщения приложения',
          });

          // Создаем канал с привязкой к группе
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
            groupId: 'app-messages', // Привязываем к группе
          });

          console.log('🔥 [FCM] ✅ Notification channel group created for Android');
        } catch (channelError) {
          console.error('🔥 [FCM] Failed to create notification channel:', channelError);
        }
      }

      console.log('🔥 [FCM] Step 5: Setting up onMessage listener...');

      // КРИТИЧНО: Сохраняем ссылку на unsubscribe функцию
      try {
        const onMessageUnsubscribe = messaging().onMessage(async (remoteMessage: FirebaseMessagingTypes.RemoteMessage) => {
        const messageData: MessageData = {
          title: remoteMessage.notification?.title,
          body: remoteMessage.notification?.body,
          data: remoteMessage.data,
          isFirebase: true
        };



        // Вызываем handlers НЕМЕДЛЕННО
        this.messageHandlers.forEach((handler, index) => {
          try {
            handler(messageData);
          } catch (error: unknown) {
            console.error(`🔥 [FCM] ❌ Handler ${index + 1} failed:`, error);
          }
        });

        // ПРИНУДИТЕЛЬНОЕ уведомление для активного приложения
        const AppState = require('react-native').AppState;
        const currentState = AppState.currentState;
        console.log('🔥 [FCM] Current app state:', currentState);

        if (currentState === 'active') {
          try {
            // Создаем локальное уведомление для активного приложения с группировкой
            const notificationContent: any = {
              title: messageData.title,
              body: messageData.body,
              data: {
                ...messageData.data,
                source: 'firebase_active',
                timestamp: Date.now(),
              },
              sound: 'default',
            };

            // Android - добавляем group для автоматической группировки
            if (Platform.OS === 'android') {
              notificationContent.channelId = 'urgent-messages';
              notificationContent.groupId = 'app-messages'; // Группируем все уведомления
              notificationContent.groupSummary = false; // Это не summary уведомление
            }

            // iOS - добавляем threadIdentifier для группировки
            if (Platform.OS === 'ios') {
              notificationContent.threadIdentifier = 'app-messages'; // Группируем по thread
              notificationContent.categoryIdentifier = 'message'; // Категория для действий
            }

            const activeNotificationId = await Notifications.scheduleNotificationAsync({
              content: notificationContent,
              trigger: null,
            });

            console.log('🔥 [FCM] ✅ Grouped notification created:', activeNotificationId);

          } catch (error) {
            console.error('🔥 [FCM] ❌ Active app notification failed:', error);
          }
        } else {
          console.log('🔥 [FCM] App in background - Firebase system notification will be shown automatically');
        }
      });

        // ВАЖНО: Сохраняем unsubscribe функцию для очистки
        (this as any).onMessageUnsubscribe = onMessageUnsubscribe;

      } catch (onMessageError) {
        console.error('🔥 [FCM] ❌ Failed to set up onMessage listener:', onMessageError);
        throw onMessageError;
      }

      // Expo listener УДАЛЕН - навигация ТОЛЬКО в NotificationContext
      // Это предотвращает дублирование обработчиков и двойную навигацию

      // Firebase notification tap listeners ОТКЛЮЧЕНЫ
      // Навигация полностью обрабатывается в NotificationContext
      // Firebase только получает уведомления для показа

      try {
        // Только логируем, НЕ обрабатываем
        messaging().onNotificationOpenedApp(async (remoteMessage: FirebaseMessagingTypes.RemoteMessage) => {
          console.log('🔥 [FCM] 📱 Notification opened app - handled by NotificationContext');
          // Ничего не делаем - NotificationContext обработает
        });

        // Только логируем начальное уведомление
        messaging().getInitialNotification()
          .then(async (remoteMessage: FirebaseMessagingTypes.RemoteMessage | null) => {
            if (remoteMessage) {
              console.log('🔥 [FCM] 📱 Initial notification detected - will be handled by NotificationContext');
              // Ничего не делаем - NotificationContext обработает
            }
          })
          .catch((initialError) => {
            console.error('🔥 [FCM] Error getting initial notification:', initialError);
          });


        // Обработка обновления токена
        messaging().onTokenRefresh(async (token: string) => {
          console.log('🔥 [FCM] Token refreshed:', token.substring(0, 20) + '...');
          await AsyncStorage.setItem('fcmToken', token);
          await this.saveTokenToServer(token);
        });



      } catch (listenersError) {
        console.error('🔥 [FCM] ❌ Error setting up notification listeners:', listenersError);
      }
      try {
        // Получаем экземпляр messaging для активации
        const messagingInstance = messaging();

        // Проверяем статус разрешений еще раз
        const authStatus = await messagingInstance.hasPermission();
        console.log('🔥 [FCM] Current permission status:', authStatus);
        // ВАЖНО: Принудительно подписываемся на топик для тестирования
        try {
          await messagingInstance.subscribeToTopic('debug_notifications');

        } catch (topicError) {
          console.log('🔥 [FCM] Topic subscription failed (normal):', topicError);
        }



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
    } catch (error) {
      console.log('🔔 [PUSH] No notification listeners available:', error);
    }
  }

  // Публичный метод для инициализации сервиса с полной диагностикой
  async initialize(): Promise<InitResult> {
    try {
      // ПРИНУДИТЕЛЬНАЯ проверка Firebase конфигурации в продакшене
      if (!__DEV__) {
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
      const hasPermission = await this.requestPermissions();
      console.log('🔥 [Firebase] Permission result:', hasPermission);

      if (!hasPermission) {
        console.error('🔥 [Firebase] ❌ Permissions denied - stopping initialization');
        console.log('🔥 [Firebase] Permission denied - notifications disabled');
        return { success: false, error: 'Permission denied' };
      }

      // ШАГ 2: Получаем токен с повторными попытками
      let token = await this.getToken();

      // Повторная попытка получения токена
      if (!token) {
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
      if (!isRealFirebaseToken) {
        console.warn('⚠️ [WARNING] Using Expo token - Firebase FCM not available in this build');
        console.warn('⚠️ [WARNING] Background notifications will be limited');
        console.warn('⚠️ [WARNING] Проверьте Firebase конфигурацию в продакшене');
      } else {
        console.log('🔥 [FCM] ✅ Native Firebase FCM token detected - full functionality available!');
      }

      // ШАГ 4: Сохраняем токен на сервере с повторными попытками;
      let tokenSaved = await this.saveTokenToServer(token);

      // Повторная попытка сохранения
      if (!tokenSaved) {
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
      this.isInitialized = true;

      // ШАГ 6: ЗАТЕМ настраиваем слушатели (это важно для правильного порядка)
      console.log('🔥 [Firebase] STEP 6: Setting up notification listeners...');
      try {
        await this.setupNotificationListeners();
      } catch (listenersError) {
        console.error('🔥 [Firebase] ❌ Listeners setup failed:', listenersError);
        // Не прерываем инициализацию из-за ошибки listeners
      }

      // Отложенная навигация обрабатывается в NotificationContext
      console.log('🔥 [Firebase] Pending navigation will be handled by NotificationContext');

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

      }

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
    this.messageHandlers.push(handler);
  }

  // Метод для очистки всех handlers
  clearMessageHandlers(): void {
    this.messageHandlers = [];
  }

  // executePendingNavigation и checkPendingChatNavigation УДАЛЕНЫ
  // Навигация полностью обрабатывается в NotificationContext



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