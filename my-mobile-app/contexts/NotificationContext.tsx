import React, {createContext, useContext, useEffect, useState, useRef} from 'react';
import {useWebSocket} from '../hooks/useWebSocket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {router} from 'expo-router';
import {
    requestNotificationPermissions,
    registerForPushNotifications,
    sendHighPriorityNotification,
    addNotificationListener,
    addNotificationResponseListener,
    checkNotificationSettings
} from '../services/notificationService';
import {AppState} from 'react-native';
import {getLastMessagesBySenders, getUsersByIds} from '../services/userService';

interface NotificationContextType {
    unreadCount: number;
    messages: MessageType[];
    senderCounts: Map<number, number>;
    userStatuses: Map<number, string>;
    connect: () => void;
    disconnect: () => void;
    refreshNotifications: () => void;
    requestPermissions: () => Promise<void>;
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
    last_message?: string;  // Добавляем поле для последнего сообщения
    timestamp?: string;     // Добавляем время последнего сообщения
    chat_id?: number;

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

const NotificationContext = createContext<NotificationContextType>({
    unreadCount: 0,
    messages: [],
    senderCounts: new Map(),
    userStatuses: new Map(),
    connect: () => {
    },
    disconnect: () => {
    },
    refreshNotifications: () => {
    },
    requestPermissions: async () => {
    },
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
    const appState = useRef(AppState.currentState);
    const notificationListener = useRef<Notifications.Subscription | null>(null);
    const responseListener = useRef<Notifications.Subscription | null>(null);
    const previousMessagesRef = useRef<MessageType[]>([]);
    const previousUnreadCountRef = useRef<number>(0);
    const [usersData, setUsersData] = useState<Map<number, any>>(new Map());

    const loadUserData = async (messages: MessageType[]) => {
        if (messages.length === 0) return;
        console.log('📥 Received messages from WebSocket:', messages);

        // Проверяем аутентификацию перед запросом
        const token = await AsyncStorage.getItem('userToken');
        if (!token) {
            console.warn('⚠️ No token available, skipping user data load');
            setMessages(messages);
            return;
        }

        // Проверяем, что мы аутентифицированы
        if (!isAuthenticated) {
            console.warn('⚠️ User not authenticated, skipping user data load');
            setMessages(messages);
            return;
        }

        const senderIds = messages.map(msg => msg.sender_id);
        const uniqueIds = [...new Set(senderIds)];

        try {
            console.log('🔄 Loading user data for IDs:', uniqueIds);
            const [userData, lastMessages] = await Promise.all([
                getUsersByIds(uniqueIds),
                getLastMessagesBySenders(uniqueIds)
            ]);

            setUsersData(userData);

            // Обновляем сообщения с именами пользователей
            const updatedMessages = messages.map(msg => {
                const userInfo = userData.get(msg.sender_id);
                const messageInfo = lastMessages.get(msg.sender_id);

                return {
                    ...msg,
                    sender_name: userInfo
                        ? `${userInfo.first_name} ${userInfo.last_name}`.trim()
                        : undefined,
                    last_message: messageInfo?.message || undefined,
                    timestamp: messageInfo?.timestamp || undefined,
                    chat_id: messageInfo?.chat_id

                };
            });


            setMessages(updatedMessages);
            console.log('✅ User data loaded successfully');
        } catch (error) {
            console.error('❌ Error loading user data:', error);
            // Устанавливаем сообщения без имен в случае ошибки
            setMessages(messages);
        }
    };

    // Функция для отправки уведомления с данными пользователя
    const sendNotificationWithUserData = async (messageArray: MessageType[]) => {
        // Находим отправителя с наибольшим количеством новых сообщений
        const mostActiveMsg = messageArray.find(msg =>
            msg.count === Math.max(...messageArray.map(m => m.count))
        ) || messageArray[0];

        // Пытаемся получить имя из уже загруженных данных
        let senderInfo = mostActiveMsg.sender_name;

        // Если имени нет, пытаемся загрузить данные пользователя
        if (!senderInfo) {
            try {
                const userData = await getUsersByIds([mostActiveMsg.sender_id]);
                const userInfo = userData.get(mostActiveMsg.sender_id);
                if (userInfo && userInfo.first_name) {
                    senderInfo = `${userInfo.first_name} ${userInfo.last_name || ''}`.trim();
                }
            } catch (error) {
                console.warn('Failed to load user data for notification:', error);
            }
        }

        // Fallback к ID если имя так и не получили
        if (!senderInfo) {
            senderInfo = `Пользователь ${mostActiveMsg.sender_id}`;
        }

        console.log('📤 Отправка уведомления от:', senderInfo);

        // Проверяем, есть ли текст сообщения для уведомления
        if (mostActiveMsg.last_message) {
            console.log('📝 Текст сообщения:', mostActiveMsg.last_message);
        } else {
            console.log('⚠️ Отсутствует текст сообщения!');
        }
        let notificationBody = mostActiveMsg.last_message || 'Новое сообщение';
        if (!mostActiveMsg.last_message) {
            try {
                const messageData = await getLastMessagesBySenders([mostActiveMsg.sender_id]);
                const directMessageInfo = messageData.get(mostActiveMsg.sender_id);
                if (directMessageInfo && directMessageInfo.message) {
                    notificationBody = directMessageInfo.message;
                    console.log('🔍 Получено сообщение напрямую:', notificationBody);
                }
            } catch (error) {
                console.warn('Не удалось получить сообщение напрямую:', error);
            }
        }

        // Если сообщение слишком длинное, обрезаем его
        if (notificationBody.length > 50) {
            notificationBody = notificationBody.substring(0, 50) + '...';
        }

        // Если есть несколько сообщений от разных отправителей, добавляем информацию об этом
        if (messageArray.length > 1) {
            const totalMessages = messageArray.reduce((sum, msg) => sum + msg.count, 0);
            notificationBody += ` (и еще ${totalMessages - mostActiveMsg.count} от других)`;
        } else if (mostActiveMsg.count > 1) {
            // Если несколько сообщений от одного отправителя
            notificationBody += ` (+${mostActiveMsg.count - 1})`;
        }

        await sendHighPriorityNotification({
            title: `💌 ${senderInfo}`,
            body: notificationBody,
            data: {
                type: 'message_notification',
                timestamp: Date.now(),
                sender_id: mostActiveMsg.sender_id,
                message_count: mostActiveMsg.count,
                chatId: mostActiveMsg.chat_id,
                // Добавляем идентификатор категории
                category: 'message',
                notification_id: Date.now().toString()


            }
        });
    };


    // Проверяем аутентификацию при инициализации
    useEffect(() => {
        const checkAuth = async () => {
            const token = await AsyncStorage.getItem('userToken');
            setIsAuthenticated(!!token);
        };
        checkAuth();
    }, []);

    // Функция для запроса разрешений
    const requestPermissions = async () => {
        try {
            const hasPermission = await requestNotificationPermissions();
            setHasNotificationPermission(hasPermission);

            if (hasPermission) {
                const token = await registerForPushNotifications();
                setPushToken(token);
            }
        } catch (error) {
            console.error('Error requesting permissions:', error);
        }
    };

    // Инициализация уведомлений
    useEffect(() => {
        const initNotifications = async () => {
            await checkNotificationSettings();

            const currentPermissions = await Notifications.getPermissionsAsync();

            if (currentPermissions.status === 'granted') {
                setHasNotificationPermission(true);

                if (!pushToken) {
                    const token = await registerForPushNotifications();
                    setPushToken(token);
                }
            } else {
                setHasNotificationPermission(false);
            }

            // Добавляем слушатели уведомлений
            notificationListener.current = addNotificationListener((notification: Notifications.Notification) => {
                if (isAuthenticated) {
                    refreshNotifications();
                }
            });

            responseListener.current = addNotificationResponseListener((response: Notifications.NotificationResponse) => {
                handleNotificationResponse(response);
            });


            // Слушаем изменения состояния приложения
            const subscription = AppState.addEventListener('change', nextAppState => {
                if (
                    appState.current.match(/inactive|background/) &&
                    nextAppState === 'active'
                ) {
                    if (isAuthenticated) {
                        refreshNotifications();
                    }
                }
                appState.current = nextAppState;
            });

            return () => {
                notificationListener.current?.remove();
                responseListener.current?.remove();
                subscription.remove();
            };
        };

        if (isAuthenticated) {
            initNotifications();
        }
    }, [isAuthenticated]);

    // Проверка запуска из уведомления
    useEffect(() => {
        const checkLaunchNotification = async () => {
            const lastNotificationResponse = await Notifications.getLastNotificationResponseAsync();
            if (lastNotificationResponse) {
                setTimeout(() => {
                    handleNotificationResponse(lastNotificationResponse);
                }, 1000);
            }
        };

        if (isAuthenticated) {
            checkLaunchNotification();
        }
    }, [isAuthenticated]);

    // Обработка ответа на уведомление
    const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
        const data = response.notification.request.content.data;

        if (isAuthenticated) {
            refreshNotifications();
        }

        if (data && data.type === 'message_notification') {
            if (data.chatId) {
                router.push({
                    pathname: '/chat/[id]',
                    params: {id: String(data.chatId)}
                });
            } else {
                router.push('/(main)/messages');
            }
        }
    };

    const handleMessage = (event: WebSocketMessageEvent) => {
        try {
            const data: NotificationData | UserStatusUpdate = JSON.parse(event.data);

            // Обработка обновления статуса пользователя
            if (data.type === 'user_status_update') {
                const statusUpdate = data as UserStatusUpdate;
                setUserStatuses(prevStatuses => {
                    const newStatuses = new Map(prevStatuses);
                    newStatuses.set(statusUpdate.user_id, statusUpdate.status);
                    return newStatuses;
                });
                return;
            }

            // Обработка уведомлений о сообщениях
            const notificationData = data as NotificationData;
            if (notificationData.type === 'initial_notification' || notificationData.type === 'messages_by_sender_update') {
                const previousUnreadCount = previousUnreadCountRef.current;
                setUnreadCount(notificationData.unique_sender_count);
                previousUnreadCountRef.current = notificationData.unique_sender_count;

                // Извлекаем массив сообщений
                if (Array.isArray(notificationData.messages) && notificationData.messages.length === 2) {
                    const messageArray = notificationData.messages[1];
                    setMessages(messageArray);
                    loadUserData(messageArray);

                    // Создаем Map для поиска количества сообщений
                    const newSenderCounts = new Map<number, number>();
                    messageArray.forEach(message => {
                        newSenderCounts.set(message.sender_id, message.count);
                    });
                    setSenderCounts(newSenderCounts);

                    // Помечаем как инициализированный ПЕРЕД проверкой уведомлений
                    let isCurrentlyInitialized = isInitialized;
                    if (!isInitialized) {
                        setIsInitialized(true);
                        isCurrentlyInitialized = true;
                    }

                    // Проверяем и отправляем уведомление
                    const checkAndSendNotification = async () => {
                        const currentPermissions = await Notifications.getPermissionsAsync();
                        const actuallyHasPermission = currentPermissions.status === 'granted';

                        if (actuallyHasPermission !== hasNotificationPermission) {
                            setHasNotificationPermission(actuallyHasPermission);
                        }

                        if (actuallyHasPermission && isCurrentlyInitialized) {
                            let shouldSendNotification = false;

                            if (notificationData.type === 'initial_notification') {
                                // Для initial_notification проверяем, есть ли изменения
                                if (previousMessagesRef.current.length > 0) {
                                    const hasChanges = messageArray.some(newMsg => {
                                        const prevMsg = previousMessagesRef.current.find(m => m.sender_id === newMsg.sender_id);
                                        return !prevMsg || newMsg.count > prevMsg.count;
                                    });

                                    shouldSendNotification = hasChanges || notificationData.unique_sender_count > previousUnreadCount;
                                }
                            } else {
                                // Для обновлений проверяем изменения
                                const unreadCountIncreased = notificationData.unique_sender_count > previousUnreadCount;

                                const hasNewMessagesFromSenders = messageArray.some(newMsg => {
                                    const prevMsg = previousMessagesRef.current.find(m => m.sender_id === newMsg.sender_id);
                                    return !prevMsg || newMsg.count > prevMsg.count;
                                });

                                shouldSendNotification = unreadCountIncreased || hasNewMessagesFromSenders;
                            }

                            if (shouldSendNotification) {
                                try {
                                    await sendNotificationWithUserData(messageArray);
                                } catch (error) {
                                    console.error('Failed to send notification:', error);
                                }
                            }
                        }
                    };

                    checkAndSendNotification();
                    previousMessagesRef.current = [...messageArray];
                }
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    };

    const {connect, disconnect, sendMessage, isConnected} = useWebSocket(`/wss/notification/`, {
        onOpen: () => {
            setWsConnected(true);
            sendMessage({type: 'get_initial_data'});
        },
        onMessage: handleMessage,
        onClose: () => {
            setWsConnected(false);
        },
        onError: () => {
            setWsConnected(false);
        },
    });

    const refreshNotifications = () => {
        if (isConnected()) {
            sendMessage({type: 'get_initial_data'});
        } else {
            connect();
        }
    };

    useEffect(() => {
        if (isAuthenticated) {
            connect();
        }
        return () => {
            disconnect();
        };
    }, [isAuthenticated]);

    // Периодическое обновление
    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;

        if (isAuthenticated && wsConnected) {
            interval = setInterval(() => {
                refreshNotifications();
            }, 30000);
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [isAuthenticated, wsConnected]);

    const value = {
        unreadCount,
        messages,
        senderCounts,
        userStatuses,
        connect,
        disconnect,
        refreshNotifications,
        requestPermissions,
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

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
};