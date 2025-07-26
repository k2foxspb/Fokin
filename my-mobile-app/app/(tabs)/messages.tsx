
import React, { useState, useEffect } from 'react';
import { View, FlatList, StyleSheet, Pressable, Text, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import axios from 'axios';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNotifications } from '../../contexts/NotificationContext';
import { API_CONFIG } from '../../config';

interface User {
  id: number;
  username: string;
  avatar: string | null;
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
  const { senderCounts } = useNotifications();
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

      // Преобразуем timestamp в число
      let timestampNum: number;
      if (typeof timestamp === 'string') {
        timestampNum = parseInt(timestamp, 10);
      } else {
        timestampNum = timestamp;
      }

      // Проверяем, что timestamp валидный
      if (isNaN(timestampNum) || timestampNum <= 0) {
        console.warn('Invalid timestamp:', timestamp);
        return 'Неверная дата';
      }

      // Создаем дату из timestamp (умножаем на 1000, так как JS работает с миллисекундами)
      const date = new Date(timestampNum * 1000);

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
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Загрузка...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Чаты',
          headerStyle: {
            backgroundColor: '#fff',
          },
          headerShadowVisible: false,
        }}
      />
      {error ? (
        <View style={styles.centerContainer}>
          <MaterialCommunityIcons name="alert-circle-outline" size={50} color="#ff3b30" />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => fetchChats()}
          >
            <Text style={styles.retryButtonText}>Повторить</Text>
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
                  pressed && styles.chatItemPressed
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
                    <View style={[styles.avatar, styles.avatarPlaceholder]}>
                      <Text style={styles.avatarText}>
                        {item.other_user.username.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.chatInfo}>
                  <View style={styles.chatHeader}>
                    <Text style={styles.username} numberOfLines={1}>
                      {item.other_user.username}
                    </Text>
                    <Text style={styles.timestamp}>
                      {formatDate(item.last_message_time)}
                    </Text>
                  </View>
                  <Text style={styles.lastMessage} numberOfLines={1}>
                    {item.last_message}
                  </Text>
                </View>
                {displayUnreadCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
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
              colors={['#007AFF']}
              tintColor="#007AFF"
            />
          }
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="chat-outline" size={50} color="#666" />
              <Text style={styles.emptyText}>У вас пока нет чатов</Text>
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
    backgroundColor: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  chatItem: {
    flexDirection: 'row',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  chatItemPressed: {
    backgroundColor: '#f5f5f5',
  },
  avatarContainer: {
    marginRight: 15,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarPlaceholder: {
    backgroundColor: '#e1e1e1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 20,
    color: '#666',
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
    color: '#666',
  },
  lastMessage: {
    fontSize: 14,
    color: '#666',
  },
  badge: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#fff',
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
    color: '#666',
  },
  errorText: {
    marginTop: 10,
    color: '#ff3b30',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  retryButton: {
    marginTop: 15,
    padding: 10,
    backgroundColor: '#007AFF',
    borderRadius: 5,
  },
  retryButtonText: {
    color: '#fff',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
});