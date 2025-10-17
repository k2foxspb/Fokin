import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, FlatList, StyleSheet, Pressable, Text, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNotifications } from '../../contexts/NotificationContext';
import { useTheme } from '../../contexts/ThemeContext';
import { NotificationPermissionManager } from '../../components/NotificationPermissionManager';
import { API_CONFIG } from '../../config';
import CachedImage from "@/components/CachedImage";
interface User {
  gender: string;
  id: number;
  username: string;
  avatar: string | null;
  is_online?: string;
}

interface ChatPreview {
  id: number;
  other_user: User;
  last_message: string;
  last_message_time: string | number;
  unread_count: number;
}


export default function MessagesScreen() {
  const router = useRouter();
  const { senderCounts, userStatuses, messages, } = useNotifications();
  const { theme } = useTheme();
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref для отслеживания предыдущих сообщений из WebSocket
  const previousMessagesRef = useRef<typeof messages>([]);

  const fetchChats = async (showLoader = true) => {
    if (showLoader) setIsLoading(true);
    setError(null);

    try {
      // Используем тот же ключ, что и в _layout.tsx
      const token = await AsyncStorage.getItem('userToken');

      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      const response = await axios.get<ChatPreview[]>(
        `${API_CONFIG.BASE_URL}/chat/api/chats/list-preview/`,
        {
          headers: {
            'Authorization': `Token ${token}`,
            'Content-Type': 'application/json',
          }
        }
      );

      setChats(response.data);

    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          // Удаляем тот же ключ
          await AsyncStorage.removeItem('userToken');
          router.replace('/(auth)/login');
          return;
        }
        setError(error.response?.data?.detail || 'Ошибка при загрузке чатов');
      } else {
        setError('Произошла неизвестная ошибка');
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const onRefresh = () => {
    setIsRefreshing(true);
    fetchChats(false);
  };

  useEffect(() => {

    fetchChats();
  }, []);

  // Обновляем список чатов при возвращении на экран
  useFocusEffect(
    useCallback(() => {
      console.log('📱 [Messages] Screen focused, refreshing chat list');
      // Обновляем данные без показа лоадера
      fetchChats(false);
    }, [])
  );

  // НОВОЕ: Обновляем список чатов при получении новых сообщений через WebSocket
  useEffect(() => {
    if (messages.length > 0) {


      // Проверяем, изменились ли сообщения
      const hasChanges = messages.some((newMsg, index) => {
        const prevMsg = previousMessagesRef.current[index];
        return !prevMsg ||
               newMsg.sender_id !== prevMsg.sender_id ||
               newMsg.count !== prevMsg.count ||
               newMsg.last_message !== prevMsg.last_message ||
               newMsg.timestamp !== prevMsg.timestamp;
      }) || messages.length !== previousMessagesRef.current.length;

      if (hasChanges) {
        console.log('🔄 [Messages] Messages changed, updating chat list');

        // Обновляем чаты с учетом данных из WebSocket
        setChats(prevChats => {
          return prevChats.map(chat => {
            const wsMessage = messages.find(msg => msg.sender_id === chat.other_user.id);
            if (wsMessage) {
              // Создаем обновленный объект чата с данными из WebSocket
              const updatedChat = {
                ...chat,
                unread_count: wsMessage.count || chat.unread_count
              };

              // Обновляем последнее сообщение если оно новее
              if (wsMessage.last_message && wsMessage.last_message.trim() !== '') {
                updatedChat.last_message = wsMessage.last_message;
              }

              // Обновляем время последнего сообщения
              if (wsMessage.timestamp) {
                // Конвертируем Unix timestamp в строку даты
                let newTimestamp: string | number = wsMessage.timestamp;

                // Если timestamp - это число (Unix время), конвертируем его
                if (typeof wsMessage.timestamp === 'number' ||
                   (typeof wsMessage.timestamp === 'string' && !isNaN(Number(wsMessage.timestamp)))) {
                  const unixTime = Number(wsMessage.timestamp);
                  // Если timestamp в секундах (меньше чем 10^10), конвертируем в миллисекунды
                  const timestampMs = unixTime < 1e10 ? unixTime * 1000 : unixTime;
                  newTimestamp = new Date(timestampMs).toISOString();
                }

                updatedChat.last_message_time = newTimestamp;
              }

              console.log(`📝 [Messages] Updated chat for user ${chat.other_user.id}:`, {
                oldUnreadCount: chat.unread_count,
                newUnreadCount: updatedChat.unread_count,
                oldMessage: chat.last_message.substring(0, 20),
                newMessage: updatedChat.last_message.substring(0, 20),
                wsMessage: wsMessage
              });

              return updatedChat;
            }
            return chat;
          }).sort((a, b) => {
            // Сортируем по времени последнего сообщения (новые сверху)
            const timeA = new Date(a.last_message_time).getTime();
            const timeB = new Date(b.last_message_time).getTime();
            return timeB - timeA;
          });
        });

        // Сохраняем текущие сообщения для следующего сравнения
        previousMessagesRef.current = [...messages];
      }
    }
  }, [messages]);

  // Получаем количество непрочитанных сообщений из WebSocket данных
  const getUnreadCount = (userId: number) => {
    return senderCounts.get(userId) || 0;
  };

  // Функция для получения актуального последнего сообщения
  const getLastMessage = (chat: ChatPreview) => {
    const wsMessage = messages.find(msg => msg.sender_id === chat.other_user.id);
    if (wsMessage && wsMessage.last_message && wsMessage.last_message.trim() !== '') {
      return wsMessage.last_message;
    }
    return chat.last_message;
  };

  // Функция для получения актуального времени последнего сообщения
  const getLastMessageTime = (chat: ChatPreview) => {
    const wsMessage = messages.find(msg => msg.sender_id === chat.other_user.id);
    if (wsMessage && wsMessage.timestamp) {
      return wsMessage.timestamp;
    }
    return chat.last_message_time;
  };

  const formatDate = (timestamp: string | number) => {
    try {
      if (!timestamp) {
        return '';
      }

      let date: Date;

      if (typeof timestamp === 'string') {
        // Handle various string formats
        if (timestamp.includes('T') && timestamp.includes('-')) {
          // ISO format: "2025-07-31T08:55:32.436877Z" or "2025-07-31T08:55:32"
          date = new Date(timestamp);
        } else if (timestamp.includes('.') && timestamp.includes(',')) {
          // Russian format: "31.07.2025, 08:55:32"
          const cleanTimestamp = timestamp.replace(',', '');
          const parts = cleanTimestamp.split(' ');
          if (parts.length >= 2) {
            const datePart = parts[0].split('.').reverse().join('-'); // DD.MM.YYYY -> YYYY-MM-DD
            const timePart = parts[1];
            date = new Date(`${datePart}T${timePart}`);
          } else {
            date = new Date(timestamp);
          }
        } else if (timestamp.includes('-') && timestamp.includes(' ')) {
          // Django default format: "2025-07-31 08:55:32"
          date = new Date(timestamp.replace(' ', 'T'));
        } else {
          // Try parsing as number string (Unix timestamp)
          const timestampNum = parseFloat(timestamp);
          if (!isNaN(timestampNum)) {
            // If timestamp is in seconds (less than 1e10), convert to milliseconds
            date = new Date(timestampNum < 1e10 ? timestampNum * 1000 : timestampNum);
          } else {
            date = new Date(timestamp);
          }
        }
      } else if (typeof timestamp === 'number') {
        // Handle numeric timestamps
        // If timestamp is in seconds (less than 1e10), convert to milliseconds
        date = new Date(timestamp < 1e10 ? timestamp * 1000 : timestamp);
      } else {
        console.warn('Unknown timestamp format:', timestamp);
        return 'Неверная дата';
      }

      // Проверяем, что дата валидная
      if (isNaN(date.getTime())) {
        console.warn('Invalid date from timestamp:', timestamp);
        return 'Неверная дата';
      }

      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      // Сравниваем даты по дням
      const dateDay = date.toDateString();
      const nowDay = now.toDateString();
      const yesterdayDay = yesterday.toDateString();

      if (dateDay === nowDay) {
        return date.toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      } else if (dateDay === yesterdayDay) {
        return 'Вчера';
      } else {
        return date.toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        });
      }
    } catch (error) {
      console.error('Error formatting timestamp:', error, 'Original value:', timestamp);
      return 'Неверная дата';
    }
  };

  if (isLoading && !isRefreshing) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Загрузка...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: 'Чаты',
          headerStyle: {
            backgroundColor: theme.headerBackground,
          },
          headerTintColor: theme.headerText,
          headerShadowVisible: false,
        }}
      />
      {error ? (
        <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={50} color={theme.error} />
          <Text style={[styles.errorText, { color: theme.error }]}>{error}</Text>
          <Pressable
            style={[styles.retryButton, { backgroundColor: theme.primary }]}
            onPress={() => fetchChats()}
          >
            <Text style={[styles.retryButtonText, { color: theme.background }]}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* НОВОЕ: Добавляем менеджер разрешений уведомлений */}
          <NotificationPermissionManager />

          <FlatList
            data={chats}
            renderItem={({ item }) => {
              // ОБНОВЛЕНО: Используем данные из WebSocket для отображения актуального количества непрочитанных сообщений
              const wsUnreadCount = getUnreadCount(item.other_user.id);
              const displayUnreadCount = wsUnreadCount > 0 ? wsUnreadCount : item.unread_count;

              // НОВОЕ: Получаем актуальные данные сообщения
              const currentLastMessage = getLastMessage(item);
              const currentLastMessageTime = getLastMessageTime(item);

              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.chatItem,
                    { borderBottomColor: theme.border },
                    pressed && [styles.chatItemPressed, { backgroundColor: theme.surfacePressed }]
                  ]}
                  onPress={() => {
                    router.push({
                      pathname: '/chat/[id]',
                      params: { id: item.id, userId: item.other_user.id }
                    });
                  }}
                >
                  <View style={styles.avatarContainer}>
                    <CachedImage
                      uri={
                        item.other_user.avatar 
                          ? item.other_user.avatar.startsWith('http') 
                            ? item.other_user.avatar 
                            : `${API_CONFIG.BASE_URL}${item.other_user.avatar}`
                          : ''
                      }
                      style={styles.avatar}
                    />
                    <View style={[
                      styles.onlineIndicator,
                      {
                        backgroundColor: userStatuses.has(item.other_user.id)
                          ? userStatuses.get(item.other_user.id) === 'online' ? theme.online : theme.offline
                          : item.other_user.is_online === 'online' ? theme.online : theme.offline,
                        borderColor: theme.background
                      }
                    ]} />
                  </View>
                  <View style={styles.chatInfo}>
                    <View style={styles.chatHeader}>
                      <Text style={[styles.username, { color: theme.text }]} numberOfLines={1}>
                        {item.other_user.username}
                      </Text>
                      <Text style={[styles.timestamp, { color: theme.textSecondary }]}>
                        {formatDate(currentLastMessageTime)}
                      </Text>
                    </View>
                    <Text style={[styles.lastMessage, { color: theme.textSecondary }]} numberOfLines={1}>
                      {currentLastMessage}
                    </Text>
                  </View>
                  {displayUnreadCount > 0 && (
                    <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                      <Text style={[styles.badgeText, { color: theme.background }]}>
                        {displayUnreadCount > 99 ? '99+' : displayUnreadCount}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            }}
            keyExtractor={item => item.id.toString()}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                colors={[theme.primary]}
                tintColor={theme.primary}
              />
            }
            ListEmptyComponent={() => (
              <View style={styles.emptyContainer}>
                <MaterialCommunityIcons name="chat-outline" size={50} color={theme.textSecondary} />
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>У вас пока нет чатов</Text>
              </View>
            )}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatItem: {
    flexDirection: 'row',
    padding: 15,
    borderBottomWidth: 1,
  },
  chatItemPressed: {
    // Background color is now handled dynamically
  },
  avatarContainer: {
    marginRight: 15,
    position: 'relative',
    borderRadius: 25,
    overflow: 'hidden',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#f0f0f0', // Фон на случай загрузки
    overflow: 'hidden',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 20,
  },
  chatInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  username: {
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
    marginRight: 8,
  },
  timestamp: {
    fontSize: 12,
  },
  lastMessage: {
    fontSize: 14,
  },
  badge: {
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorText: {
    marginTop: 10,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  retryButton: {
    marginTop: 15,
    padding: 10,
    borderRadius: 5,
  },
  retryButtonText: {
    fontSize: 16,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
});