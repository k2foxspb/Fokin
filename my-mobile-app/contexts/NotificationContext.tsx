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

    // Проверка запуска из уведомления
    useEffect(() => {
        const checkLaunchNotification = async () => {
            try {
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

                        if (isFromFirebase) {
                            console.log('🔥 [FCM] Приложение запущено из уведомления!');
                            console.log(`🔥 [FCM] Время с момента нажатия: ${Math.round(timeSinceNotification / 1000)}с`);
                            console.log('🔥 [FCM] Данные уведомления:', JSON.stringify(lastNotificationResponse.notification.request.content.data));
                        }

                        setTimeout(() => {
                            if (isFromFirebase) {
                                console.log('🔥 [FCM] Обрабатываем уведомление, из которого запущено приложение');
                            }
                            handleNotificationResponse(lastNotificationResponse);
                        }, 1000);
                    }
                }
            } catch (error) {
            }
        };

        if (isAuthenticated) {
            checkLaunchNotification();
        }
    }, [isAuthenticated]);

    // Обработка ответа на уведомление - ЕДИНСТВЕННОЕ МЕСТО ДЛЯ НАВИГАЦИИ
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
                console.log('🔥 [FCM] Обработка ответа на уведомление:', response.notification.request.identifier);
                console.log('🔥 [FCM] Данные уведомления:', JSON.stringify(data));
            }

            if (isAuthenticated) {
                if (isFromFirebase) {
                    console.log('🔥 [FCM] Обновляем данные после нажатия на уведомление');
                }
                refreshNotifications();
            }

            if (data?.startfrom !== undefined && isFromFirebase) {
                console.log('🔥 [FCM] Уведомление с startfrom:', data.startfrom);
            }

            if (data && data.type === 'message_notification') {
                if (isFromFirebase) {
                    console.log('🔥 [FCM] Это уведомление о сообщении, выполняем навигацию');
                    console.log('🔥 [FCM] Данные для навигации:', {
                        chatId: data.chatId,
                        senderId: data.senderId || data.sender_id,
                        type: data.type
                    });
                }

                if (data.chatId) {
                    if (isFromFirebase) {
                        console.log('🔥 [FCM] Переходим к чату:', data.chatId);
                    }

                    // Простая навигация без задержки
                    try {
                        router.push({
                            pathname: '/chat/[id]' as any,
                            params: {
                                "id": String(data.chatId),
                                "userId": String(data.senderId || data.sender_id)
                            }
                        });
                        if (isFromFirebase) {
                            console.log('🔥 [FCM] ✅ Навигация в чат выполнена успешно');
                        }
                    } catch (navError) {
                        // Fallback - переход к списку сообщений
                        router.push('/(main)/messages');
                    }
                } else {
                    router.push('/(main)/messages');
                }
            }
        } catch (error) {
        }
    };


    // Функция для отправки локального уведомления
    const sendNotificationWithUserData = async (messageArray: MessageType[]) => {
        // При Firebase разрешаем уведомления только для активного приложения
        console.log('🔥 [FCM] sendNotificationWithUserData called - Firebase mode:', isUsingFirebaseNavigation);
        if (isUsingFirebaseNavigation && AppState.currentState !== 'active') {

            return;
        }

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



            // Добавляем в кеш отправленных уведомлений
            sentNotificationsCache.current.add(notificationKey);

            // Очищаем кеш от старых записей (оставляем только последние 50)
            if (sentNotificationsCache.current.size > 50) {
                const entries = Array.from(sentNotificationsCache.current);
                sentNotificationsCache.current.clear();
                entries.slice(-25).forEach(key => sentNotificationsCache.current.add(key));
            }
        } catch (error) {
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

                // Показываем уведомление только если есть разрешения
                const shouldShowNotification = hasNotificationPermission && AppState.currentState !== 'active' && messageArray.length > 0;

                if (shouldShowNotification) {
                    setTimeout(() => {
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