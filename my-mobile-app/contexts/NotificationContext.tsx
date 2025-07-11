import React, { createContext, useContext, useEffect, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

interface NotificationContextType {
  unreadCount: number;
  messages: MessageType[];
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
  connect: () => {},
  disconnect: () => {},
});

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [messages, setMessages] = useState<MessageType[]>([]);

  const handleMessage = (event: WebSocketMessageEvent) => {
    try {
      const data: NotificationData = JSON.parse(event.data);
      console.log('Notification received:', data);

      if (data.type === 'initial_notification' || data.type === 'messages_by_sender_update') {
        setUnreadCount(data.unique_sender_count);
        // Извлекаем массив сообщений из структуры [dict, messages[]]
        if (Array.isArray(data.messages) && data.messages.length === 2) {
          setMessages(data.messages[1]);
        }
      }
    } catch (error) {
      console.error('Error processing notification:', error);
    }
  };

  const { connect, disconnect } = useWebSocket('/ws/notification/', {
    onOpen: () => {
      console.log('Notification WebSocket connected');
    },
    onMessage: handleMessage,
    onClose: () => {
      console.log('Notification WebSocket closed');
      setUnreadCount(0);
      setMessages([]);
    },
    onError: (error) => {
      console.error('Notification WebSocket error:', error);
    },
  });

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, []);

  const value = {
    unreadCount,
    messages,
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