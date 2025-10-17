import React, {createContext, useContext, useEffect, useState, useRef} from 'react';
import {useWebSocket} from '../hooks/useWebSocket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {router} from 'expo-router';
import {AppState, Platform, Vibration} from 'react-native';
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


        // Отправляем ТОЛЬКО FCM токен
        const payload = { fcm_token: token };

        const response = await axios.post(
            `${API_CONFIG.BASE_URL}/chat/api/save-push-token/`,
            payload,
            {headers: {'Authorization': `Token ${userToken}`}}
        );


        if (response.status === 200) {
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
    // const sentNotificationsCache = useRef<Set<string>>(new Set()); // Удалён лишний кеш
    const globalNotificationCache = useRef<Set<string>>(new Set()); // Глобальный кеш ВСЕХ уведомлений (Firebase + локальные)
    const lastNavigationTime = useRef<number>(0);
    const lastNavigatedChatId = useRef<string | null>(null);
    const isNavigating = useRef<boolean>(false);
    const listenerInitialized = useRef<boolean>(false);
    // Очередь сообщений, используемая processNotificationQueue и queueNotification
    const notificationQueueRef = useRef<MessageType[]>([]); // Хранит сообщения до обработки
    const notificationBuffer = useRef<MessageType[]>([]); // Буфер для группировки уведомлений
    const notificationDebounceTimer = useRef<NodeJS.Timeout | null>(null); // Таймер для дебаунсинга
    // Хранилище ID локальных уведомлений, сгруппированных по chatId
    const chatNotificationIds = useRef<Map<string, Set<string>>>(new Map());
    // Очередь сообщений, используемую processNotificationQueue\
    // Флаг, чтобы добавить Firebase‑handler только один раз
    const firebaseHandlerAdded = useRef<boolean>(false);

    /**
     * Единая функция для добавления сообщений в буфер.
     * Гарантирует отсутствие дублирования через глобальный кеш.
     * Формирует ключ `${senderId}_${messageId || 'none'}_${count}`.
     */
    function enqueueNotification(msgArray: MessageType[]): void {
        if (!msgArray || msgArray.length === 0) return;

        // Добавляем сообщения в очередь, которая обрабатывается processNotificationQueue
        notificationQueueRef.current.push(...msgArray);
        console.log('🔔 [Notification] Enqueued', msgArray.length, 'message(s) into queue');

        // Перезапускаем таймер дебаунса (800 мс)
        if (notificationDebounceTimer.current) {
            clearTimeout(notificationDebounceTimer.current);
        }
        notificationDebounceTimer.current = setTimeout(() => {
            processNotificationQueue();
            notificationDebounceTimer.current = null;
        }, 800);
    }

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
                setIsAuthenticated(false);
            }
        };

        checkAuth();
    }, []);

    // Функция для запроса разрешений
    const requestPermissions = async (): Promise<boolean> => {
        try {
            const currentPermissions = await Notifications.getPermissionsAsync();

            let hasPermission = currentPermissions.status === 'granted';

            if (!hasPermission) {
                hasPermission = await requestNotificationPermissions();
            }

            setHasNotificationPermission(hasPermission);

            if (hasPermission) {
                const token = await registerForPushNotifications();

                if (token) {
                    const isFirebaseToken = !token.startsWith('ExponentPushToken');

                    if (isFirebaseToken) {
                        console.log('🔥 [FCM] Получен токен:', token.substring(0, 20) + '...');
                    }
                    setPushToken(token);
                    await savePushTokenToServer(token);
                }

                setIsInitialized(true);
            }

            return hasPermission;
        } catch (error) {
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
                    } catch (clearError) {
                    }
                }

                // Получаем экземпляр Firebase сервиса
                const firebaseService = FirebaseNotificationService.getInstance();

                // ПРИОРИТЕТ: только Firebase FCM токены
                console.log('🔥 [FCM] Инициализируем Firebase FCM сервис...');
                const firebaseResult = await firebaseService.initialize();

                if (firebaseResult.success && firebaseResult.token) {
                    const token = firebaseResult.token;
                    const isFCMToken = !token.startsWith('ExponentPushToken');
                    if (isFCMToken) {
                        setPushToken(token);
                        setHasNotificationPermission(true);
                        setIsInitialized(true);

                        // Сохраняем токен на сервере ПЕРЕД добавлением обработчика
                        await savePushTokenToServer(token);

                        setIsUsingFirebaseNavigation(true);
                    }

                    // Даем Firebase время полностью инициализироваться

                    setTimeout(async () => {
                        // Получаем status чтобы проверить текущее количество handlers
                        const currentStatus = await firebaseService.getStatus();

                        const messageHandler = (messageData: any) => {
                            console.log('🔥 [FCM] === Firebase message handler triggered ===');
                            console.log('🔥 [FCM] Message data:', {
                                title: messageData?.title,
                                senderId: messageData?.data?.senderId,
                                chatId: messageData?.data?.chatId,
                            });

                            // Добавляем в глобальный кеш чтобы предотвратить дублирование с локальными уведомлениями
                            const firebaseKey = `firebase_${messageData?.data?.senderId || 'unknown'}_${Date.now()}`;
                            globalNotificationCache.current.add(firebaseKey);
                            console.log('🔥 [FCM] Added to global cache:', firebaseKey);

                            // Очищаем через 10 секунд
                            setTimeout(() => {
                                globalNotificationCache.current.delete(firebaseKey);
                            }, 10000);

                            if (isAuthenticated) {
                                console.log('🔥 [FCM] User authenticated - enqueuing Firebase message');
                                // Попытка преобразовать данные Firebase в структуру MessageType
                                const firebaseMsg: MessageType = {
                                    sender_id: Number(messageData?.data?.senderId) || 0,
                                    sender_name: undefined,
                                    count: Number(messageData?.data?.count) || 1,
                                    last_message: messageData?.notification?.title,
                                    timestamp: Date.now(),
                                    chat_id: Number(messageData?.data?.chatId),
                                    message_id: Number(messageData?.data?.messageId),
                                };
                                enqueueNotification([firebaseMsg]);
                            } else {
                                console.warn('🔥 [FCM] User not authenticated, skipping enqueue');
                            }
                        };

                        // Добавляем только один handler за всё время жизни компонента
                        if (!firebaseHandlerAdded.current) {
                            firebaseService.addMessageHandler(messageHandler);
                            firebaseHandlerAdded.current = true;
                        }
                        // Финальная проверка
                        const finalStatus = await firebaseService.getStatus();
                        console.log('🔥 [FCM] === FINAL STATUS CHECK ===', {
                            hasPermission: finalStatus.hasPermission,
                            isEnabled: finalStatus.isEnabled,
                            tokenType: finalStatus.type,
                        });

                        // Вызываем тестовый метод для полной диагностики
                        await firebaseService.testFirebaseConnection();

                    }, 2000); // Даем 2 секунды на полную инициализацию

                    return; // Успешная инициализация
                } else {
                    console.error('🔥 [FCM] ❌ Firebase initialization failed:', firebaseResult.error);
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

    // Настройка notification listener ОДИН РАЗ при монтировании
    // БЕЗ зависимостей чтобы избежать повторных регистраций
    useEffect(() => {
        // КРИТИЧНО: Регистрируем listener только ОДИН раз
        if (listenerInitialized.current) {
            console.log('🔥 [NotificationContext] ⚠️ Listener ALREADY initialized, skipping');
            return;
        }

        console.log('🔥 [NotificationContext] 🎯 Registering notification response listener (ONCE)');

        // Устанавливаем ЕДИНСТВЕННЫЙ listener для всех нажатий
        const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
            console.log('🔥 [NotificationContext] 📱 Notification tapped - processing');
            handleNotificationResponse(response);
        });

        responseListener.current = subscription;
        listenerInitialized.current = true;

        console.log('🔥 [NotificationContext] ✅ Listener registered successfully');

        // Cleanup при размонтировании компонента (НЕ при изменении состояния)
        return () => {
            console.log('🔥 [NotificationContext] 🗑️ Component unmounting - removing listener');
            if (responseListener.current) {
                responseListener.current.remove();
                responseListener.current = null;
                listenerInitialized.current = false;
            }
        };
    }, []); // ПУСТОЙ массив зависимостей - выполняется ТОЛЬКО при монтировании

    // Обработка ответа на уведомление с защитой от дублирования
    const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
        try {
            // Используем data вместо устаревшего dataString
            let data = response.notification.request.content.data;

            // Если data является строкой (старый формат), парсим её
            if (typeof data === 'string') {
                try {
                    data = JSON.parse(data);
                } catch (parseError) {
                }
            }

            const isFromFirebase = data?.isFirebase === true;

            if (isFromFirebase) {
                console.log('🔥 [NotificationContext] Notification response:', response.notification.request.identifier);
            }

            if (isAuthenticated) {
                refreshNotifications();
            }

            if (data && data.type === 'message_notification' && data.chatId) {
                const chatId = String(data.chatId);
                const now = Date.now();

                // КРИТИЧЕСКАЯ ЗАЩИТА: Проверяем дублирование
                if (isNavigating.current) {
                    console.log('🔥 [NotificationContext] ⚠️ Navigation already in progress, SKIPPING');
                    return;
                }

                const timeSinceLastNav = now - lastNavigationTime.current;
                if (lastNavigatedChatId.current === chatId && timeSinceLastNav < 5000) {
                    console.log('🔥 [NotificationContext] ⚠️ Duplicate navigation to same chat, SKIPPING');
                    return;
                }

                // Устанавливаем флаги
                isNavigating.current = true;
                lastNavigationTime.current = now;
                lastNavigatedChatId.current = chatId;

                console.log('🔥 [NotificationContext] 🚀 Navigating to chat:', chatId);

                // Выполняем навигацию
                try {
                    router.push({
                        pathname: '/chat/[id]' as any,
                        params: {
                            "id": chatId,
                            "userId": String(data.senderId || data.sender_id)
                        }
                    });
                    console.log('🔥 [NotificationContext] ✅ Navigation successful');

                    // И закрываем все остальные уведомления из этого чата (шторки + внутренняя очередь)
                    closeChatNotifications(chatId);
                } catch (navError) {
                    console.error('🔥 [NotificationContext] ❌ Navigation failed:', navError);
                    router.push('/(main)/messages');
                }

                // Сбрасываем флаг через 3 секунды
                setTimeout(() => {
                    isNavigating.current = false;
                }, 3000);
            }
        } catch (error) {
            console.error('🔥 [NotificationContext] Error handling notification:', error);
            isNavigating.current = false;
        }
    };


    // Функция для группировой обработки накопленных уведомлений
    const processNotificationQueue = () => {
        if (notificationQueueRef.current.length === 0) {
            console.log('📬 [NotificationQueue] Queue is empty, skipping');
            return;
        }

        // Группируем сообщения по sender_id, берем самое свежее от каждого
        const groupedBySender = new Map<number, MessageType>();
        notificationQueueRef.current.forEach(msg => {
            const existing = groupedBySender.get(msg.sender_id);
            if (!existing || (msg.timestamp && existing.timestamp && msg.timestamp > existing.timestamp)) {
                groupedBySender.set(msg.sender_id, msg);
            }
        });

        const uniqueMessages = Array.from(groupedBySender.values());
        console.log('📬 [NotificationQueue] Processing queue:', {
            rawCount: notificationQueueRef.current.length,
            uniqueCount: uniqueMessages.length,
        });

        // Очищаем очередь
        notificationQueueRef.current = [];

        // Определяем тип уведомления
        const isAppActive = AppState.currentState === 'active';

        if (isAppActive) {
            console.log('📬 [NotificationQueue] App active - vibrate only');
            vibrateWithoutNotification(uniqueMessages);
        } else {
            console.log('📬 [NotificationQueue] App inactive - local notifications suppressed');
            // No local notification is sent; the push will be delivered by Firebase
        }
    };

    // Функция для добавления сообщения в очередь с debounce
    const queueNotification = (messageArray: MessageType[]) => {
        if (!messageArray || messageArray.length === 0) {
            return;
        }

        console.log('📬 [NotificationQueue] Adding to queue:', messageArray.length);

        // Добавляем в очередь
        notificationQueueRef.current.push(...messageArray);

        // Сбрасываем предыдущий таймер
        if (notificationDebounceTimer.current) {
            clearTimeout(notificationDebounceTimer.current);
        }

        // Устанавливаем новый таймер на 800мс
        // Если за это время придут еще сообщения, таймер сбросится
        notificationDebounceTimer.current = setTimeout(() => {
            processNotificationQueue();
            notificationDebounceTimer.current = null;
        }, 800);
    };

    // Функция для отправки сгруппированного уведомления из буфера
    const sendGroupedNotification = async () => {
        if (notificationBuffer.current.length === 0) {
            return;
        }

        const bufferedMessages = [...notificationBuffer.current];
        notificationBuffer.current = []; // Очищаем буфер

        console.log('🔔 [Notification] Отправка сгруппированного уведомления, сообщений в буфере:', bufferedMessages.length);

        const isAppActive = AppState.currentState === 'active';

        if (isAppActive) {
            // Приложение открыто - только вибрация
            console.log('📱 [Notification] App активно - только вибрация');
            vibrateWithoutNotification(bufferedMessages);
        } else if (hasNotificationPermission) {
            // Приложение свёрнуто - отправляем одно групповое уведомление
            console.log('📱 [Notification] App неактивно - отправка группового уведомления');
            await sendNotificationWithUserData(bufferedMessages);
        }
    };

    // Функция для добавления сообщения в буфер с дебаунсингом
    const addToNotificationBuffer = (messageArray: MessageType[]) => {
        console.log('🔔 [Notification] Добавление в буфер:', messageArray.length, 'сообщений');

        // Добавляем новые сообщения в буфер, избегая дублирования
        messageArray.forEach(newMsg => {
            const existingIndex = notificationBuffer.current.findIndex(
                msg => msg.sender_id === newMsg.sender_id
            );

            if (existingIndex !== -1) {
                // Обновляем существующее сообщение в буфере
                notificationBuffer.current[existingIndex] = newMsg;
            } else {
                // Добавляем новое сообщение
                notificationBuffer.current.push(newMsg);
            }
        });

        // Сбрасываем предыдущий таймер
        if (notificationDebounceTimer.current) {
            clearTimeout(notificationDebounceTimer.current);
        }

        // Устанавливаем новый таймер на 1.5 секунды
        notificationDebounceTimer.current = setTimeout(() => {
            sendGroupedNotification();
            notificationDebounceTimer.current = null;
        }, 1500);

        console.log('🔔 [Notification] Таймер установлен, текущий размер буфера:', notificationBuffer.current.length);
    };

    // Функция для вибрации без уведомления (когда приложение активно)
    const vibrateWithoutNotification = (messageArray: MessageType[]) => {
        try {
            if (!messageArray || messageArray.length === 0) {
                console.log('📳 [Notification] vibrateWithoutNotification: пустой массив сообщений');
                return;
            }

            const currentTime = Date.now();

            // Проверяем дублирование вибрации по времени
            if (currentTime - lastMessageTimestamp < 1000) {
                console.log('📳 [Notification] vibrateWithoutNotification: слишком рано (< 1сек), пропуск');
                return;
            }

            const mostActiveMsg = messageArray[0];
            const notificationKey = `vibrate_${mostActiveMsg.sender_id}_${mostActiveMsg.message_id || 'none'}_${mostActiveMsg.count}`;

            // Проверяем глобальный кеш
            if (globalNotificationCache.current.has(notificationKey)) {
                console.log('📳 [Notification] vibrateWithoutNotification: дубликат в глобальном кеше, пропуск');
                return;
            }

            // Добавляем в глобальный кеш (единственный кеш)
            globalNotificationCache.current.add(notificationKey);

            // Очищаем через 5 секунд
            setTimeout(() => {
                globalNotificationCache.current.delete(notificationKey);
            }, 5000);

            setLastMessageTimestamp(currentTime);

            // Вибрация: 400мс вибрация, 200мс пауза, 400мс вибрация
            Vibration.vibrate([0, 400, 200, 400]);

            console.log('📳 [Notification] ✅ Vibration triggered for active app, key:', notificationKey);
        } catch (error) {
            console.error('❌ [Notification] Error in vibrateWithoutNotification:', error);
        }
    };

    // Функция для отправки локального уведомления (когда приложение неактивно)
    const sendNotificationWithUserData = async (messageArray: MessageType[]) => {
        console.log('🔥 [FCM] sendNotificationWithUserData called - App state:', AppState.currentState);

        try {
            // КРИТИЧНО: Если используется Firebase, НЕ отправляем локальные уведомления
            // Firebase сам отправит уведомление через FCM
            if (isUsingFirebaseNavigation && pushToken && !pushToken.startsWith('ExponentPushToken')) {
                console.log('🔥 [FCM] ⚠️ Firebase активен - локальное уведомление ОТМЕНЕНО (Firebase сам отправит)');
                return;
            }

            if (!hasNotificationPermission) {
                const granted = await requestPermissions();
                if (!granted) {
                    console.log('🔥 [FCM] sendNotificationWithUserData: нет разрешений');
                    return;
                }
            }

            if (!messageArray || messageArray.length === 0) {
                console.log('🔥 [FCM] sendNotificationWithUserData: пустой массив сообщений');
                return;
            }

            const mostActiveMsg = messageArray.find(msg =>
                msg.count === Math.max(...messageArray.map(m => m.count))
            ) || messageArray[0];

            const currentTime = Date.now();

            // Увеличиваем минимальную задержку до 2 секунд
            if (currentTime - lastMessageTimestamp < 2000) {
                console.log('🔥 [FCM] sendNotificationWithUserData: слишком рано (< 2сек), пропуск');
                return;
            }

            const notificationKey = `local_${mostActiveMsg.sender_id}_${mostActiveMsg.message_id || 'none'}_${mostActiveMsg.count}`;

            // Проверяем глобальный кеш
            if (globalNotificationCache.current.has(notificationKey)) {
                console.log('🔥 [FCM] sendNotificationWithUserData: дубликат в глобальном кеше, пропуск');
                return;
            }

            // Добавляем в глобальный кеш СРАЗУ, перед отправкой
            globalNotificationCache.current.add(notificationKey);
            sentNotificationsCache.current.add(notificationKey);

            // Очищаем через 10 секунд
            setTimeout(() => {
                globalNotificationCache.current.delete(notificationKey);
                sentNotificationsCache.current.delete(notificationKey);
            }, 10000);

            let senderInfo = mostActiveMsg.sender_name;
            let notificationBody = mostActiveMsg.last_message;

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

            // Определяем общее количество отправителей для группировки
            const totalSenders = messageArray.length;
            const totalMessages = messageArray.reduce((sum, msg) => sum + msg.count, 0);

            // Отправляем уведомление в шторку только если приложение НЕ активно
            const notificationContent: any = {
                title: senderInfo,
                body: notificationBody,
                sound: 'default',
                data: {
                    type: 'message_notification',
                    chatId: mostActiveMsg.chat_id,
                    senderId: mostActiveMsg.sender_id,
                    isFirebase: isUsingFirebaseNavigation,
                    notificationKey: notificationKey,
                },
            };

            // Android - добавляем group для автоматической группировки
            if (Platform.OS === 'android') {
                notificationContent.channelId = 'messages';
                notificationContent.categoryIdentifier = 'messages';

                // КРИТИЧНО: добавляем groupKey для группировки с ПЕРВОГО уведомления
                notificationContent.groupId = 'chat-messages';
                notificationContent.groupSummary = false; // Это индивидуальное уведомление

                // Добавляем tag для замены старых уведомлений от того же отправителя
                notificationContent.tag = `sender_${mostActiveMsg.sender_id}`;
            }

            // iOS - добавляем threadIdentifier для группировки
            if (Platform.OS === 'ios') {
                notificationContent.threadIdentifier = 'chat-messages';
                notificationContent.categoryIdentifier = 'message';
            }

            // Планируем шторку и получаем её идентификатор
            const identifier = await Notifications.scheduleNotificationAsync({
                content: notificationContent,
                trigger: null,
            });

            console.log('✅ [Notification] LOCAL notification sent, key:', notificationKey, 'identifier:', identifier);

            // Сохраняем identifier в реф, чтобы потом можно было явно димисить это уведомление
            const chatIdStr = String(mostActiveMsg.chat_id);
            if (!chatNotificationIds.current.has(chatIdStr)) {
                chatNotificationIds.current.set(chatIdStr, new Set());
            }
            chatNotificationIds.current.get(chatIdStr)!.add(identifier);

            // Если несколько отправителей - создаем summary notification для Android
            if (Platform.OS === 'android' && totalSenders > 1) {
                const summaryContent: any = {
                    title: `${totalSenders} новых чата`,
                    body: `${totalMessages} непрочитанных сообщений`,
                    sound: null, // Без звука для summary
                    data: {
                        type: 'summary',
                    },
                    channelId: 'messages',
                    groupId: 'chat-messages',
                    groupSummary: true, // Это summary notification
                };

                await Notifications.scheduleNotificationAsync({
                    content: summaryContent,
                    trigger: null,
                });

                console.log('✅ [Notification] Summary notification created for', totalSenders, 'senders');
            }

            // Очищаем кеш от старых записей (оставляем только последние 30)
            if (globalNotificationCache.current.size > 30) {
                const entries = Array.from(globalNotificationCache.current);
                globalNotificationCache.current.clear();
                entries.slice(-15).forEach(key => globalNotificationCache.current.add(key));
            }
        } catch (error) {
            console.error('❌ [Notification] Error in sendNotificationWithUserData:', error);
        }
    };

    // Функция для отправки пинга
    const sendPing = () => {
        const connectionState = isConnected();

        if (connectionState) {
            const pingMessage = {type: 'ping'};
            sendMessage(pingMessage);
            lastPingTimeRef.current = Date.now();
        }
    };

    // Проверка состояния соединения
    const checkConnection = () => {
        const now = Date.now();
        const timeSincePing = now - lastPingTimeRef.current;
        const connectionState = isConnected();
        const wsConnectedState = wsConnected;

        // ИСПРАВЛЯЕМ ЛОГИКУ: переподключаемся если НЕТ соединения ИЛИ оно зависло
        const shouldReconnect = !connectionState || !wsConnectedState || timeSincePing > 45000;

        if (shouldReconnect && isAuthenticated) {
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

            // Обработка принудительного обновления (например, после прочтения сообщений)
            if (data.trigger_update) {
                previousMessagesRef.current = [];
                    globalNotificationCache.current.clear();

                // Запрашиваем свежие данные немедленно
                setTimeout(() => {
                    if (isConnected() && wsConnected) {
                        sendMessage({type: 'get_initial_data'});
                    }
                }, 50);
                return; // Выходим, чтобы не обрабатывать это сообщение дальше
            }

            if (data.type === 'user_status_update') {
                const statusUpdate = data as UserStatusUpdate;
                setUserStatuses(prevStatuses => {
                    const newStatuses = new Map(prevStatuses);
                    newStatuses.set(statusUpdate.user_id, statusUpdate.status);
                    return newStatuses;
                });

                // Принудительно обновляем уведомления при изменении статуса пользователя
                setTimeout(() => {
                    if (isConnected() && wsConnected) {
                        sendMessage({type: 'get_initial_data'});
                    }
                }, 100);

                return;
            }

            if (data.type === 'notification_update' || data.type === 'new_message_notification') {
                // Если это принудительное обновление, запрашиваем свежие данные
                if (data.trigger_update) {
                    setTimeout(() => {
                        const refreshMessage = {type: 'get_initial_data'};
                        sendMessage(refreshMessage);
                    }, 100);
                    return;
                }

                let messageArray: MessageType[] = [];
                if (data.messages && Array.isArray(data.messages)) {
                    if (data.messages.length === 2 && Array.isArray(data.messages[1])) {
                        messageArray = data.messages[1];
                    } else {
                        messageArray = data.messages;
                    }
                } else {
                    // Если нет сообщений, очищаем состояние
                    setMessages([]);
                    setSenderCounts(new Map());
                    setUnreadCount(0);
                    return;
                }

                setMessages(messageArray);

                const newSenderCounts = new Map<number, number>();
                messageArray.forEach(message => {
                    newSenderCounts.set(message.sender_id, message.count);
                });
                setSenderCounts(newSenderCounts);

                // Обновляем общий счетчик
                const newUnreadCount = data.unique_sender_count !== undefined ? data.unique_sender_count : messageArray.length;
                setUnreadCount(newUnreadCount);

                // ИСПОЛЬЗУЕМ БУФЕР для группировки уведомлений
                if (messageArray.length > 0) {
                    console.log('📱 [Notification] Получено сообщений:', messageArray.length, '- добавляем в буфер');
                    enqueueNotification(messageArray);
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

                        // ИСПОЛЬЗУЕМ БУФЕР для группировки
                        const previousMsg = previousMessagesRef.current.find(m => m.sender_id === messageData.sender_id);
                        const isNewOrUpdated = !previousMsg || messageData.count > previousMsg.count;

                        if (isNewOrUpdated) {
                            console.log('📱 [Notification] Individual message - добавляем в буфер');
                            enqueueNotification([messageData]);
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

                    // Показываем уведомления для обновлений (но не для начальных данных)
                    if (data.type === 'messages_by_sender_update') {
                        const previousMessages = previousMessagesRef.current;
                        const hasChanges = messageArray.some(newMsg => {
                            const prevMsg = previousMessages.find(m => m.sender_id === newMsg.sender_id);
                            return !prevMsg || newMsg.count > prevMsg.count;
                        });

                        if (hasChanges) {
                            console.log('📱 [Notification] messages_by_sender_update - изменения обнаружены, добавляем в буфер');
                            enqueueNotification(messageArray);
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
        }
    }

    // Инициализация WebSocket
    const {connect, disconnect, sendMessage, isConnected, reconnect} = useWebSocket(`/wss/notification/`, {
        onOpen: () => {
            setWsConnected(true);
            setReconnectAttempts(0);

            // Сбрасываем кеши при переподключении для корректного сравнения
            previousMessagesRef.current = [];
            globalNotificationCache.current.clear();

            const initialDataMessage = {type: 'get_initial_data'};
            sendMessage(initialDataMessage);
            lastPingTimeRef.current = Date.now();

            // Синхронизация разрешений
            setTimeout(async () => {
                try {
                    const currentPermissions = await Notifications.getPermissionsAsync();
                    const permissionGranted = currentPermissions.status === 'granted';
                    setHasNotificationPermission(permissionGranted);
                } catch (error) {
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
            setWsConnected(false);
        },
    });

    // Функция обновления уведомлений - событийно-управляемая
    const refreshNotifications = () => {
        const connectionState = isConnected();
        const wsConnectedState = wsConnected;

        if (connectionState && wsConnectedState) {
            const refreshMessage = {type: 'get_initial_data'};
            sendMessage(refreshMessage);
            lastPingTimeRef.current = Date.now();
        } else {
            if (isAuthenticated) {
                reconnect();
            }
        }
    };

    /**
     * Закрывает все показанные уведомления, принадлежащие указанному чату.
     * Используется после перехода в чат, чтобы пользователь не видел «зависшие» шторки.
     */
    const closeChatNotifications = async (chatId: string) => {
        try {
            // ---------- 1️⃣ Снятие уже отображённых шторок ----------
            const getPresented = (Notifications as any).getPresentedNotificationsAsync
                ? (Notifications as any).getPresentedNotificationsAsync.bind(Notifications)
                : null;

            let presentedDismissed = 0;
            if (getPresented) {
                const presented = await getPresented();

                const toDismiss = presented.filter(
                    n => n.request?.content?.data?.chatId?.toString() === chatId
                );

                await Promise.all(
                    toDismiss.map(n => Notifications.dismissNotificationAsync?.(n.identifier))
                );

                presentedDismissed = toDismiss.length;
                console.log(
                    `🔥 [Notification] Closed ${presentedDismissed} presented notification(s) for chatId ${chatId}`
                );
            } else {
                console.warn('🔥 [Notification] getPresentedNotificationsAsync not available – skipping UI dismissal');
            }

            // Если ничего не найдено среди уже показанных, принудительно свернём всё (на случай, когда система не возвращает их)
            if (presentedDismissed === 0) {
                try {
                    await Notifications.dismissAllNotificationsAsync?.();
                    console.log(`🔥 [Notification] dismissAllNotificationsAsync called for chatId ${chatId}`);
                } catch (dismissAllErr) {
                    console.warn('🔥 [Notification] dismissAllNotificationsAsync failed:', dismissAllErr);
                }
            }

            // ---------- 2️⃣ Димисс запланированных уведомлений, сохранённых в chatNotificationIds ----------
            const storedIds = chatNotificationIds.current.get(chatId);
            if (storedIds && storedIds.size > 0) {
                const idsArray = Array.from(storedIds);
                await Promise.all(
                    idsArray.map(id => Notifications.dismissNotificationAsync?.(id))
                );
                console.log(
                    `🔥 [Notification] Dismissed ${idsArray.length} scheduled notification(s) for chatId ${chatId}`
                );
                // Очищаем запись из рефа
                chatNotificationIds.current.delete(chatId);
            }

            // ---------- 3️⃣ Очистка внутренней очереди ----------
            if (notificationQueueRef.current.length > 0) {
                const beforeCount = notificationQueueRef.current.length;
                // Оставляем только сообщения, которые *не* принадлежат закрываемому чату
                notificationQueueRef.current = notificationQueueRef.current.filter(
                    msg => String(msg.chat_id) !== chatId
                );
                const afterCount = notificationQueueRef.current.length;
                console.log(
                    `🔥 [Notification] Queue cleaned for chatId ${chatId}: ${beforeCount - afterCount} item(s) removed`
                );
            }
        } catch (err) {
            console.error('🔥 [Notification] Error while closing notifications for chatId', chatId, err);
        }
    };

    // Подключаемся при аутентификации
    useEffect(() => {
        if (isAuthenticated) {
            // Даем небольшую задержку для стабилизации состояния
            setTimeout(() => {
                connect();
            }, 500);

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

    // Удалено периодическое обновление - теперь используем только событийно-управляемые обновления
    // Обновления происходят при: подключении, получении сообщений, изменении статуса, принудительных триггерах

    // Функция для проверки статуса push-уведомлений
    const checkFirebaseStatus = async () => {
        try {
            if (pushToken) {
                const isFirebaseToken = !pushToken.startsWith('ExponentPushToken');
                if (isFirebaseToken) {
                    console.log('🔥 [FCM] Push-токен:', pushToken.substring(0, 15) + '...');
                }
            }

            if (!pushToken) {
                const token = await registerForPushNotifications();

                if (token) {
                    const isFirebaseToken = !token.startsWith('ExponentPushToken');
                    if (isFirebaseToken) {
                        console.log('🔥 [FCM] Результат получения токена: Успешно');
                    }

                    setPushToken(token);
                    await savePushTokenToServer(token);
                    if (isFirebaseToken) {
                        console.log('🔥 [FCM] Токен успешно обновлен');
                    }
                    return {success: true, token};
                } else {
                    return {success: false, error: 'Не удалось получить токен'};
                }
            }

            return {success: true, token: pushToken};
        } catch (error) {
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

    // Очистка таймера дебаунсинга при размонтировании
    useEffect(() => {
        return () => {
            if (notificationDebounceTimer.current) {
                clearTimeout(notificationDebounceTimer.current);
                notificationDebounceTimer.current = null;
            }
        };
    }, []);

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