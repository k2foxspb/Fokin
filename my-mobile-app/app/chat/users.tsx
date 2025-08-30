import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import CachedImage from '../../components/CachedImage';
import {API_CONFIG} from "../../config";

interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  avatar?: string;
  gender?: string;
  is_online: string;
}

export default function UsersScreen() {
  const { theme } = useTheme();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchUsers = async (search?: string) => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      let url = `${API_CONFIG.BASE_URL}profile/api/users/`;
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

  const renderUser = ({ item }: { item: User }) => (

      <TouchableOpacity
      style={styles.userItem}
      onPress={() => navigateToProfile(item.username)}
    >
      <View style={styles.avatarContainer}>
        {item.avatar ? (
          <CachedImage
            uri={item.avatar}
            style={styles.avatar}
          />
        ) : (
          <CachedImage
            uri=""
            style={styles.avatar}

          />
        )}
        <View style={[
          styles.onlineIndicator,
          { backgroundColor: item.is_online === 'online' ? theme.online : theme.offline }
        ]} />
      </View>

      <View style={styles.userInfo}>
        <Text style={styles.userName}>
          {item.first_name} {item.last_name}
        </Text>
        <Text style={styles.username}>@{item.username}</Text>
        <Text style={[
          styles.onlineStatus,
          { color: item.is_online === 'online' ? theme.online : theme.offline }
        ]}>
          {item.is_online === 'online' ? 'в сети' : 'не в сети'}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
    </TouchableOpacity>
  );

  const styles = createStyles(theme);

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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
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
