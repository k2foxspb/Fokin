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
        console.log('🔥 [Firebase] Начало сохранения токена на сервере');
        const userToken = await AsyncStorage.getItem('userToken');
        if (!userToken) {
            console.error('🔥 [Firebase] Нет токена авторизации для сохранения push-токена');
            return;
        }

        console.log('🔥 [Firebase] Отправка токена на сервер:', token.substring(0, 10) + '...');
        const response = await axios.post(
            `${API_CONFIG.BASE_URL}/chat/api/save-push-token/`,
            {expo_push_token: token},
            {headers: {'Authorization': `Token ${userToken}`}}
        );

        console.log('🔥 [Firebase] Ответ сервера при сохранении токена:', response.status);

        if (response.status === 200) {
            console.log('🔥 [Firebase] Токен успешно сохранен на сервере');
        } else {
            console.warn('🔥 [Firebase] Необычный статус ответа при сохранении токена:', response.status);
        }
    } catch (error) {
        console.error('🔥 [Firebase] Ошибка при сохранении push-токена:', error);

        if (axios.isAxiosError(error)) {
            console.error('🔥 [Firebase] Статус ошибки:', error.response?.status);
            console.error('🔥 [Firebase] Данные ошибки:', error.response?.data);
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
    checkFirebaseStatus: async () => ({ success: false, error: 'Not initialized' }),
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
            console.log('🔥 [Firebase] Начинаем запрос разрешений...');
            const currentPermissions = await Notifications.getPermissionsAsync();
            console.log('🔥 [Firebase] Текущий статус разрешений:', currentPermissions.status);

            let hasPermission = currentPermissions.status === 'granted';

            if (!hasPermission) {
                console.log('🔥 [Firebase] Запрашиваем новые разрешения...');
                hasPermission = await requestNotificationPermissions();
                console.log('🔥 [Firebase] Результат запроса разрешений:', hasPermission);
            } else {
                console.log('🔥 [Firebase] Разрешения уже предоставлены');
            }

            setHasNotificationPermission(hasPermission);

            if (hasPermission) {
                console.log('🔥 [Firebase] Запрашиваем push-токен для Firebase...');
                const token = await registerForPushNotifications();
                console.log('🔥 [Firebase] Получен токен:', token ? 'Да' : 'Нет');

                if (token) {
                    setPushToken(token);
                    console.log('🔥 [Firebase] Сохраняем токен на сервере...');
                    await savePushTokenToServer(token);
                } else {
                    console.error('🔥 [Firebase] Не удалось получить push-токен для Firebase');
                }

                setIsInitialized(true);
                console.log('🔥 [Firebase] Инициализация завершена');
            } else {
                console.warn('🔥 [Firebase] Разрешения не получены, push-уведомления не будут работать');
            }

            return hasPermission;
        } catch (error) {
            console.error('🔥 [Firebase] Ошибка при запросе разрешений:', error);
            setHasNotificationPermission(false);
            return false;
        }
    };

    // Инициализация уведомлений
    useEffect(() => {
        const initNotifications = async () => {
            try {
                const currentPermissions = await Notifications.getPermissionsAsync();
                const permissionGranted = currentPermissions.status === 'granted';

                setHasNotificationPermission(permissionGranted);

                if (permissionGranted) {
                    if (!pushToken) {
                        console.log('🔥 [Firebase] Запрашиваем push-токен для Firebase...');
                        const token = await registerForPushNotifications();
                        console.log('🔥 [Firebase] Получен токен:', token ? 'Да' : 'Нет');

                        if (token) {
                            setPushToken(token);
                            console.log('🔥 [Firebase] Сохраняем токен на сервере...');
                            await savePushTokenToServer(token);
                            console.log('🔥 [Firebase] Токен сохранен успешно');
                        } else {
                            console.error('🔥 [Firebase] Не удалось получить токен для Firebase');
                        }
                    } else {
                        console.log('🔥 [Firebase] Push-токен уже существует');
                    }

                    setIsInitialized(true);
                } else if (currentPermissions.canAskAgain) {
                    console.log('🔥 [Firebase] Запрашиваем разрешения для уведомлений...');
                    const granted = await requestPermissions();
                    console.log('🔥 [Firebase] Результат запроса разрешений:', granted ? 'Разрешено' : 'Отклонено');

                    if (granted && !pushToken) {
                        console.log('🔥 [Firebase] Повторный запрос push-токена...');
                        const token = await registerForPushNotifications();
                        console.log('🔥 [Firebase] Получен токен при повторном запросе:', token ? 'Да' : 'Нет');

                        if (token) {
                            setPushToken(token);
                            await savePushTokenToServer(token);
                        }
                    }
                } else {
                    console.log('🔥 [Firebase] Разрешения на уведомления отклонены пользователем');
                }

                // Добавляем слушатели уведомлений
                if (notificationListener.current) {
                    notificationListener.current.remove();
                    console.log('🔥 [Firebase] Предыдущий слушатель уведомлений удален');
                }

                console.log('🔥 [Firebase] Добавляем слушатель входящих уведомлений');
                notificationListener.current = addNotificationListener((notification: Notifications.Notification) => {
                    console.log('🔥 [Firebase] Получено уведомление пока приложение открыто:', {
                        title: notification.request.content.title,
                        body: notification.request.content.body,
                        data: notification.request.content.data
                    });

                    if (isAuthenticated) {
                        console.log('🔥 [Firebase] Обновляем данные после получения уведомления');
                        refreshNotifications();
                    }
                });

                if (responseListener.current) {
                    responseListener.current.remove();
                    console.log('🔥 [Firebase] Предыдущий слушатель ответов на уведомления удален');
                }

                console.log('🔥 [Firebase] Добавляем слушатель ответов на уведомления');
                responseListener.current = addNotificationResponseListener((response: Notifications.NotificationResponse) => {
                    console.log('🔥 [Firebase] Пользователь нажал на уведомление:', {
                        title: response.notification.request.content.title,
                        data: response.notification.request.content.data
                    });
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
                console.log('🔥 [Firebase] Проверяем, было ли приложение запущено из уведомления...');
                const lastNotificationResponse = await Notifications.getLastNotificationResponseAsync();

                if (lastNotificationResponse) {
                    console.log('🔥 [Firebase] Приложение запущено из уведомления!');
                    console.log('🔥 [Firebase] Данные уведомления:', JSON.stringify(lastNotificationResponse.notification.request.content.data));

                    setTimeout(() => {
                        console.log('🔥 [Firebase] Обрабатываем уведомление, из которого запущено приложение');
                        handleNotificationResponse(lastNotificationResponse);
                    }, 1000);
                } else {
                    console.log('🔥 [Firebase] Приложение запущено обычным способом (не из уведомления)');
                }
            } catch (error) {
                console.error('🔥 [Firebase] Ошибка при проверке запуска из уведомления:', error);
            }
        };

        if (isAuthenticated) {
            checkLaunchNotification();
        }
    }, [isAuthenticated]);

    // Обработка ответа на уведомление
    const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
        try {
            const data = response.notification.request.content.data;
            console.log('🔥 [Firebase] Обработка ответа на уведомление:', response.notification.request.identifier);
            console.log('🔥 [Firebase] Данные уведомления:', JSON.stringify(data));

            if (isAuthenticated) {
                console.log('🔥 [Firebase] Обновляем данные после нажатия на уведомление');
                refreshNotifications();
            } else {
                console.log('🔥 [Firebase] Пользователь не аутентифицирован, пропускаем обновление');
            }

            if (data && data.type === 'message_notification') {
                console.log('🔥 [Firebase] Это уведомление о сообщении, выполняем навигацию');

                if (data.chatId) {
                    console.log('🔥 [Firebase] Переходим к чату:', data.chatId);
                    router.push({
                        pathname: '/chat/[id]',
                        params: {
                            "id": String(data.chatId),
                            "userId": String(data.senderId)
                        }
                    });
                } else {
                    console.log('🔥 [Firebase] Переходим к списку сообщений');
                    router.push('/(main)/messages');
                }
            } else {
                console.log('🔥 [Firebase] Тип уведомления не распознан или не требует навигации');
            }
        } catch (error) {
            console.error('🔥 [Firebase] Ошибка при обработке ответа на уведомление:', error);
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
            sendMessage({ type: 'ping' });
            lastPingTimeRef.current = Date.now();
        }
    };

    // Проверка состояния соединения
    const checkConnection = () => {
        const now = Date.now();
        // Если последний пинг был отправлен более 30 секунд назад и соединение считается активным
        if (now - lastPingTimeRef.current > 30000 && isConnected()) {
            reconnect();
        }
    };

// Обработчик сообщений WebSocket
    const handleMessage = (event: WebSocketMessageEvent) => {
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
                // Отправляем пинг каждые 15 секунд
                sendPing();
                // Проверяем состояние соединения каждые 15 секунд
                checkConnection();
            }, 15000);
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

    // Функция для проверки статуса Firebase
    const checkFirebaseStatus = async () => {
        try {
            console.log('🔥 [Firebase] Проверка статуса Firebase...');
            console.log('🔥 [Firebase] Текущие разрешения:', await Notifications.getPermissionsAsync());
            console.log('🔥 [Firebase] Push-токен:', pushToken ? pushToken.substring(0, 15) + '...' : 'отсутствует');

            if (!pushToken) {
                console.log('🔥 [Firebase] Попытка повторного получения push-токена...');
                const token = await registerForPushNotifications();
                console.log('🔥 [Firebase] Результат получения токена:', token ? 'Успешно' : 'Неудача');

                if (token) {
                    setPushToken(token);
                    await savePushTokenToServer(token);
                    console.log('🔥 [Firebase] Токен успешно обновлен');
                    return { success: true, token };
                } else {
                    console.log('🔥 [Firebase] Не удалось получить токен при проверке');
                    return { success: false, error: 'Не удалось получить токен' };
                }
            }

            return { success: true, token: pushToken };
        } catch (error) {
            console.error('🔥 [Firebase] Ошибка при проверке статуса Firebase:', error);
            return { success: false, error };
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