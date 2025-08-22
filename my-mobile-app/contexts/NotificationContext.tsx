import React, {createContext, useContext, useEffect, useState, useRef} from 'react';
import {useWebSocket} from '../hooks/useWebSocket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {router} from 'expo-router';
import {AppState, Platform} from 'react-native';
import axios from 'axios';
import {API_CONFIG} from '../config';

import {
    requestNotificationPermissions,
    registerForPushNotifications,
    sendHighPriorityNotification,
    addNotificationListener,
    addNotificationResponseListener,
} from '../services/notificationService';

import FirebaseNotificationService from '../services/firebaseNotificationService';

interface NotificationContextType {
    unreadCount: number;
    messages: MessageType[];
    senderCounts: Map<number, number>;
    userStatuses: Map<number, string>;
    connect: () => Promise<void>;
    disconnect: () => void;
    refreshNotifications: () => void;
    requestPermissions: () => Promise<boolean>;
    checkFirebaseStatus: () => Promise<{
        success: boolean;
        token?: string | null;
        error?: any;
    }>;
    debugInfo: {
        isWebSocketConnected: boolean;
        hasPermission: boolean;
        pushToken: string | null;
    };
}

interface MessageType {
    sender_id: number;
    sender_name?: string;
    count: number;
    last_message?: string;
    timestamp?: string;
    chat_id?: number;
    message_id?: number;
}

interface NotificationData {
    type: string;
    unique_sender_count: number;
    messages: [{ user: string }, MessageType[]];
}

interface UserStatusUpdate {
    type: 'user_status_update';
    user_id: number;
    status: string;
}

const savePushTokenToServer = async (token: string) => {
    try {
        // Определяем тип токена для правильных логов
        const isFirebaseToken = !token.startsWith('ExponentPushToken');
        const logPrefix = isFirebaseToken ? '🔥 [FCM]' : '📱 [EXPO]';

        console.log(`${logPrefix} Начало сохранения токена на сервере`);
        const userToken = await AsyncStorage.getItem('userToken');
        if (!userToken) {
            console.error(`${logPrefix} Нет токена авторизации для сохранения push-токена`);
            return;
        }

        console.log(`${logPrefix} Отправка токена на сервер:`, token.substring(0, 10) + '...');

        // Формируем правильный payload в зависимости от типа токена
        const payload = isFirebaseToken 
            ? { fcm_token: token }
            : { expo_push_token: token };

        const response = await axios.post(
            `${API_CONFIG.BASE_URL}/chat/api/save-push-token/`,
            payload,
            {headers: {'Authorization': `Token ${userToken}`}}
        );

        console.log(`${logPrefix} Ответ сервера при сохранении токена:`, response.status);

        if (response.status === 200) {
            console.log(`${logPrefix} Токен успешно сохранен на сервере`);
        } else {
            console.warn(`${logPrefix} Необычный статус ответа при сохранении токена:`, response.status);
        }
    } catch (error) {
        const isFirebaseToken = !token.startsWith('ExponentPushToken');
        const logPrefix = isFirebaseToken ? '🔥 [FCM]' : '📱 [EXPO]';

        console.error(`${logPrefix} Ошибка при сохранении push-токена:`, error);

        if (axios.isAxiosError(error)) {
            console.error(`${logPrefix} Статус ошибки:`, error.response?.status);
            console.error(`${logPrefix} Данные ошибки:`, error.response?.data);
        }
    }
};

const NotificationContext = createContext<NotificationContextType>({
    unreadCount: 0,
    messages: [],
    senderCounts: new Map(),
    userStatuses: new Map(),
    connect: async () => Promise.resolve(),
    disconnect: () => {
    },
    refreshNotifications: () => {
    },
    requestPermissions: async () => false,
    checkFirebaseStatus: async () => ({success: false, error: 'Not initialized'}),
    debugInfo: {
        isWebSocketConnected: false,
        hasPermission: false,
        pushToken: null,
    },
});


export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({children}) => {
    const [unreadCount, setUnreadCount] = useState<number>(0);
    const [messages, setMessages] = useState<MessageType[]>([]);
    const [senderCounts, setSenderCounts] = useState<Map<number, number>>(new Map());
    const [userStatuses, setUserStatuses] = useState<Map<number, string>>(new Map());
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [hasNotificationPermission, setHasNotificationPermission] = useState<boolean>(false);
    const [pushToken, setPushToken] = useState<string | null>(null);
    const [wsConnected, setWsConnected] = useState<boolean>(false);
    const [isInitialized, setIsInitialized] = useState<boolean>(false);
    const [lastMessageTimestamp, setLastMessageTimestamp] = useState<number>(0);
    const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
    const [isUsingFirebaseNavigation, setIsUsingFirebaseNavigation] = useState<boolean>(false);

    const appState = useRef(AppState.currentState);
    const notificationListener = useRef<Notifications.Subscription | null>(null);
    const responseListener = useRef<Notifications.Subscription | null>(null);
    const previousMessagesRef = useRef<MessageType[]>([]);
    const checkConnectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const lastPingTimeRef = useRef<number>(Date.now());
    const sentNotificationsCache = useRef<Set<string>>(new Set()); // Кеш отправленных уведомлений
    useEffect(() => {
        const setupNotificationChannels = async () => {
            try {
                if (Platform.OS === 'android') {
                    const channels = await Notifications.getNotificationChannelsAsync();
                    const messagesChannel = channels.find(ch => ch.id === 'messages');

                    if (!messagesChannel) {
                        await Notifications.setNotificationChannelAsync('messages', {
                            name: 'Сообщения',
                            importance: Notifications.AndroidImportance.HIGH,
                            sound: 'default',
                            enableVibrate: true,
                            showBadge: true,
                        });
                    }
                }
            } catch (error) {
                console.error('❌ [Notification] Error setting up channels:', error);
            }
        };

        if (isAuthenticated && hasNotificationPermission) {
            setupNotificationChannels();
        }
    }, [isAuthenticated, hasNotificationPermission]);

    // Проверка аутентификации
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const token = await AsyncStorage.getItem('userToken');
                setIsAuthenticated(!!token);
            } catch (error) {
                console.error('❌ [Notification] Error checking auth:', error);
                setIsAuthenticated(false);
            }
        };

        checkAuth();
    }, []);

    // Функция для запроса разрешений
    const requestPermissions = async (): Promise<boolean> => {
        try {
            console.log('🔔 [PUSH] Начинаем запрос разрешений...');
            const currentPermissions = await Notifications.getPermissionsAsync();
            console.log('🔔 [PUSH] Текущий статус разрешений:', currentPermissions.status);

            let hasPermission = currentPermissions.status === 'granted';

            if (!hasPermission) {
                console.log('🔔 [PUSH] Запрашиваем новые разрешения...');
                hasPermission = await requestNotificationPermissions();
                console.log('🔔 [PUSH] Результат запроса разрешений:', hasPermission);
            } else {
                console.log('🔔 [PUSH] Разрешения уже предоставлены');
            }

            setHasNotificationPermission(hasPermission);

            if (hasPermission) {
                console.log('🔔 [PUSH] Запрашиваем push-токен...');
                const token = await registerForPushNotifications();

                if (token) {
                    const isFirebaseToken = !token.startsWith('ExponentPushToken');
                    const logPrefix = isFirebaseToken ? '🔥 [FCM]' : '📱 [EXPO]';

                    console.log(`${logPrefix} Получен токен:`, token.substring(0, 20) + '...');
                    setPushToken(token);
                    console.log(`${logPrefix} Сохраняем токен на сервере...`);
                    await savePushTokenToServer(token);
                } else {
                    console.error('🔔 [PUSH] Не удалось получить push-токен');
                }

                setIsInitialized(true);
                console.log('🔔 [PUSH] Инициализация завершена');
            } else {
                console.warn('🔔 [PUSH] Разрешения не получены, push-уведомления не будут работать');
            }

            return hasPermission;
        } catch (error) {
            console.error('🔔 [PUSH] Ошибка при запросе разрешений:', error);
            setHasNotificationPermission(false);
            return false;
        }
    };

    // Инициализация уведомлений
    useEffect(() => {
        const initNotifications = async () => {
            try {
                // Очищаем старые данные уведомлений при первом запуске
                const lastClearTime = await AsyncStorage.getItem('lastNotificationClear');
                const now = Date.now();
                const oneDayAgo = now - (24 * 60 * 60 * 1000);

                if (!lastClearTime || parseInt(lastClearTime) < oneDayAgo) {
                    // Очищаем старые уведомления раз в день
                    try {
                        await Notifications.dismissAllNotificationsAsync();
                        await AsyncStorage.setItem('lastNotificationClear', now.toString());
                        console.log('🔔 [PUSH] Очищены старые уведомления');
                    } catch (clearError) {
                        console.log('🔔 [PUSH] Ошибка очистки старых уведомлений:', clearError);
                    }
                }

                // Получаем экземпляр Firebase сервиса
                const firebaseService = FirebaseNotificationService.getInstance();

                // Пытаемся инициализировать Firebase сначала
                const firebaseResult = await firebaseService.initialize();

                if (firebaseResult.success && firebaseResult.tokenType === 'fcm') {
                    // Успешная инициализация с нативным Firebase токеном
                    const token = firebaseResult.token;
                    if (token) {
                        console.log('🔥 [FCM] ✅ Используем нативный Firebase FCM токен');
                        setPushToken(token);
                        setHasNotificationPermission(true);
                        setIsInitialized(true);

                        // Добавляем обработчик Firebase сообщений ТОЛЬКО для обновления данных
                        firebaseService.addMessageHandler((messageData) => {
                            console.log('🔥 [FCM] Обработка сообщения Firebase в контексте (только обновление данных)');
                            if (isAuthenticated) {
                                refreshNotifications();
                            }
                        });

                        setIsUsingFirebaseNavigation(true);
                        console.log('🔥 [FCM] Native Firebase уведомления настроены успешно');
                        console.log('🔥 [FCM] Навигация обрабатывается ТОЛЬКО Firebase сервисом');

                        // НЕ настраиваем Expo слушатели - Firebase сервис уже обрабатывает навигацию
                        return;
                    }
                }

                // Fallback на Expo - или Firebase не работает, или это Expo токен через Firebase сервис
                console.log('📱 [EXPO] Настраиваем Expo notifications (Firebase недоступен или это Expo токен)');

                // Если Firebase вернул Expo токен - используем его
                if (firebaseResult.success && firebaseResult.token) {
                    setPushToken(firebaseResult.token);
                    setHasNotificationPermission(true);
                    setIsInitialized(true);
                } else {
                    // Стандартная Expo инициализация
                    const currentPermissions = await Notifications.getPermissionsAsync();
                    const permissionGranted = currentPermissions.status === 'granted';

                    setHasNotificationPermission(permissionGranted);

                    if (permissionGranted) {
                        if (!pushToken) {
                            console.log('📱 [EXPO] Запрашиваем push-токен...');
                            const token = await registerForPushNotifications();

                            if (token) {
                                console.log('📱 [EXPO] Получен Expo токен');
                                setPushToken(token);
                                await savePushTokenToServer(token);
                            } else {
                                console.error('📱 [EXPO] Не удалось получить токен');
                            }
                        }

                        setIsInitialized(true);
                    } else if (currentPermissions.canAskAgain) {
                        console.log('📱 [EXPO] Запрашиваем разрешения для уведомлений...');
                        const granted = await requestPermissions();

                        if (granted && !pushToken) {
                            const token = await registerForPushNotifications();
                            if (token) {
                                setPushToken(token);
                                await savePushTokenToServer(token);
                            }
                        }
                    }
                }

                // Настраиваем Expo слушатели для обработки уведомлений
                console.log('📱 [EXPO] Настраиваем Expo слушатели');

                // Очищаем старые слушатели
                if (notificationListener.current) {
                    notificationListener.current.remove();
                }

                if (responseListener.current) {
                    responseListener.current.remove();
                }

                // Добавляем новые слушатели
                notificationListener.current = addNotificationListener((notification: Notifications.Notification) => {
                    console.log('📱 [EXPO] Получено Expo уведомление:', {
                        title: notification.request.content.title,
                        body: notification.request.content.body,
                        data: notification.request.content.data
                    });

                    if (isAuthenticated) {
                        refreshNotifications();
                    }
                });

                responseListener.current = addNotificationResponseListener((response: Notifications.NotificationResponse) => {
                    console.log('📱 [EXPO] ========== ЕДИНСТВЕННЫЙ ОБРАБОТЧИК НАВИГАЦИИ ==========');
                    console.log('📱 [EXPO] Пользователь нажал на уведомление');

                    // ВСЕГДА обрабатываем навигацию здесь, независимо от типа токена
                    handleNotificationResponse(response);
                });

                // Слушаем изменения состояния приложения
                const subscription = AppState.addEventListener('change', nextAppState => {
                    if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
                        if (isAuthenticated) {
                            refreshNotifications();
                        }
                    }

                    appState.current = nextAppState;
                });

                return () => {
                    if (notificationListener.current) {
                        notificationListener.current.remove();
                    }
                    if (responseListener.current) {
                        responseListener.current.remove();
                    }
                    subscription.remove();
                };
            } catch (error) {
                console.error('❌ [Notification] Error in initNotifications:', error);
            }
        };

        if (isAuthenticated) {
            initNotifications();
        }

    }, [isAuthenticated]);

    // Проверка запуска из уведомления
    useEffect(() => {
        const checkLaunchNotification = async () => {
            try {
                console.log('🔔 [PUSH] Проверяем, было ли приложение запущено из уведомления...');

                // Получаем время запуска приложения из AsyncStorage
                const appLaunchTime = await AsyncStorage.getItem('appLaunchTime');
                const currentLaunchTime = Date.now().toString();

                // Сохраняем текущее время запуска
                await AsyncStorage.setItem('appLaunchTime', currentLaunchTime);

                const lastNotificationResponse = await Notifications.getLastNotificationResponseAsync();

                if (lastNotificationResponse) {
                    const notificationTime = lastNotificationResponse.actionDate;
                    const timeSinceNotification = Date.now() - notificationTime;

                    // Проверяем, что уведомление было нажато недавно (в течение последних 30 секунд)
                    // и это новый запуск приложения
                    const isRecentNotification = timeSinceNotification < 30000; // 30 секунд
                    const isNewAppLaunch = !appLaunchTime || (parseInt(currentLaunchTime) - parseInt(appLaunchTime) > 5000);

                    if (isRecentNotification && isNewAppLaunch) {
                        const isFromFirebase = lastNotificationResponse.notification.request.content.data?.isFirebase === true;
                        const logPrefix = isFromFirebase ? '🔥 [FCM]' : '📱 [EXPO]';

                        console.log(`${logPrefix} Приложение запущено из уведомления!`);
                        console.log(`${logPrefix} Время с момента нажатия: ${Math.round(timeSinceNotification / 1000)}с`);
                        console.log(`${logPrefix} Данные уведомления:`, JSON.stringify(lastNotificationResponse.notification.request.content.data));

                        setTimeout(() => {
                            console.log(`${logPrefix} Обрабатываем уведомление, из которого запущено приложение`);
                            handleNotificationResponse(lastNotificationResponse);
                        }, 1000);
                    } else {
                        console.log('🔔 [PUSH] Приложение запущено обычным способом (уведомление слишком старое или это не новый запуск)');
                        console.log('🔔 [PUSH] Время с момента последнего уведомления:', Math.round(timeSinceNotification / 1000), 'секунд');
                    }
                } else {
                    console.log('🔔 [PUSH] Приложение запущено обычным способом (нет последнего уведомления)');
                }
            } catch (error) {
                console.error('🔔 [PUSH] Ошибка при проверке запуска из уведомления:', error);
            }
        };

        if (isAuthenticated) {
            checkLaunchNotification();
        }
    }, [isAuthenticated]);

    // Обработка ответа на уведомление - ЕДИНСТВЕННОЕ МЕСТО ДЛЯ НАВИГАЦИИ
    const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
        try {
            console.log('📱 [CONTEXT] ========== ОБРАБОТКА НАВИГАЦИИ ==========');

            // Используем data вместо устаревшего dataString
            let data = response.notification.request.content.data;

            // Если data является строкой (старый формат), парсим её
            if (typeof data === 'string') {
                try {
                    data = JSON.parse(data);
                } catch (parseError) {
                    console.warn('🔔 [PUSH] Failed to parse notification data string:', parseError);
                }
            }

            const isFromFirebase = data?.isFirebase === true;
            const logPrefix = isFromFirebase ? '🔥 [FCM]' : '📱 [EXPO]';

            console.log(`${logPrefix} Обработка ответа на уведомление:`, response.notification.request.identifier);
            console.log(`${logPrefix} Данные уведомления:`, JSON.stringify(data));

            if (isAuthenticated) {
                console.log(`${logPrefix} Обновляем данные после нажатия на уведомление`);
                refreshNotifications();
            } else {
                console.log(`${logPrefix} Пользователь не аутентифицирован, пропускаем обновление`);
            }

            if (data?.startfrom !== undefined) {
                console.log(`🔥 [FCM] Уведомление с startfrom:`, data.startfrom);
            }

            if (data && data.type === 'message_notification') {
                console.log(`${logPrefix} Это уведомление о сообщении, выполняем навигацию`);
                console.log(`${logPrefix} Данные для навигации:`, {
                    chatId: data.chatId,
                    senderId: data.senderId || data.sender_id,
                    type: data.type
                });

                if (data.chatId) {
                    console.log(`${logPrefix} Переходим к чату:`, data.chatId);

                    // Простая навигация без задержки
                    try {
                        router.push({
                            pathname: '/chat/[id]' as any,
                            params: {
                                "id": String(data.chatId),
                                "userId": String(data.senderId || data.sender_id)
                            }
                        });
                        console.log(`${logPrefix} ✅ Навигация в чат выполнена успешно`);
                    } catch (navError) {
                        console.error(`${logPrefix} ❌ Ошибка навигации в чат:`, navError);
                        // Fallback - переход к списку сообщений
                        router.push('/(main)/messages');
                    }
                } else {
                    console.log(`${logPrefix} Нет chatId, переходим к списку сообщений`);
                    router.push('/(main)/messages');
                }
            } else {
                console.log(`${logPrefix} Тип уведомления не распознан или не требует навигации`);
                console.log(`${logPrefix} Данные уведомления:`, data);
            }
        } catch (error) {
            console.error('🔔 [PUSH] Ошибка при обработке ответа на уведомление:', error);
        }
    };


    // Функция для отправки локального уведомления
    const sendNotificationWithUserData = async (messageArray: MessageType[]) => {
        try {
            if (!hasNotificationPermission) {
                const granted = await requestPermissions();
                if (!granted) {
                    return;
                }
            }

            if (!messageArray || messageArray.length === 0) {
                return;
            }

            const mostActiveMsg = messageArray.find(msg =>
                msg.count === Math.max(...messageArray.map(m => m.count))
            ) || messageArray[0];

            const currentTime = Date.now();

            if (currentTime - lastMessageTimestamp < 500) {
                return;
            }

            const notificationKey = `${mostActiveMsg.sender_id}_${mostActiveMsg.message_id}_${mostActiveMsg.count}`;

            if (sentNotificationsCache.current.has(notificationKey)) {
                return;
            }

            sentNotificationsCache.current.add(notificationKey);
            setTimeout(() => {
                sentNotificationsCache.current.delete(notificationKey);
            }, 10 * 60 * 1000);

            let senderInfo = mostActiveMsg.sender_name || `Пользователь ${mostActiveMsg.sender_id}`;
            let notificationBody = mostActiveMsg.last_message || 'Новое сообщение';

            // Если сообщение слишком длинное, обрезаем его
            if (notificationBody.length > 50) {
                notificationBody = notificationBody.substring(0, 50) + '...';
            }

            if (messageArray.length > 1) {
                const totalMessages = messageArray.reduce((sum, msg) => sum + msg.count, 0);
                notificationBody += ` (и еще ${totalMessages - mostActiveMsg.count} от других)`;
            } else if (mostActiveMsg.count > 1) {
                notificationBody += ` (+${mostActiveMsg.count - 1})`;
            }

            setLastMessageTimestamp(currentTime);

            const notificationResult = await sendHighPriorityNotification({
                title: `💌 ${senderInfo}`,
                body: notificationBody,
                data: {
                    type: 'message_notification',
                    timestamp: currentTime,
                    sender_id: mostActiveMsg.sender_id,
                    message_count: mostActiveMsg.count,
                    chatId: mostActiveMsg.chat_id,
                    category: 'message',
                    notification_id: currentTime.toString()
                }
            });

            // Добавляем в кеш отправленных уведомлений
            sentNotificationsCache.current.add(notificationKey);

            // Очищаем кеш от старых записей (оставляем только последние 50)
            if (sentNotificationsCache.current.size > 50) {
                const entries = Array.from(sentNotificationsCache.current);
                sentNotificationsCache.current.clear();
                entries.slice(-25).forEach(key => sentNotificationsCache.current.add(key));
            }
        } catch (error) {
            console.error('❌ [Notification] Error in sendNotificationWithUserData:', error);
        }
    };

    // Функция для отправки пинга
    const sendPing = () => {
        if (isConnected()) {
            sendMessage({type: 'ping'});
            lastPingTimeRef.current = Date.now();
        }
    };

    // Проверка состояния соединения
    const checkConnection = () => {
        const now = Date.now();
        // Если последний пинг был отправлен более 45 секунд назад и соединение считается активным
        if (now - lastPingTimeRef.current > 45000 && isConnected()) {
            console.log('🔌 [WS] ⚠️ Connection seems stale, attempting to reconnect...');
            reconnect();
        }
    };

// Обработчик сообщений WebSocket
    const handleMessage = (event: any) => {
        try {
            const data = JSON.parse(event.data);
            lastPingTimeRef.current = Date.now();

            if (reconnectAttempts > 0) {
                setReconnectAttempts(0);
            }

            if (data.type === 'pong') {
                return;
            }

            if (data.type === 'user_status_update') {
                const statusUpdate = data as UserStatusUpdate;
                setUserStatuses(prevStatuses => {
                    const newStatuses = new Map(prevStatuses);
                    newStatuses.set(statusUpdate.user_id, statusUpdate.status);
                    return newStatuses;
                });
                return;
            }

            if (data.type === 'notification_update' || data.type === 'new_message_notification') {
                let messageArray: MessageType[] = [];
                if (data.messages && Array.isArray(data.messages)) {
                    if (data.messages.length === 2 && Array.isArray(data.messages[1])) {
                        messageArray = data.messages[1];
                    } else {
                        messageArray = data.messages;
                    }
                }

                if (messageArray && messageArray.length > 0) {
                    setMessages(messageArray);

                    const newSenderCounts = new Map<number, number>();
                    messageArray.forEach(message => {
                        newSenderCounts.set(message.sender_id, message.count);
                    });
                    setSenderCounts(newSenderCounts);

                    // Обновляем общий счетчик
                    if (data.unique_sender_count !== undefined) {
                        setUnreadCount(data.unique_sender_count);
                    } else {
                        setUnreadCount(messageArray.length);
                    }

                    // Показываем уведомление только если есть разрешения
                    if (hasNotificationPermission && AppState.currentState !== 'active') {
                        setTimeout(() => {
                            sendNotificationWithUserData(messageArray);
                        }, 300);
                    }
                }
                return;
            }

            // Обработка индивидуального сообщения
            if (data.type === 'individual_message') {
                const messageData = data.message;
                if (messageData) {
                    // Обновляем Map для этого отправителя
                    setSenderCounts(prevCounts => {
                        const newCounts = new Map(prevCounts);
                        newCounts.set(messageData.sender_id, messageData.count);
                        return newCounts;
                    });

                    // Также обновляем массив сообщений
                    setMessages(prevMessages => {
                        // Ищем, есть ли уже сообщение от этого отправителя
                        const index = prevMessages.findIndex(msg => msg.sender_id === messageData.sender_id);

                        let updatedMessages;
                        if (index !== -1) {
                            // Обновляем существующее сообщение
                            updatedMessages = [...prevMessages];
                            updatedMessages[index] = messageData;
                        } else {
                            // Добавляем новое сообщение
                            updatedMessages = [...prevMessages, messageData];
                        }

                        // Определяем, нужно ли показать уведомление
                        const previousMsg = previousMessagesRef.current.find(m => m.sender_id === messageData.sender_id);
                        const isNewOrUpdated = true; // Всегда true для рабочего режима

                        if (isNewOrUpdated && hasNotificationPermission) {
                            setTimeout(async () => {
                                try {
                                    await sendNotificationWithUserData([messageData]);
                                } catch (error) {
                                    console.error('❌ [Notification] Error in sendNotificationWithUserData:', error);
                                }
                            }, 300);
                        }

                        // Обновляем ссылку на предыдущие сообщения
                        previousMessagesRef.current = updatedMessages;

                        return updatedMessages;
                    });

                    // Обновляем счетчик уникальных отправителей
                    if (data.unique_sender_count !== undefined) {
                        setUnreadCount(data.unique_sender_count);
                    }
                }
                return;
            }

            // Обработка начальных и обновленных данных
            if (data.type === 'initial_notification' || data.type === 'messages_by_sender_update') {
                // Извлекаем массив сообщений
                let messageArray: MessageType[] = [];

                if (Array.isArray(data.messages)) {
                    if (data.messages.length === 2 && Array.isArray(data.messages[1])) {
                        // Формат [user_info, message_array]
                        messageArray = data.messages[1];
                    } else {
                        // Простой массив сообщений
                        messageArray = data.messages;
                    }
                }

                if (messageArray && messageArray.length > 0) {
                    // Обновляем массив сообщений
                    setMessages(messageArray);

                    // Создаем новую Map для счетчиков сообщений
                    const newSenderCounts = new Map<number, number>();
                    messageArray.forEach(message => {
                        newSenderCounts.set(message.sender_id, message.count);
                    });

                    // Устанавливаем новые счетчики
                    setSenderCounts(newSenderCounts);

                    // Используем уникальный счетчик отправителей из ответа сервера
                    if (data.unique_sender_count !== undefined) {
                        setUnreadCount(data.unique_sender_count);
                    } else {
                        // Если сервер не предоставил счетчик, вычисляем его как количество отправителей
                        setUnreadCount(messageArray.length);
                    }

                    // Показываем уведомления для обновлений (но не для начальных данных) и только если приложение неактивно
                    if (data.type === 'messages_by_sender_update' && AppState.currentState !== 'active') {
                        const previousMessages = previousMessagesRef.current;
                        const hasChanges = messageArray.some(newMsg => {
                            const prevMsg = previousMessages.find(m => m.sender_id === newMsg.sender_id);
                            return !prevMsg || newMsg.count > prevMsg.count;
                        });

                        if (hasChanges && hasNotificationPermission) {
                            setTimeout(() => {
                                sendNotificationWithUserData(messageArray);
                            }, 300);
                        }
                    }

                    // Сохраняем для следующего сравнения
                    previousMessagesRef.current = [...messageArray];

                    // Помечаем как инициализированный после первого получения данных
                    if (!isInitialized) {
                        setIsInitialized(true);
                    }
                } else {
                    // Если список сообщений пуст, сбрасываем счетчики
                    setSenderCounts(new Map());
                    setUnreadCount(0);
                    setMessages([]);
                    previousMessagesRef.current = [];

                    // Все равно помечаем как инициализированный
                    if (!isInitialized) {
                        setIsInitialized(true);
                    }
                }
            }
        } catch (error) {
            console.error('❌ [Notification] Error processing WebSocket message:', error);
        }
    }

    // Инициализация WebSocket
    const {connect, disconnect, sendMessage, isConnected, reconnect} = useWebSocket(`/wss/notification/`, {
        onOpen: () => {
            setWsConnected(true);
            setReconnectAttempts(0);
            // Сбрасываем кеши при переподключении для корректного сравнения
            previousMessagesRef.current = [];
            sentNotificationsCache.current.clear();
            sendMessage({type: 'get_initial_data'});
            lastPingTimeRef.current = Date.now();
            setTimeout(async () => {
                try {
                    const currentPermissions = await Notifications.getPermissionsAsync();
                    const permissionGranted = currentPermissions.status === 'granted';
                    setHasNotificationPermission(permissionGranted);
                } catch (error) {
                    console.error('❌ [Notification] Error syncing permissions:', error);
                }
            }, 1000);
        },
        onMessage: handleMessage,
        onClose: (event: any) => {
            setWsConnected(false);

            // Увеличиваем счетчик попыток переподключения
            const newAttempts = reconnectAttempts + 1;
            setReconnectAttempts(newAttempts);
        },
        onError: (error: any) => {
            console.error('❌ [Notification] WebSocket error:', error);
            setWsConnected(false);
        },
    });

    // Функция обновления уведомлений
    const refreshNotifications = () => {
        if (isConnected()) {
            sendMessage({type: 'get_initial_data'});
            lastPingTimeRef.current = Date.now();
        } else {
            reconnect();
        }
    };

    // Подключаемся при аутентификации
    useEffect(() => {
        if (isAuthenticated) {
            connect();

            // Настраиваем проверку соединения и пинги
            if (checkConnectionIntervalRef.current) {
                clearInterval(checkConnectionIntervalRef.current);
            }

            checkConnectionIntervalRef.current = setInterval(() => {
                // Отправляем пинг каждые 30 секунд
                sendPing();
                // Проверяем состояние соединения каждые 30 секунд
                checkConnection();
            }, 30000);
        }

        return () => {
            if (isAuthenticated) {
                disconnect();

                if (checkConnectionIntervalRef.current) {
                    clearInterval(checkConnectionIntervalRef.current);
                    checkConnectionIntervalRef.current = null;
                }
            }
        };
    }, [isAuthenticated]);

    // Периодическое обновление
    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;

        if (isAuthenticated && wsConnected) {
            interval = setInterval(() => {
                refreshNotifications();
            }, 60000);  // Каждые 60 секунд
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [isAuthenticated, wsConnected]);

    // Функция для проверки статуса push-уведомлений
    const checkFirebaseStatus = async () => {
        try {
            console.log('🔔 [PUSH] Проверка статуса push-уведомлений...');
            console.log('🔔 [PUSH] Текущие разрешения:', await Notifications.getPermissionsAsync());

            if (pushToken) {
                const isFirebaseToken = !pushToken.startsWith('ExponentPushToken');
                const logPrefix = isFirebaseToken ? '🔥 [FCM]' : '📱 [EXPO]';
                console.log(`${logPrefix} Push-токен:`, pushToken.substring(0, 15) + '...');
            } else {
                console.log('🔔 [PUSH] Push-токен: отсутствует');
            }

            if (!pushToken) {
                console.log('🔔 [PUSH] Попытка повторного получения push-токена...');
                const token = await registerForPushNotifications();

                if (token) {
                    const isFirebaseToken = !token.startsWith('ExponentPushToken');
                    const logPrefix = isFirebaseToken ? '🔥 [FCM]' : '📱 [EXPO]';
                    console.log(`${logPrefix} Результат получения токена: Успешно`);

                    setPushToken(token);
                    await savePushTokenToServer(token);
                    console.log(`${logPrefix} Токен успешно обновлен`);
                    return {success: true, token};
                } else {
                    console.log('🔔 [PUSH] Не удалось получить токен при проверке');
                    return {success: false, error: 'Не удалось получить токен'};
                }
            }

            return {success: true, token: pushToken};
        } catch (error) {
            console.error('🔔 [PUSH] Ошибка при проверке статуса push-уведомлений:', error);
            return {success: false, error};
        }
    };

    // Контекстное значение
    const value = {
        unreadCount,
        messages,
        senderCounts,
        userStatuses,
        connect,
        disconnect,
        refreshNotifications,
        requestPermissions,
        checkFirebaseStatus,
        debugInfo: {
            isWebSocketConnected: wsConnected,
            hasPermission: hasNotificationPermission,
            pushToken,
        },
    };

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
};

// Хук для использования контекста
export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
};