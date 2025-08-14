import { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_CONFIG } from '../config';

interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  avatar: string | null;
  gender: string;
  is_online: string;
}

interface ChatPreview {
  id: number;
  other_user: User;
  last_message: string;
  last_message_time: string;
  unread_count: number;
}

interface UseChatListReturn {
  chats: ChatPreview[];
  isLoading: boolean;
  error: string | null;
  refreshChats: () => void;
  isConnected: boolean;
}

export const useChatList = (): UseChatListReturn => {
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);

  const connect = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        setError('Токен авторизации не найден');
        return;
      }

      const wsUrl = `${API_CONFIG.WS_URL}/wss/chat_list/?token=${token}`;
      console.log('🔗 [ChatList] Connecting to:', wsUrl);

      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('✅ [ChatList] WebSocket connected');
        setIsConnected(true);
        setError(null);
        reconnectAttempts.current = 0;

        // Запрашиваем список чатов
        wsRef.current?.send(JSON.stringify({ type: 'get_chat_list' }));
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 [ChatList] Received:', data);

          if (data.type === 'chat_list') {
            setChats(data.chats);
            setIsLoading(false);
            setError(null);
          }
        } catch (error) {
          console.error('❌ [ChatList] Error parsing message:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('❌ [ChatList] WebSocket error:', error);
        setError('Ошибка соединения');
        setIsConnected(false);
      };

      wsRef.current.onclose = (event) => {
        console.log('🔌 [ChatList] WebSocket closed:', event.code, event.reason);
        setIsConnected(false);

        if (event.code !== 1000 && reconnectAttempts.current < 5) {
          const timeout = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          console.log(`🔄 [ChatList] Reconnecting in ${timeout}ms (attempt ${reconnectAttempts.current + 1})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, timeout);
        }
      };

    } catch (error) {
      console.error('❌ [ChatList] Error connecting:', error);
      setError('Ошибка подключения к серверу');
      setIsLoading(false);
    }
  };

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Component unmounted');
      wsRef.current = null;
    }

    setIsConnected(false);
  };

  const refreshChats = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'get_chat_list' }));
    } else {
      connect();
    }
  };

  useEffect(() => {
    connect();
    return disconnect;
  }, []);

  return {
    chats,
    isLoading,
    error,
    refreshChats,
    isConnected
  };
};