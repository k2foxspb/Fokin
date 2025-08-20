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
    checkNotificationSettings
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
    testNotification: () => Promise<void>;
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
        const userToken = await AsyncStorage.getItem('userToken');
        if (!userToken) return;
        console.log('🔔 [PRODUCTION] Saving token to server:', token.substring(0, 20) + '...');
        const response = await axios.post(
            `${API_CONFIG.BASE_URL}/chat/api/save-push-token/`,
            {expo_push_token: token},
            {headers: {'Authorization': `Token ${userToken}`}}
        );

        console.log('✅ [Notification] Push token saved to server');
    } catch (error) {
        console.error('❌ [Notification] Failed to save push token:', error);
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
    testNotification: async () => Promise.resolve(),
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
        const checkNotificationChannels = async () => {
            try {
                if (Platform.OS === 'android') {
                    const channels = await Notifications.getNotificationChannelsAsync();
                    console.log('🔔 [Notification] Available channels:', channels);

                    const messagesChannel = channels.find(ch => ch.id === 'messages');
                    console.log('🔔 [Notification] Messages channel:', messagesChannel);

                    if (!messagesChannel) {
                        console.log('⚠️ [Notification] Messages channel not found, creating...');
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
                console.error('❌ [Notification] Error checking channels:', error);
            }
        };

        if (isAuthenticated && hasNotificationPermission) {
            checkNotificationChannels();
        }
    }, [isAuthenticated, hasNotificationPermission]);

    // Проверяем аутентификацию при инициализации
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const token = await AsyncStorage.getItem('userToken');
                setIsAuthenticated(!!token);

                if (token) {
                    console.log('🔑 [Notification] User is authenticated');
                } else {
                    // Убираем лог для неаутентифицированных пользователей
                }
            } catch (error) {
                console.error('❌ [Notification] Error checking auth:', error);
                setIsAuthenticated(false);
            }
        };

        checkAuth();
    }, []);

    // ИСПРАВЛЕНО: Улучшенная функция для запроса разрешений
    const requestPermissions = async (): Promise<boolean> => {
        try {
            console.log('🔔 [Notification] Requesting notification permissions...');

            // Сначала проверяем текущие разрешения
            const currentPermissions = await Notifications.getPermissionsAsync();
            console.log('🔔 [Notification] Current permissions:', currentPermissions);

            let hasPermission = currentPermissions.status === 'granted';
            console.log('🔔 [Notification] Current permission status:', hasPermission);

            if (!hasPermission) {
                console.log('🔔 [Notification] Requesting new permissions...');
                hasPermission = await requestNotificationPermissions();
                console.log('🔔 [Notification] Permission request result:', hasPermission);
            }

            // Обновляем состояние
            setHasNotificationPermission(hasPermission);

            // Если разрешения получены, регистрируем push token
            if (hasPermission) {
                const token = await registerForPushNotifications();
                if (token) {
                    setPushToken(token);
                    await savePushTokenToServer(token);
                    console.log('📱 [Notification] Push token registered and saved');
                }
                setIsInitialized(true);
            }

            console.log('🔔 [Notification] Final permission state:', hasPermission);
            return hasPermission;
        } catch (error) {
            console.error('❌ [Notification] Error requesting permissions:', error);
            setHasNotificationPermission(false);
            return false;
        }
    };

    // ИСПРАВЛЕНО: Улучшенная инициализация уведомлений
    useEffect(() => {
        const initNotifications = async () => {
            try {
                console.log('🔄 [Notification] Initializing notifications...');

                await checkNotificationSettings();

                const currentPermissions = await Notifications.getPermissionsAsync();
                const permissionGranted = currentPermissions.status === 'granted';

                console.log('🔔 [Notification] Permission check:', {
                    status: currentPermissions.status,
                    granted: permissionGranted,
                    canAskAgain: currentPermissions.canAskAgain
                });

                // ИСПРАВЛЕНИЕ: Синхронизируем состояние разрешений
                setHasNotificationPermission(permissionGranted);
                console.log('🔔 [Notification] Setting hasNotificationPermission to:', permissionGranted);

                if (permissionGranted) {
                    console.log('✅ [Notification] Permissions already granted');

                    if (!pushToken) {
                        const token = await registerForPushNotifications();
                        if (token) {
                            setPushToken(token);
                            await savePushTokenToServer(token);
                        }
                        console.log('📱 [Notification] Push token:', token ? token.substring(0, 10) + '...' : 'None');
                    }

                    setIsInitialized(true);
                    console.log('✅ [Notification] Setting initialized to true (permissions exist)');

                } else if (currentPermissions.canAskAgain) {
                    console.log('🔔 [Notification] Can ask for permissions, requesting...');
                    await requestPermissions();
                    console.log('🔔 [Notification] Permission request completed');
                } else {
                    console.log('⚠️ [Notification] Cannot ask for permissions again');
                }

                // Добавляем слушатели уведомлений
                if (notificationListener.current) {
                    notificationListener.current.remove();
                }

                notificationListener.current = addNotificationListener((notification: Notifications.Notification) => {
                    console.log('📬 [Notification] Received while app running:', notification.request.identifier);
                    if (isAuthenticated) {
                        refreshNotifications();
                    }
                });

                if (responseListener.current) {
                    responseListener.current.remove();
                }

                responseListener.current = addNotificationResponseListener((response: Notifications.NotificationResponse) => {
                    console.log('👆 [Notification] User responded to notification:', response.notification.request.identifier);
                    handleNotificationResponse(response);
                });

                // Слушаем изменения состояния приложения
                const subscription = AppState.addEventListener('change', nextAppState => {
                    console.log(`🔄 [Notification] App state changed: ${appState.current} -> ${nextAppState}`);

                    if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
                        console.log('🔄 [Notification] App came to foreground, refreshing...');
                        if (isAuthenticated) {
                            refreshNotifications();
                        }
                    } else if (appState.current === 'active' && nextAppState.match(/inactive|background/)) {
                        console.log('💤 [Notification] App went to background');
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
            console.log('🔄 [Notification] Initializing notifications (auth changed)');
            initNotifications();
        }

    }, [isAuthenticated]);


    // Проверка запуска из уведомления
    useEffect(() => {
        const checkLaunchNotification = async () => {
            const lastNotificationResponse = await Notifications.getLastNotificationResponseAsync();
            if (lastNotificationResponse) {
                console.log('🚀 [Notification] App launched from notification');
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
        try {
            const data = response.notification.request.content.data;
            console.log('🔍 [Notification] Handling response with data:', data);

            if (isAuthenticated) {
                refreshNotifications();
            }

            if (data && data.type === 'message_notification') {
                if (data.chatId) {
                    console.log('🔀 [Notification] Navigating to chat:', data.chatId);
                    router.push({
                        pathname: '/chat/[id]',
                        params: {
                            "id": String(data.chatId),
                            "userId": String(data.senderId)
                        }
                    });
                } else {
                    console.log('🔀 [Notification] Navigating to messages list');
                    router.push('/(main)/messages');
                }
            }
        } catch (error) {
            console.error('❌ [Notification] Error handling notification response:', error);
        }
    };

    // Функция для тестирования уведомлений
    const testNotification = async () => {
        try {
            console.log('🧪 [Notification] Testing notification...');
            const testResult = await sendHighPriorityNotification({
                title: "🧪 Тестовое уведомление",
                body: "Если вы видите это, уведомления работают!",
                data: {
                    type: "test",
                    timestamp: Date.now()
                }
            });
            console.log('✅ [Notification] Test notification result:', testResult);
        } catch (error) {
            console.error('❌ [Notification] Test notification error:', error);
        }
    };

    // ИСПРАВЛЕНО: Упрощенная функция для отправки локального уведомления
    const sendNotificationWithUserData = async (messageArray: MessageType[]) => {
        console.log('📤 [Notification] ===== sendNotificationWithUserData STARTED =====');
        console.log('📤 [Notification] Function arguments:', {
            messageArrayLength: messageArray?.length,
            messageArray: JSON.stringify(messageArray, null, 2)
        });

        try {
            console.log('📤 [Notification] ===== INSIDE TRY BLOCK =====');
            console.log('📤 [Notification] App current state:', AppState.currentState);
            console.log('📤 [Notification] hasNotificationPermission:', hasNotificationPermission);

            if (!hasNotificationPermission) {
                console.log('⚠️ [Notification] BLOCKED: No permission to show notifications');
                console.log('🔔 [Notification] Attempting to request permissions...');
                const granted = await requestPermissions();
                console.log('🔔 [Notification] Permission request result:', granted);
                if (!granted) {
                    console.log('❌ [Notification] Still no permissions after request, RETURNING');
                    return;
                }
                console.log('✅ [Notification] Permissions granted, continuing with notification');
            }

            if (!messageArray || messageArray.length === 0) {
                console.log('⚠️ [Notification] BLOCKED: No messages to show notification for, RETURNING');
                return;
            }

            console.log('📤 [Notification] Passed all initial checks, continuing...');

            // Находим отправителя с наибольшим количеством новых сообщений
            const mostActiveMsg = messageArray.find(msg =>
                msg.count === Math.max(...messageArray.map(m => m.count))
            ) || messageArray[0];

            console.log('📤 [Notification] mostActiveMsg:', JSON.stringify(mostActiveMsg, null, 2));

            const currentTime = Date.now();
            console.log('⏱️ [Notification] Time check:', {
                currentTime,
                lastMessageTimestamp,
                diff: currentTime - lastMessageTimestamp,
                threshold: 2000
            });

            // Уменьшаем интервал для тестирования
            if (currentTime - lastMessageTimestamp < 500) {
                console.log('⏱️ [Notification] BLOCKED: Too soon after previous notification, RETURNING');
                return;
            }

            console.log('⏱️ [Notification] Time check passed, continuing...');

            // Создаем уникальный ключ для этого уведомления
            const notificationKey = `${mostActiveMsg.sender_id}_${mostActiveMsg.message_id}_${mostActiveMsg.count}`;
            console.log('🔑 [Notification] Notification key:', notificationKey);


            if (sentNotificationsCache.current.has(notificationKey)) {
                console.log('🔄 [Notification] BLOCKED: Notification already sent for this message');
                return;
            }
            sentNotificationsCache.current.add(notificationKey);
            setTimeout(() => {
                sentNotificationsCache.current.delete(notificationKey);
            }, 10 * 60 * 1000);


            // Используем имя из данных WebSocket
            let senderInfo = mostActiveMsg.sender_name || `Пользователь ${mostActiveMsg.sender_id}`;
            let notificationBody = mostActiveMsg.last_message || 'Новое сообщение';

            console.log('📤 [Notification] Notification content:', {
                sender: senderInfo,
                message: notificationBody,
                senderName: mostActiveMsg.sender_name,
                lastMessage: mostActiveMsg.last_message
            });

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

            setLastMessageTimestamp(currentTime);

            console.log('📱 [Notification] ===== CALLING sendHighPriorityNotification =====');
            console.log('📱 [Notification] Final notification data:', {
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

            console.log('✅ [Notification] ===== NOTIFICATION SENT SUCCESSFULLY =====');
            console.log('✅ [Notification] Result ID:', notificationResult);

            // ОТЛАДКА: Проверяем что уведомление создано
            setTimeout(() => {
                console.log('📋 [Notification] Notification should be visible now');
                console.log('📋 [Notification] Check your device notification panel');
            }, 1000);

            // Добавляем в кеш отправленных уведомлений
            sentNotificationsCache.current.add(notificationKey);

            // Очищаем кеш от старых записей (оставляем только последние 50)
            if (sentNotificationsCache.current.size > 50) {
                const entries = Array.from(sentNotificationsCache.current);
                sentNotificationsCache.current.clear();
                entries.slice(-25).forEach(key => sentNotificationsCache.current.add(key));
            }
        } catch (error) {
            console.error('❌ [Notification] ===== ERROR IN sendNotificationWithUserData =====');
            console.error('❌ [Notification] Error details:', error);
            console.error('❌ [Notification] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        } finally {
            console.log('📤 [Notification] ===== sendNotificationWithUserData FINISHED =====');
        }
    };

    // Функция для отправки пинга на сервер
    const sendPing = () => {
        if (isConnected()) {
            console.log('📡 [Notification] Sending ping');
            sendMessage({type: 'ping'});
            lastPingTimeRef.current = Date.now();
        }
    };

    // Проверка состояния соединения
    const checkConnection = () => {
        const now = Date.now();
        // Если последний пинг был отправлен более 30 секунд назад и соединение считается активным
        if (now - lastPingTimeRef.current > 30000 && isConnected()) {
            console.log('⚠️ [Notification] Connection may be stale, reconnecting...');
            reconnect();
        }
    };

    // ИСПРАВЛЕНО: Обработчик сообщений WebSocket
    const handleMessage = (event: WebSocketMessageEvent) => {
        try {
            const data = JSON.parse(event.data);
            console.log('📨 [Notification] WebSocket received:', data.type, data);

            // Обновляем время последнего полученного сообщения
            lastPingTimeRef.current = Date.now();

            // Сброс счетчика попыток переподключения при успешном получении сообщения
            if (reconnectAttempts > 0) {
                setReconnectAttempts(0);
            }

            // Обработка пинга
            if (data.type === 'pong') {
                console.log('📡 [Notification] Received pong');
                return;
            }

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

            // Обработка уведомлений о новых сообщениях в реальном времени
            if (data.type === 'notification_update' || data.type === 'new_message_notification') {
                console.log('🔔 [Notification] Real-time notification received');

                // Извлекаем данные сообщений
                let messageArray: MessageType[] = [];
                if (data.messages && Array.isArray(data.messages)) {
                    if (data.messages.length === 2 && Array.isArray(data.messages[1])) {
                        messageArray = data.messages[1];
                    } else {
                        messageArray = data.messages;
                    }
                }

                if (messageArray && messageArray.length > 0) {
                    // Обновляем состояние
                    setMessages(messageArray);

                    // Обновляем счетчики
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

                    // ИСПРАВЛЕНО: Показываем уведомление только если есть разрешения
                    if (hasNotificationPermission && AppState.currentState !== 'active') {
                        console.log('📱 [Notification] Will show notification for notification_update/new_message_notification');
                        setTimeout(() => {
                            sendNotificationWithUserData(messageArray);
                        }, 300);
                    }
                }
                return;
            }

            // ИСПРАВЛЕНО: Обработка индивидуального сообщения
            if (data.type === 'individual_message') {
                const messageData = data.message;
                if (messageData) {
                    console.log('🔔 [Notification] ===== PROCESSING individual_message =====');
                    console.log(`🔔 [Notification] Individual message from ${messageData.sender_id}: ${messageData.count} messages`);
                    console.log('🔔 [Notification] messageData:', JSON.stringify(messageData, null, 2));

                    // Обновляем Map для этого отправителя
                    setSenderCounts(prevCounts => {
                        const newCounts = new Map(prevCounts);
                        newCounts.set(messageData.sender_id, messageData.count);
                        console.log('🔔 [Notification] Updated senderCounts:', Array.from(newCounts.entries()));
                        return newCounts;
                    });

                    // Также обновляем массив сообщений
                    setMessages(prevMessages => {
                        console.log('🔔 [Notification] Previous messages:', JSON.stringify(prevMessages, null, 2));

                        // Ищем, есть ли уже сообщение от этого отправителя
                        const index = prevMessages.findIndex(msg => msg.sender_id === messageData.sender_id);
                        console.log('🔔 [Notification] Found existing message index:', index);

                        let updatedMessages;
                        if (index !== -1) {
                            // Обновляем существующее сообщение
                            updatedMessages = [...prevMessages];
                            updatedMessages[index] = messageData;
                            console.log('🔔 [Notification] Updated existing message');
                        } else {
                            // Добавляем новое сообщение
                            updatedMessages = [...prevMessages, messageData];
                            console.log('🔔 [Notification] Added new message');
                        }

                        console.log('🔔 [Notification] Updated messages:', JSON.stringify(updatedMessages, null, 2));

                        // Определяем, нужно ли показать уведомление
                        const previousMsg = previousMessagesRef.current.find(m => m.sender_id === messageData.sender_id);

                        // ВРЕМЕННО: Принудительно показываем уведомления для тестирования
                        const isNewOrUpdated = true; // Всегда true для тестирования

                        console.log('🔔 [Notification] FORCED isNewOrUpdated = true for testing');

                        console.log('🔔 [Notification] Message comparison:', {
                            hasPreviousMsg: !!previousMsg,
                            previousCount: previousMsg?.count || 0,
                            newCount: messageData.count,
                            countIncreased: messageData.count > (previousMsg?.count || 0),
                            previousMessageId: previousMsg?.message_id || 0,
                            newMessageId: messageData.message_id,
                            messageIdChanged: messageData.message_id !== (previousMsg?.message_id || 0),
                            previousTimestamp: previousMsg?.timestamp || 0,
                            newTimestamp: messageData.timestamp,
                            timestampChanged: messageData.timestamp !== (previousMsg?.timestamp || 0),
                            previousLastMessage: previousMsg?.last_message?.substring(0, 20) || '',
                            newLastMessage: messageData.last_message?.substring(0, 20) || '',
                            finalResult: isNewOrUpdated
                        });


                        // ИСПРАВЛЕНО: Показываем уведомления всегда для тестирования (независимо от состояния приложения)
                        console.log('🔔 [Notification] Checking conditions: isNewOrUpdated =', isNewOrUpdated, 'hasNotificationPermission =', hasNotificationPermission);
                        if (isNewOrUpdated && hasNotificationPermission) {
                            console.log('📱 [Notification] ===== WILL CALL sendNotificationWithUserData =====');
                            console.log('📱 [Notification] Calling setTimeout...');
                            console.log('📱 [Notification] messageData:', JSON.stringify(messageData, null, 2));
                            setTimeout(async () => {
                                console.log('📱 [Notification] ===== setTimeout EXECUTED =====');
                                console.log('📱 [Notification] About to call sendNotificationWithUserData...');
                                try {
                                    await sendNotificationWithUserData([messageData]);
                                    console.log('📱 [Notification] sendNotificationWithUserData completed');
                                } catch (error) {
                                    console.error('📱 [Notification] Error in sendNotificationWithUserData:', error);
                                }
                            }, 300);
                        } else {
                            console.log('📱 [Notification] ===== NOTIFICATION BLOCKED =====');
                            console.log('📱 [Notification] Block reasons:', {
                                isNewOrUpdatedFailed: !isNewOrUpdated,
                                hasNotificationPermissionFailed: !hasNotificationPermission,
                                appIsActive: AppState.currentState === 'active'
                            });
                        }

                        // Обновляем ссылку на предыдущие сообщения
                        previousMessagesRef.current = updatedMessages;
                        console.log('🔔 [Notification] Updated previousMessagesRef');

                        return updatedMessages;
                    });

                    // Обновляем счетчик уникальных отправителей
                    if (data.unique_sender_count !== undefined) {
                        console.log('🔔 [Notification] Setting unreadCount from server:', data.unique_sender_count);
                        setUnreadCount(data.unique_sender_count);
                    }
                }
                return;
            }

            // Обработка начальных и обновленных данных
            if (data.type === 'initial_notification' || data.type === 'messages_by_sender_update') {
                console.log(`🔄 [Notification] Received ${data.type}`);

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
                    console.log(`📥 [Notification] Received ${messageArray.length} messages`);

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

                    // ИСПРАВЛЕНО: Показываем уведомления для обновлений (но не для начальных данных) и только если приложение неактивно
                    if (data.type === 'messages_by_sender_update' && AppState.currentState !== 'active') {
                        const previousMessages = previousMessagesRef.current;
                        const hasChanges = messageArray.some(newMsg => {
                            const prevMsg = previousMessages.find(m => m.sender_id === newMsg.sender_id);
                            return !prevMsg || newMsg.count > prevMsg.count;
                        });

                        console.log('🔔 [Notification] messages_by_sender_update check:', {
                            hasChanges,
                            hasNotificationPermission
                        });

                        if (hasChanges && hasNotificationPermission) {
                            console.log('📱 [Notification] Will show notification for messages_by_sender_update');
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
                        console.log('🔄 [Notification] Set isInitialized to true');
                    }
                } else {
                    // Если список сообщений пуст, сбрасываем счетчики
                    console.log('📭 [Notification] No messages received');
                    setSenderCounts(new Map());
                    setUnreadCount(0);
                    setMessages([]);
                    previousMessagesRef.current = [];

                    // Все равно помечаем как инициализированный
                    if (!isInitialized) {
                        setIsInitialized(true);
                        console.log('🔄 [Notification] Set isInitialized to true (empty messages)');
                    }
                }
            }
        } catch (error) {
            console.error('❌ [Notification] Error processing WebSocket message:', error);
        }
    };

    // Инициализация WebSocket
    const {connect, disconnect, sendMessage, isConnected, reconnect} = useWebSocket(`/wss/notification/`, {
        onOpen: () => {
            console.log('✅ [Notification] WebSocket connected');
            setWsConnected(true);
            setReconnectAttempts(0);
            // ИСПРАВЛЕНО: Сбрасываем кеши при переподключении для корректного сравнения
            previousMessagesRef.current = [];
            sentNotificationsCache.current.clear();
            console.log('🔄 [Notification] Reset caches on reconnect');
            sendMessage({type: 'get_initial_data'});
            lastPingTimeRef.current = Date.now();
            setTimeout(async () => {
                try {
                    const currentPermissions = await Notifications.getPermissionsAsync();
                    const permissionGranted = currentPermissions.status === 'granted';
                    console.log('🔧 [Notification] Force sync permissions after WebSocket connect:', permissionGranted);
                    setHasNotificationPermission(permissionGranted);
                } catch (error) {
                    console.error('❌ [Notification] Error syncing permissions:', error);
                }
            }, 1000);

        },
        onMessage: handleMessage,
        onClose: (event: any) => {
            console.log(`🔌 [Notification] WebSocket closed: ${event.code} ${event.reason}`);
            setWsConnected(false);

            // Увеличиваем счетчик попыток переподключения
            const newAttempts = reconnectAttempts + 1;
            setReconnectAttempts(newAttempts);

            // Экспоненциальная задержка для повторного подключения, но не более 30 секунд
            if (newAttempts < 10) {
                const reconnectDelay = Math.min(1000 * Math.pow(2, newAttempts), 30000);
                console.log(`🔄 [Notification] Will reconnect in ${reconnectDelay}ms (attempt ${newAttempts})`);
            }
        },
        onError: (error: any) => {
            console.error('❌ [Notification] WebSocket error:', error);
            setWsConnected(false);
        },
    });

    // Функция обновления уведомлений
    const refreshNotifications = () => {
        if (isConnected()) {
            console.log('🔄 [Notification] Refreshing notifications');
            sendMessage({type: 'get_initial_data'});
            lastPingTimeRef.current = Date.now();
        } else {
            console.log('🔄 [Notification] Connection lost, reconnecting...');
            reconnect();
        }
    };

    // Подключаемся при аутентификации
    useEffect(() => {
        if (isAuthenticated) {
            console.log('🔗 [Notification] Connecting WebSocket (auth state changed)');
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
                console.log('🔌 [Notification] Disconnecting WebSocket (unmount)');
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
                console.log('⏱️ [Notification] Periodic refresh');
                refreshNotifications();
            }, 60000);  // Каждые 60 секунд
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [isAuthenticated, wsConnected]);

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
        testNotification,
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