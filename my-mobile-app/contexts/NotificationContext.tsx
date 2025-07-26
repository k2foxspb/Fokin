import React, { createContext, useContext, useEffect, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  // Проверяем аутентификацию при инициализации
  useEffect(() => {
    const checkAuth = async () => {
      const token = await AsyncStorage.getItem('userToken');
      setIsAuthenticated(!!token);
    };
    checkAuth();
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
        }
      }
    } catch (error) {
      console.error('Error processing notification:', error);
    }
  };
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
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