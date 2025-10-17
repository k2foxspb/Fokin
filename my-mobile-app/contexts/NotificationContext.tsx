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
    const sentNotificationsCache = useRef<Set<string>>(new Set()); // Кеш отправленных уведомлений
    const lastNavigationTime = useRef<number>(0);
    const lastNavigatedChatId = useRef<string | null>(null);
    const isNavigating = useRef<boolean>(false);
    const listenerInitialized = useRef<boolean>(false);
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

                            if (isAuthenticated) {

                                refreshNotifications();
                            } else {
                                console.warn('🔥 [FCM] User not authenticated, skipping refresh');
                            }
                        };

                        // Добавляем только ОДИН handler
                        firebaseService.addMessageHandler(messageHandler);
                        // Финальная проверка
                        const finalStatus = await firebaseService.getStatus();
                        console.log('🔥 [FCM] === FINAL STATUS CHECK ===', {
                            hasPermission: finalStatus.hasPermission,
                            isEnabled: finalStatus.isEnabled,
                            tokenType: finalStatus.type,
                            // Добавим проверку количества handlers через тестовый метод
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


    // Функция для вибрации без уведомления (когда приложение активно)
    const vibrateWithoutNotification = (messageArray: MessageType[]) => {
        try {
            if (!messageArray || messageArray.length === 0) {
                return;
            }

            const currentTime = Date.now();

            // Проверяем дублирование вибрации
            if (currentTime - lastMessageTimestamp < 500) {
                return;
            }

            const mostActiveMsg = messageArray[0];
            const notificationKey = `${mostActiveMsg.sender_id}_${mostActiveMsg.message_id}_${mostActiveMsg.count}`;

            if (sentNotificationsCache.current.has(notificationKey)) {
                return;
            }

            // Добавляем в кеш
            sentNotificationsCache.current.add(notificationKey);
            setTimeout(() => {
                sentNotificationsCache.current.delete(notificationKey);
            }, 10 * 60 * 1000);

            setLastMessageTimestamp(currentTime);

            // Вибрация: 400мс вибрация, 200мс пауза, 400мс вибрация
            Vibration.vibrate([0, 400, 200, 400]);

            console.log('📳 [Notification] Vibration triggered for active app');
        } catch (error) {
            console.error('❌ [Notification] Error in vibrateWithoutNotification:', error);
        }
    };

    // Функция для отправки локального уведомления (когда приложение неактивно)
    const sendNotificationWithUserData = async (messageArray: MessageType[]) => {
        // При Firebase разрешаем уведомления только когда приложение НЕ активно
        console.log('🔥 [FCM] sendNotificationWithUserData called - App state:', AppState.currentState);

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

            // Отправляем уведомление в шторку только если приложение НЕ активно
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: senderInfo,
                    body: notificationBody,
                    sound: 'default',
                    data: {
                        type: 'message_notification',
                        chatId: mostActiveMsg.chat_id,
                        senderId: mostActiveMsg.sender_id,
                        isFirebase: isUsingFirebaseNavigation,
                    },
                },
                trigger: null,
            });

            console.log('✅ [Notification] Notification sent to notification tray');

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
                sentNotificationsCache.current.clear();

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

                // Определяем тип уведомления в зависимости от состояния приложения
                if (messageArray.length > 0) {
                    const isAppActive = AppState.currentState === 'active';

                    if (isAppActive) {
                        // Приложение открыто - только вибрация
                        console.log('📱 [Notification] App is active - vibration only');
                        setTimeout(() => {
                            vibrateWithoutNotification(messageArray);
                        }, 300);
                    } else if (hasNotificationPermission) {
                        // Приложение свёрнуто/закрыто - полное уведомление
                        console.log('📱 [Notification] App is inactive - showing notification');
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

                        if (isNewOrUpdated) {
                            const isAppActive = AppState.currentState === 'active';

                            setTimeout(async () => {
                                try {
                                    if (isAppActive) {
                                        // Приложение открыто - только вибрация
                                        vibrateWithoutNotification([messageData]);
                                    } else if (hasNotificationPermission) {
                                        // Приложение свёрнуто/закрыто - полное уведомление
                                        await sendNotificationWithUserData([messageData]);
                                    }
                                } catch (error) {
                                    console.error('❌ [Notification] Error in notification:', error);
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

                    // Показываем уведомления для обновлений (но не для начальных данных)
                    if (data.type === 'messages_by_sender_update') {
                        const previousMessages = previousMessagesRef.current;
                        const hasChanges = messageArray.some(newMsg => {
                            const prevMsg = previousMessages.find(m => m.sender_id === newMsg.sender_id);
                            return !prevMsg || newMsg.count > prevMsg.count;
                        });

                        if (hasChanges) {
                            const isAppActive = AppState.currentState === 'active';

                            setTimeout(() => {
                                if (isAppActive) {
                                    // Приложение открыто - только вибрация
                                    vibrateWithoutNotification(messageArray);
                                } else if (hasNotificationPermission) {
                                    // Приложение свёрнуто/закрыто - полное уведомление
                                    sendNotificationWithUserData(messageArray);
                                }
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