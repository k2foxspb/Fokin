import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert
} from 'react-native';
import { API_CONFIG } from '../../config';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useNotifications } from '../../contexts/NotificationContext';

interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  avatar?: string;
  gender?: string;
  is_online: string;
  last_seen?: string;
}

export default function SearchScreen() {
  const { theme } = useTheme();
  const { userStatuses } = useNotifications();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [forceUpdateTrigger, setForceUpdateTrigger] = useState(0);

  // Создаем стили с темой
  const styles = createStyles(theme);

  // Функция для форматирования времени последнего входа
  const formatLastSeen = (lastSeen: string) => {
    try {
      const lastSeenDate = new Date(lastSeen);
      const now = new Date();
      const diffInMinutes = Math.floor((now.getTime() - lastSeenDate.getTime()) / (1000 * 60));

      if (diffInMinutes < 1) {
        return 'только что';
      } else if (diffInMinutes < 60) {
        return `${diffInMinutes} мин назад`;
      } else if (diffInMinutes < 1440) { // меньше суток
        const hours = Math.floor(diffInMinutes / 60);
        return `${hours} ч назад`;
      } else if (diffInMinutes < 10080) { // меньше недели
        const days = Math.floor(diffInMinutes / 1440);
        return `${days} д назад`;
      } else {
        // Показываем дату
        return lastSeenDate.toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        });
      }
    } catch (error) {
      console.error('Error formatting last seen:', error);
      return 'недавно';
    }
  };

  // Функция для получения актуального статуса пользователя
  const getUserStatus = (user: User) => {
    const realtimeStatus = userStatuses.get(user.id);
    console.log(`👥 [SEARCH] Getting status for user ${user.id}: realtime=${realtimeStatus}, original=${user.is_online}`);

    if (realtimeStatus !== undefined && realtimeStatus !== null) {
      return realtimeStatus;
    }
    return user.is_online || 'offline';
  };

  const fetchUsers = async (search?: string) => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      let url = `${API_CONFIG.BASE_URL}/profile/api/users/`;
      if (search) {
        url += `?search=${encodeURIComponent(search)}`;
      }

      const response = await axios.get(url, {
        headers: { Authorization: `Token ${token}` }
      });

      setUsers(response.data);
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось загрузить список пользователей');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchUsers(searchQuery);
  };

  const handleSearch = (text: string) => {
    setSearchQuery(text);
    if (text.length > 2 || text.length === 0) {
      fetchUsers(text);
    }
  };

  const navigateToProfile = (username: string) => {
    router.push(`/user/${username}`);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Автоматическое обновление интерфейса при изменении статусов пользователей
  useEffect(() => {
    const statusEntries = Array.from(userStatuses.entries());
    console.log('👥 [SEARCH] User statuses updated:', statusEntries);
    console.log('👥 [SEARCH] Map size:', userStatuses.size);

    // Принудительно обновляем компонент при изменении статусов
    setForceUpdateTrigger(prev => prev + 1);

    // Также обновляем массив пользователей для гарантированного перерендера
    setUsers(prevUsers => {
      console.log('👥 [SEARCH] Force updating users array, count:', prevUsers.length);
      return [...prevUsers];
    });
  }, [userStatuses]);

  // Дополнительный эффект для отслеживания изменений размера Map
  useEffect(() => {
    console.log('👥 [SEARCH] Force update trigger changed:', forceUpdateTrigger);
  }, [forceUpdateTrigger]);

  const renderUser = ({ item }: { item: User }) => {
    const currentStatus = getUserStatus(item);
    const isOnline = currentStatus === 'online';

    // Логирование для отладки (можно убрать в продакшене)
    if (userStatuses.has(item.id)) {
      console.log(`👥 [SEARCH] Rendering user ${item.username} with status: ${currentStatus} (realtime: ${userStatuses.get(item.id)}, original: ${item.is_online})`);
    }

    return (
      <TouchableOpacity
        style={styles.userItem}
        onPress={() => navigateToProfile(item.username)}
      >
        <View style={styles.avatarContainer}>
          <Image
            source={
              item.avatar
                ? { uri: item.avatar }
                : item.gender === 'male'
                ? require('../../assets/avatar/male.png')
                : require('../../assets/avatar/female.png')
            }
            style={styles.avatar}
          />
          <View style={[
            styles.onlineIndicator,
            { backgroundColor: isOnline ? theme.online : theme.offline }
          ]} />
        </View>

        <View style={styles.userInfo}>
          <Text style={styles.userName}>
            {item.first_name} {item.last_name}
          </Text>
          <Text style={styles.username}>@{item.username}</Text>
          <Text style={[
            styles.onlineStatus,
            { color: isOnline ? theme.online : theme.textSecondary }
          ]}>
            {isOnline 
              ? 'в сети' 
              : item.last_seen 
                ? formatLastSeen(item.last_seen)
                : 'был(а) в сети недавно'
            }
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.loadingText}>Загрузка пользователей...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color={theme.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Поиск пользователей..."
          placeholderTextColor={theme.placeholder}
          value={searchQuery}
          onChangeText={handleSearch}
        />
      </View>

      <FlatList
        data={users}
        renderItem={renderUser}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.primary]}
            tintColor={theme.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.background,
  },
  loadingText: {
    marginTop: 8,
    color: theme.textSecondary,
    fontSize: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    margin: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    elevation: 3,
    shadowColor: theme.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: theme.border,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: theme.text,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    padding: 18,
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 12,
    elevation: 2,
    shadowColor: theme.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: theme.border,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: theme.border,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: theme.surface,
    elevation: 2,
    shadowColor: theme.text,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 2,
  },
  username: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: 4,
  },
  onlineStatus: {
    fontSize: 12,
    fontWeight: '500',
  },
});