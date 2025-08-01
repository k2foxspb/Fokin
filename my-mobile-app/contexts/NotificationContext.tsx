import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { 
  requestNotificationPermissions, 
  registerForPushNotifications, 
  sendLocalNotification,
  addNotificationListener,
  addNotificationResponseListener
} from '../services/notificationService';
import { AppState, Platform } from 'react-native';
import { API_CONFIG } from '../config';

interface NotificationContextType {
  unreadCount: number;
  messages: MessageType[];
  senderCounts: Map<number, number>;
  userStatuses: Map<number, string>;
  connect: () => void;
  disconnect: () => void;
  refreshNotifications: () => void; // Добавляем метод для принудительного обновления
}

interface MessageType {
  sender_id: number;
  count: number;
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
  connect: () => {},
  disconnect: () => {},
  refreshNotifications: () => {},
});

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [senderCounts, setSenderCounts] = useState<Map<number, number>>(new Map());
  const [userStatuses, setUserStatuses] = useState<Map<number, string>>(new Map());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [hasNotificationPermission, setHasNotificationPermission] = useState<boolean>(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);
  // Исправляем TypeScript ошибки - добавляем null как начальное значение
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const previousMessagesRef = useRef<MessageType[]>([]);

  // Проверяем аутентификацию при инициализации
  useEffect(() => {
    const checkAuth = async () => {
      const token = await AsyncStorage.getItem('userToken');
      setIsAuthenticated(!!token);
    };
    checkAuth();
  }, []);

  // Инициализация уведомлений
  useEffect(() => {
    const initNotifications = async () => {
      // Запрашиваем разрешение на отправку уведомлений
      const hasPermission = await requestNotificationPermissions();
      setHasNotificationPermission(hasPermission);

      if (hasPermission) {
        // Регистрируем устройство для push-уведомлений
        const token = await registerForPushNotifications();
        setPushToken(token);
      }

      // Добавляем слушатель для уведомлений, полученных когда приложение открыто
      notificationListener.current = addNotificationListener(notification => {
        console.log('Notification received in foreground:', notification);
        // Принудительно обновляем данные при получении уведомления
        if (isAuthenticated) {
          refreshNotifications();
        }
      });

      // Добавляем слушатель для нажатий на уведомления
      responseListener.current = addNotificationResponseListener(response => {
        console.log('Notification response received:', response);
        handleNotificationResponse(response);
      });

      // Слушаем изменения состояния приложения
      const subscription = AppState.addEventListener('change', nextAppState => {
        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === 'active'
        ) {
          // Приложение вернулось на передний план
          console.log('App has come to the foreground!');
          // Принудительно обновляем данные
          if (isAuthenticated) {
            refreshNotifications();
          }
        }
        appState.current = nextAppState;
      });

      return () => {
        // Очищаем слушатели при размонтировании
        notificationListener.current?.remove();
        responseListener.current?.remove();
        subscription.remove();
      };
    };

    if (isAuthenticated) {
      initNotifications();
    }
  }, [isAuthenticated]);

  // Отдельный эффект для проверки запуска из уведомления
  useEffect(() => {
    const checkLaunchNotification = async () => {
      // Проверяем, было ли приложение запущено из уведомления
      const lastNotificationResponse = await Notifications.getLastNotificationResponseAsync();
      if (lastNotificationResponse) {
        console.log('App was opened from notification:', lastNotificationResponse);

        // Даем приложению время инициализироваться перед навигацией
        setTimeout(() => {
          // Обрабатываем уведомление, которое запустило приложение
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
    console.log('Notification data:', data);

    // Обновляем данные
    if (isAuthenticated) {
      refreshNotifications();
    }

    // Навигация к соответствующему экрану
    if (data && data.type === 'message_notification') {
      console.log('Navigating to messages screen');

      // Исправляем TypeScript ошибку - приводим к строке
      if (data.chatId) {
        router.push({
          pathname: '/chat/[id]',
          params: { id: String(data.chatId) }
        });
      } else {
        router.push('/(tabs)/messages');
      }
    }
  };

  const handleMessage = (event: WebSocketMessageEvent) => {
    try {
      const data: NotificationData | UserStatusUpdate = JSON.parse(event.data);
      console.log('WebSocket message received:', data);

      // Обработка обновления статуса пользователя
      if (data.type === 'user_status_update') {
        const statusUpdate = data as UserStatusUpdate;
        console.log(`User ${statusUpdate.user_id} status changed to: ${statusUpdate.status}`);

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
        console.log('Updating notification counts:', {
          unreadCount: notificationData.unique_sender_count,
          messages: notificationData.messages
        });

        setUnreadCount(notificationData.unique_sender_count);

        // Извлекаем массив сообщений из структуры [dict, messages[]]
        if (Array.isArray(notificationData.messages) && notificationData.messages.length === 2) {
          const messageArray = notificationData.messages[1];
          setMessages(messageArray);

          // Создаем Map для быстрого поиска количества сообщений по sender_id
          const newSenderCounts = new Map<number, number>();
          messageArray.forEach(message => {
            newSenderCounts.set(message.sender_id, message.count);
          });
          setSenderCounts(newSenderCounts);

          // Проверяем, есть ли новые сообщения для отправки уведомления
          if (previousMessagesRef.current.length > 0) {
            const hasNewMessages = messageArray.some(newMsg => {
              const prevMsg = previousMessagesRef.current.find(m => m.sender_id === newMsg.sender_id);
              return !prevMsg || newMsg.count > prevMsg.count;
            });

            if (hasNewMessages && hasNotificationPermission && AppState.currentState !== 'active') {
              // Отправляем уведомление только если приложение не активно
              sendLocalNotification({
                title: 'Новые сообщения',
                body: `У вас ${notificationData.unique_sender_count} непрочитанных сообщений`,
                data: { type: 'message_notification' }
              }).catch(error => {
                console.error('Failed to send notification:', error);
              });
            }
          }

          // Сохраняем текущие сообщения для сравнения в будущем
          previousMessagesRef.current = [...messageArray];
        }
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  };

  const { connect, disconnect, sendMessage, isConnected } = useWebSocket(`/ws/notification/`, {
    onOpen: () => {
      console.log('Notification WebSocket connected');
      // Запрашиваем начальные данные
      sendMessage({ type: 'get_initial_data' });
    },
    onMessage: handleMessage,
    onClose: () => {
      console.log('Notification WebSocket closed');
      // Не сбрасываем данные сразу, оставляем последние известные значения
    },
    onError: (error: any) => {
      console.error('Notification WebSocket error:', error);
    },
  });

  // Функция для принудительного обновления уведомлений
  const refreshNotifications = () => {
    console.log('Refreshing notifications...');
    if (isConnected()) {
      sendMessage({ type: 'get_initial_data' });
    } else {
      // Если нет соединения, пытаемся переподключиться
      connect();
    }
  };

  useEffect(() => {
    // Подключаемся только если пользователь аутентифицирован
    if (isAuthenticated) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [isAuthenticated]);

  // Периодическое обновление для обеспечения актуальности данных
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isAuthenticated && isConnected()) {
      // Обновляем данные каждые 30 секунд
      interval = setInterval(() => {
        refreshNotifications();
      }, 30000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isAuthenticated, isConnected()]);

  const value = {
    unreadCount,
    messages,
    senderCounts,
    userStatuses,
    connect,
    disconnect,
    refreshNotifications,
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