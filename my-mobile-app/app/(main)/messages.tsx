
import React, { useState, useEffect } from 'react';
import { View, FlatList, StyleSheet, Pressable, Text, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import axios from 'axios';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNotifications } from '../../contexts/NotificationContext';
import { useTheme } from '../../contexts/ThemeContext';
import { API_CONFIG } from '../../config';

interface User {
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
  const { senderCounts, userStatuses } = useNotifications();
  const { theme } = useTheme();
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  console.log('Component rendering. Current state:', { chats, isLoading, error });

  const fetchChats = async (showLoader = true) => {
    console.log('fetchChats started, showLoader:', showLoader);
    if (showLoader) setIsLoading(true);
    setError(null);

    try {
      // Используем тот же ключ, что и в _layout.tsx
      const token = await AsyncStorage.getItem('userToken');
      console.log('Token retrieved:', token ? 'Token exists' : 'No token');

      if (!token) {
        console.log('No token found, redirecting to login');
        router.replace('/login');
        return;
      }

      console.log('Making API request...');
      const response = await axios.get<ChatPreview[]>(
        `${API_CONFIG.BASE_URL}/chat/api/chats/list_preview/`,
        {
          headers: {
            'Authorization': `Token ${token}`,
            'Content-Type': 'application/json',
          }
        }
      );

      console.log('API Response received:', response.data);
      setChats(response.data);
      console.log('Chats state updated:', response.data);
    } catch (error) {
      console.log('Error occurred:', error);
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          // Удаляем тот же ключ
          await AsyncStorage.removeItem('userToken');
          router.replace('/login');
          return;
        }
        setError(error.response?.data?.detail || 'Ошибка при загрузке чатов');
      } else {
        setError('Произошла неизвестная ошибка');
      }
    } finally {
      console.log('Setting loading states to false');
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const onRefresh = () => {
    setIsRefreshing(true);
    fetchChats(false);
  };

  useEffect(() => {
    console.log('useEffect triggered');
    fetchChats();
  }, []);

  // Получаем количество непрочитанных сообщений из WebSocket данных
  const getUnreadCount = (userId: number) => {
    return senderCounts.get(userId) || 0;
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

  console.log('Before render. Loading:', isLoading, 'Error:', error, 'Chats:', chats);

  if (isLoading && !isRefreshing) {
    console.log('Rendering loading state');
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
        <FlatList
          data={chats}
          renderItem={({ item }) => {
            // Используем данные из WebSocket для отображения актуального количества непрочитанных сообщений
            const wsUnreadCount = getUnreadCount(item.other_user.id);
            const displayUnreadCount = wsUnreadCount > 0 ? wsUnreadCount : item.unread_count;

            return (
              <Pressable
                style={({ pressed }) => [
                  styles.chatItem,
                  { borderBottomColor: theme.border },
                  pressed && [styles.chatItemPressed, { backgroundColor: theme.surfacePressed }]
                ]}
                onPress={() => {
                  console.log('Chat pressed:', item);
                  router.push({
                    pathname: '/chat/[id]',
                    params: { id: item.id, userId: item.other_user.id }
                  });
                }}
              >
                <View style={styles.avatarContainer}>
                  {item.other_user.avatar ? (
                    <Image
                      source={{ uri: `${API_CONFIG.BASE_URL}${item.other_user.avatar}` }}
                      style={styles.avatar}
                    />
                  ) : (
                    <Image
                      source={
                        item.other_user.gender === 'male'
                          ? require('../../assets/avatar/male.png')
                          : require('../../assets/avatar/female.png')
                      }
                      style={styles.avatar}
                    />
                  )}
                  {/* Online status indicator - using real-time status from NotificationContext */}
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
                      {formatDate(item.last_message_time)}
                    </Text>
                  </View>
                  <Text style={[styles.lastMessage, { color: theme.textSecondary }]} numberOfLines={1}>
                    {item.last_message}
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
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
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