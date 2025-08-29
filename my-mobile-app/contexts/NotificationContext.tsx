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
        console.log('🔥 [FCM] Начало сохранения FCM токена на сервере');

        // КРИТИЧНО: отклоняем любые Expo токены
        if (token.startsWith('ExponentPushToken')) {
            console.error('🔥 [FCM] ❌ Попытка сохранить Expo токен - отклоняем');
            console.error('🔥 [FCM] ❌ Expo токены больше не поддерживаются');
            return;
        }

        const userToken = await AsyncStorage.getItem('userToken');
        if (!userToken) {
            console.error('🔥 [FCM] Нет токена авторизации для сохранения FCM токена');
            return;
        }

        console.log('🔥 [FCM] Отправка FCM токена на сервер:', token.substring(0, 10) + '...');

        // Отправляем ТОЛЬКО FCM токен
        const payload = { fcm_token: token };

        const response = await axios.post(
            `${API_CONFIG.BASE_URL}/chat/api/save-push-token/`,
            payload,
            {headers: {'Authorization': `Token ${userToken}`}}
        );

        console.log('🔥 [FCM] Ответ сервера при сохранении FCM токена:', response.status);

        if (response.status === 200) {
            console.log('🔥 [FCM] FCM токен успешно сохранен на сервере');
        } else {
            console.warn('🔥 [FCM] Необычный статус ответа при сохранении FCM токена:', response.status);
        }
    } catch (error) {
        console.error('🔥 [FCM] Ошибка при сохранении FCM токена:', error);

        if (axios.isAxiosError(error)) {
            console.error('🔥 [FCM] Статус ошибки:', error.response?.status);
            console.error('🔥 [FCM] Данные ошибки:', error.response?.data);
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

                // ПРИОРИТЕТ: только Firebase FCM токены
                console.log('🔥 [FCM] Инициализируем только Firebase FCM (без Expo fallback)');
                const firebaseResult = await firebaseService.initialize();

                if (firebaseResult.success && firebaseResult.token) {
                    const token = firebaseResult.token;

                    // Проверяем, что это именно FCM токен (не Expo)
                    const isFCMToken = !token.startsWith('ExponentPushToken');

                    if (isFCMToken) {
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

                        // Сохраняем токен на сервере
                        await savePushTokenToServer(token);

                        setIsUsingFirebaseNavigation(true);
                        console.log('🔥 [FCM] Firebase FCM уведомления настроены успешно');
                        console.log('🔥 [FCM] Навигация обрабатывается ТОЛЬКО Firebase сервисом');

                        // НЕ настраиваем Expo слушатели - Firebase сервис уже обрабатывает навигацию
                        return;
                    } else {
                        console.warn('📱 [EXPO] Firebase сервис вернул Expo токен - отклоняем');
                    }
                }

                // Если Firebase не работает - показываем ошибку
                console.error('🔥 [FCM] ❌ Firebase FCM недоступен - push-уведомления отключены');
                console.error('🔥 [FCM] ❌ Проверьте настройки Firebase в приложении');
                console.error('🔥 [FCM] ❌ Убедитесь, что google-services.json правильно настроен');

                setHasNotificationPermission(false);
                setIsInitialized(false);

            } catch (error) {
                console.error('🔥 [FCM] ❌ Ошибка инициализации Firebase FCM:', error);
                console.error('🔥 [FCM] ❌ Push-уведомления будут отключены');

                setHasNotificationPermission(false);
                setIsInitialized(false);
                setPushToken(null);
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
                    const notificationTime = lastNotificationResponse.notification.date;
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
        const connectionState = isConnected();
        console.log('🏓 [PING] Attempting to send ping:', {
            isConnected: connectionState,
            lastPing: new Date(lastPingTimeRef.current).toISOString(),
            timeSinceLastPing: Date.now() - lastPingTimeRef.current
        });

        if (connectionState) {
            const pingMessage = {type: 'ping'};
            console.log('🏓 [PING] Ping message object:', pingMessage);
            sendMessage(pingMessage);
            lastPingTimeRef.current = Date.now();
            console.log('🏓 [PING] ✅ Ping sent successfully');
        } else {
            console.log('🏓 [PING] ❌ Cannot send ping - not connected');
        }
    };

    // Проверка состояния соединения
    const checkConnection = () => {
        const now = Date.now();
        const timeSincePing = now - lastPingTimeRef.current;
        const connectionState = isConnected();
        const wsConnectedState = wsConnected;

        console.log('🔍 [CONNECTION-CHECK] Checking connection health:', {
            timeSincePing: timeSincePing,
            isConnected: connectionState,
            wsConnected: wsConnectedState,
            threshold: 45000,
            isAuthenticated: isAuthenticated
        });

        // ИСПРАВЛЯЕМ ЛОГИКУ: переподключаемся если НЕТ соединения ИЛИ оно зависло
        const shouldReconnect = !connectionState || !wsConnectedState || timeSincePing > 45000;

        console.log('🔍 [CONNECTION-CHECK] Reconnection decision:', {
            noConnection: !connectionState,
            notWsConnected: !wsConnectedState,
            staleConnection: timeSincePing > 45000,
            shouldReconnect: shouldReconnect,
            isAuthenticated: isAuthenticated
        });

        if (shouldReconnect && isAuthenticated) {
            console.log('🔍 [CONNECTION-CHECK] ⚠️ Connection problem detected, attempting to reconnect...');
            console.log('🔍 [CONNECTION-CHECK] 🔄 Initiating reconnection...');
            reconnect();
        } else if (!isAuthenticated) {
            console.log('🔍 [CONNECTION-CHECK] ❌ Not authenticated, skipping reconnect');
        } else {
            console.log('🔍 [CONNECTION-CHECK] ✅ Connection appears healthy');
        }
    };

// Обработчик сообщений WebSocket
    const handleMessage = (event: any) => {
        try {
            console.log('📨 [CONTEXT] ========== MESSAGE RECEIVED ==========');
            console.log('📨 [CONTEXT] Raw event data:', event.data);

            const data = JSON.parse(event.data);
            lastPingTimeRef.current = Date.now();

            console.log('📨 [CONTEXT] Parsed message:', {
                type: data.type,
                timestamp: new Date().toISOString(),
                dataKeys: Object.keys(data),
                hasTrigerUpdate: !!data.trigger_update
            });

            if (reconnectAttempts > 0) {
                console.log('📨 [CONTEXT] Resetting reconnect attempts from', reconnectAttempts, 'to 0');
                setReconnectAttempts(0);
            }

            if (data.type === 'pong') {
                console.log('📨 [CONTEXT] ✅ Received pong response');
                return;
            }

            // Обработка принудительного обновления (например, после прочтения сообщений)
            if (data.trigger_update) {
                console.log('📨 [CONTEXT] 🔥 Forced update triggered, clearing caches and requesting fresh data');
                previousMessagesRef.current = [];
                sentNotificationsCache.current.clear();

                // Запрашиваем свежие данные немедленно
                setTimeout(() => {
                    console.log('📨 [CONTEXT] 🔥 Requesting fresh data after forced update');
                    if (isConnected() && wsConnected) {
                        sendMessage({type: 'get_initial_data'});
                    }
                }, 50);
                return; // Выходим, чтобы не обрабатывать это сообщение дальше
            }

            if (data.type === 'user_status_update') {
                console.log('👤 [STATUS] Processing user status update:', {
                    userId: data.user_id,
                    status: data.status,
                    currentStatusesCount: userStatuses.size
                });

                const statusUpdate = data as UserStatusUpdate;
                setUserStatuses(prevStatuses => {
                    const newStatuses = new Map(prevStatuses);
                    const oldStatus = newStatuses.get(statusUpdate.user_id);
                    newStatuses.set(statusUpdate.user_id, statusUpdate.status);

                    console.log('👤 [STATUS] Status updated:', {
                        userId: statusUpdate.user_id,
                        oldStatus,
                        newStatus: statusUpdate.status,
                        totalStatuses: newStatuses.size,
                        allStatuses: Array.from(newStatuses.entries())
                    });

                    return newStatuses;
                });

                // Принудительно обновляем уведомления при изменении статуса пользователя
                console.log('👤 [STATUS] Triggering notification refresh due to status change');
                setTimeout(() => {
                    if (isConnected() && wsConnected) {
                        console.log('👤 [STATUS] Requesting fresh data after status update');
                        sendMessage({type: 'get_initial_data'});
                    }
                }, 100);

                return;
            }

            if (data.type === 'notification_update' || data.type === 'new_message_notification') {
                console.log('🔔 [NOTIFICATION] Processing notification update:', {
                    type: data.type,
                    hasMessages: !!data.messages,
                    messagesType: Array.isArray(data.messages) ? 'array' : typeof data.messages,
                    messagesLength: Array.isArray(data.messages) ? data.messages.length : 'N/A',
                    uniqueSenderCount: data.unique_sender_count,
                    triggerUpdate: data.trigger_update
                });

                // Если это принудительное обновление, запрашиваем свежие данные
                if (data.trigger_update) {
                    console.log('🔔 [NOTIFICATION] Forced update detected, requesting fresh data...');
                    setTimeout(() => {
                        const refreshMessage = {type: 'get_initial_data'};
                        console.log('🔔 [NOTIFICATION] Requesting fresh data after trigger');
                        sendMessage(refreshMessage);
                    }, 100);
                    return;
                }

                let messageArray: MessageType[] = [];
                if (data.messages && Array.isArray(data.messages)) {
                    if (data.messages.length === 2 && Array.isArray(data.messages[1])) {
                        messageArray = data.messages[1];
                        console.log('🔔 [NOTIFICATION] Using nested array format, extracted', messageArray.length, 'messages');
                    } else {
                        messageArray = data.messages;
                        console.log('🔔 [NOTIFICATION] Using direct array format,', messageArray.length, 'messages');
                    }
                } else {
                    console.log('🔔 [NOTIFICATION] No valid messages array found, clearing state');
                    // Если нет сообщений, очищаем состояние
                    setMessages([]);
                    setSenderCounts(new Map());
                    setUnreadCount(0);
                    return;
                }

                console.log('🔔 [NOTIFICATION] Processing', messageArray.length, 'messages:', 
                    messageArray.map(m => ({id: m.sender_id, count: m.count, hasMessage: !!m.last_message}))
                );

                setMessages(messageArray);

                const newSenderCounts = new Map<number, number>();
                messageArray.forEach(message => {
                    newSenderCounts.set(message.sender_id, message.count);
                });
                setSenderCounts(newSenderCounts);

                console.log('🔔 [NOTIFICATION] Updated sender counts:', Array.from(newSenderCounts.entries()));

                // Обновляем общий счетчик
                const newUnreadCount = data.unique_sender_count !== undefined ? data.unique_sender_count : messageArray.length;
                setUnreadCount(newUnreadCount);

                console.log('🔔 [NOTIFICATION] Updated unread count to:', newUnreadCount);

                // Показываем уведомление только если есть разрешения
                const shouldShowNotification = hasNotificationPermission && AppState.currentState !== 'active' && messageArray.length > 0;
                console.log('🔔 [NOTIFICATION] Should show notification?', {
                    hasPermission: hasNotificationPermission,
                    appState: AppState.currentState,
                    hasMessages: messageArray.length > 0,
                    willShow: shouldShowNotification
                });

                if (shouldShowNotification) {
                    setTimeout(() => {
                        console.log('🔔 [NOTIFICATION] Triggering notification display...');
                        sendNotificationWithUserData(messageArray);
                    }, 300);
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
                console.log('📊 [DATA] Processing data update:', {
                    type: data.type,
                    hasMessages: !!data.messages,
                    uniqueSenderCount: data.unique_sender_count
                });

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

                console.log('📊 [DATA] Extracted messages:', messageArray.length);

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

                    console.log('📊 [DATA] Updated counts:', {
                        senders: Array.from(newSenderCounts.entries()),
                        unreadCount: data.unique_sender_count !== undefined ? data.unique_sender_count : messageArray.length
                    });

                    // Показываем уведомления для обновлений (но не для начальных данных) и только если приложение неактивно
                    if (data.type === 'messages_by_sender_update' && AppState.currentState !== 'active') {
                        const previousMessages = previousMessagesRef.current;
                        const hasChanges = messageArray.some(newMsg => {
                            const prevMsg = previousMessages.find(m => m.sender_id === newMsg.sender_id);
                            return !prevMsg || newMsg.count > prevMsg.count;
                        });

                        if (hasChanges && hasNotificationPermission) {
                            console.log('📊 [DATA] Changes detected, showing notification');
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
                    console.log('📊 [DATA] No messages, clearing state');
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
            console.log('🔌 [WS-CONTEXT] ========== WebSocket OPENED ==========');
            console.log('🔌 [WS-CONTEXT] Connection established successfully!');

            setWsConnected(true);
            setReconnectAttempts(0);

            // Сбрасываем кеши при переподключении для корректного сравнения
            console.log('🔌 [WS-CONTEXT] Clearing caches and resetting state...');
            previousMessagesRef.current = [];
            sentNotificationsCache.current.clear();

            console.log('🔌 [WS-CONTEXT] Requesting initial data...');
            const initialDataMessage = {type: 'get_initial_data'};
            console.log('🔌 [WS-CONTEXT] Initial data message object:', initialDataMessage);
            sendMessage(initialDataMessage);
            lastPingTimeRef.current = Date.now();

            // Тестируем получение статусов через 3 секунды
            setTimeout(() => {
                console.log('🧪 [TEST] Testing user status data:');
                console.log('🧪 [TEST] Current userStatuses Map size:', userStatuses.size);
                console.log('🧪 [TEST] Current userStatuses content:', Array.from(userStatuses.entries()));
                console.log('🧪 [TEST] Current unreadCount:', unreadCount);
                console.log('🧪 [TEST] Current messages count:', messages.length);
            }, 3000);

            // Синхронизация разрешений
            setTimeout(async () => {
                try {
                    console.log('🔌 [WS-CONTEXT] Syncing notification permissions...');
                    const currentPermissions = await Notifications.getPermissionsAsync();
                    const permissionGranted = currentPermissions.status === 'granted';
                    console.log('🔌 [WS-CONTEXT] Permission status:', permissionGranted);
                    setHasNotificationPermission(permissionGranted);
                } catch (error) {
                    console.error('❌ [WS-CONTEXT] Error syncing permissions:', error);
                }
            }, 1000);
        },
        onMessage: handleMessage,
        onClose: (event: any) => {
            console.log('🔌 [WS-CONTEXT] ========== WebSocket CLOSED ==========');
            console.log('🔌 [WS-CONTEXT] Connection lost:', {
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean
            });

            setWsConnected(false);

            // Увеличиваем счетчик попыток переподключения
            const newAttempts = reconnectAttempts + 1;
            console.log('🔌 [WS-CONTEXT] Incrementing reconnect attempts:', newAttempts);
            setReconnectAttempts(newAttempts);
        },
        onError: (error: any) => {
            console.error('🔌 [WS-CONTEXT] ========== WebSocket ERROR ==========');
            console.error('❌ [WS-CONTEXT] WebSocket error occurred:', error);
            console.error('❌ [WS-CONTEXT] Error details:', {
                message: error.message,
                type: error.type,
                target: error.target
            });
            setWsConnected(false);
        },
    });

    // Функция обновления уведомлений - событийно-управляемая
    const refreshNotifications = () => {
        const connectionState = isConnected();
        const wsConnectedState = wsConnected;

        console.log('🔄 [REFRESH] Event-driven notification refresh:', {
            isConnected: connectionState,
            wsConnected: wsConnectedState,
            isAuthenticated: isAuthenticated,
            timestamp: new Date().toISOString()
        });

        if (connectionState && wsConnectedState) {
            console.log('🔄 [REFRESH] ✅ Connection healthy, requesting data...');
            const refreshMessage = {type: 'get_initial_data'};
            console.log('🔄 [REFRESH] Refresh message object:', refreshMessage);
            sendMessage(refreshMessage);
            lastPingTimeRef.current = Date.now();
        } else {
            console.log('🔄 [REFRESH] ❌ Connection unhealthy, reconnecting...');
            console.log('🔄 [REFRESH] Connection details:', {
                isConnected: connectionState,
                wsConnected: wsConnectedState,
                willReconnect: isAuthenticated
            });

            if (isAuthenticated) {
                reconnect();
            } else {
                console.log('🔄 [REFRESH] Cannot reconnect - not authenticated');
            }
        }
    };

    // Подключаемся при аутентификации
    useEffect(() => {
        console.log('🔐 [AUTH] Authentication state changed:', {
            isAuthenticated,
            wasConnected: wsConnected,
            intervalExists: !!checkConnectionIntervalRef.current
        });

        if (isAuthenticated) {
            console.log('🔐 [AUTH] ✅ User authenticated - starting WebSocket connection...');

            // Даем небольшую задержку для стабилизации состояния
            setTimeout(() => {
                console.log('🔐 [AUTH] 🚀 Initiating connection after auth...');
                connect();
            }, 500);

            // Настраиваем проверку соединения и пинги
            if (checkConnectionIntervalRef.current) {
                console.log('🔐 [AUTH] 🧹 Clearing existing connection interval');
                clearInterval(checkConnectionIntervalRef.current);
            }

            console.log('🔐 [AUTH] ⏰ Setting up ping/health check interval (30s)');
            checkConnectionIntervalRef.current = setInterval(() => {
                console.log('⏰ [INTERVAL] Running scheduled connection maintenance...');

                // Дополнительная диагностика
                console.log('⏰ [INTERVAL] Current system state:', {
                    isAuthenticated: isAuthenticated,
                    wsConnected: wsConnected,
                    isConnectedFunc: isConnected(),
                    lastPing: new Date(lastPingTimeRef.current).toISOString(),
                    timeSinceLastPing: Date.now() - lastPingTimeRef.current
                });

                // Отправляем пинг каждые 30 секунд
                sendPing();
                // Проверяем состояние соединения каждые 30 секунд
                checkConnection();
            }, 30000);

            // Дополнительная проверка через 5 секунд после аутентификации
            setTimeout(() => {
                console.log('🔐 [AUTH] 📊 Post-auth connection check:');
                console.log('🔐 [AUTH] Connection status:', {
                    wsConnected: wsConnected,
                    isConnected: isConnected(),
                    isAuthenticated: isAuthenticated
                });

                if (!wsConnected && !isConnected()) {
                    console.log('🔐 [AUTH] ⚠️ Connection failed after auth, retrying...');
                    reconnect();
                }
            }, 5000);

        } else {
            console.log('🔐 [AUTH] ❌ User not authenticated - skipping WebSocket connection');
        }

        return () => {
            console.log('🔐 [AUTH] 🧹 Cleanup function called for authentication effect');
            if (isAuthenticated) {
                console.log('🔐 [AUTH] 🔌 Disconnecting WebSocket...');
                disconnect();

                if (checkConnectionIntervalRef.current) {
                    console.log('🔐 [AUTH] ⏰ Clearing connection interval');
                    clearInterval(checkConnectionIntervalRef.current);
                    checkConnectionIntervalRef.current = null;
                }
            }
        };
    }, [isAuthenticated]);

    // Удалено периодическое обновление - теперь используем только событийно-управляемые обновления
    // Обновления происходят при: подключении, получении сообщений, изменении статуса, принудительных триггерах

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