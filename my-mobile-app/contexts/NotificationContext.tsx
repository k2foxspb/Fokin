import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { 
  requestNotificationPermissions, 
  registerForPushNotifications, 
  sendLocalNotification,
  addNotificationListener,
  addNotificationResponseListener
} from '../services/notificationService';
import { AppState, Platform } from 'react-native';

interface NotificationContextType {
  unreadCount: number;
  messages: MessageType[];
  senderCounts: Map<number, number>;
  connect: () => void;
  disconnect: () => void;
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

const NotificationContext = createContext<NotificationContextType>({
  unreadCount: 0,
  messages: [],
  senderCounts: new Map(),
  connect: () => {},
  disconnect: () => {},
});

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [senderCounts, setSenderCounts] = useState<Map<number, number>>(new Map());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [hasNotificationPermission, setHasNotificationPermission] = useState<boolean>(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();
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
      });

      // Добавляем слушатель для нажатий на уведомления
      responseListener.current = addNotificationResponseListener(response => {
        console.log('Notification response received:', response);
        // Здесь можно добавить навигацию к экрану сообщений
      });

      // Слушаем изменения состояния приложения
      const subscription = AppState.addEventListener('change', nextAppState => {
        if (
          appState.current.match(/inactive|background/) && 
          nextAppState === 'active'
        ) {
          // Приложение вернулось на передний план
          console.log('App has come to the foreground!');
          // Обновляем данные
          if (isAuthenticated) {
            connect();
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

    initNotifications();
  }, []);

  const handleMessage = (event: WebSocketMessageEvent) => {
    try {
      const data: NotificationData = JSON.parse(event.data);
      console.log('Notification received:', data);

      if (data.type === 'initial_notification' || data.type === 'messages_by_sender_update') {
        setUnreadCount(data.unique_sender_count);
        // Извлекаем массив сообщений из структуры [dict, messages[]]
        if (Array.isArray(data.messages) && data.messages.length === 2) {
          const messageArray = data.messages[1];
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

            if (hasNewMessages && hasNotificationPermission) {
              // Отправляем уведомление о новых сообщениях
              sendLocalNotification({
                title: 'Новые сообщения',
                body: `У вас ${data.unique_sender_count} непрочитанных сообщений`,
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
      console.error('Error processing notification:', error);
    }
  };
  
  const { connect, disconnect } = useWebSocket(`/wss/notification/`, {
    onOpen: () => {
      console.log('Notification WebSocket connected');
    },
    onMessage: handleMessage,
    onClose: () => {
      console.log('Notification WebSocket closed');
      setUnreadCount(0);
      setMessages([]);
      setSenderCounts(new Map());
    },
    onError: (error: any) => {
      console.error('Notification WebSocket error:', error);
    },
  });

  useEffect(() => {
    // Подключаемся только если пользователь аутентифицирован
    if (isAuthenticated) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [isAuthenticated]);

  const value = {
    unreadCount,
    messages,
    senderCounts,
    connect,
    disconnect,
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