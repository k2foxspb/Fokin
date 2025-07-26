import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  Alert,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { API_CONFIG } from '../../config';
import ProfileEditModal from '../../components/ProfileEditModal';

interface UserProfile {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  gender: string;
  birthday?: string;
  avatar?: string;
  avatar_url?: string;
  is_online: string;
  age?: number;
}

export default function UserDetail() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);

  const getCurrentUser = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) return;

      const response = await axios.get(
        `${API_CONFIG.BASE_URL}/profile/api/current-user/`,
        {
          headers: { Authorization: `Token ${token}` }
        }
      );
      setCurrentUser(response.data.username);
    } catch (error) {
      console.log('Error fetching current user:', error);
    }
  };

  const fetchUserProfile = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      const response = await axios.get(
        `${API_CONFIG.BASE_URL}/profile/api/profile/${username}/`,
        {
          headers: { Authorization: `Token ${token}` }
        }
      );

      setProfile(response.data);
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось загрузить профиль пользователя');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchUserProfile();
    setRefreshing(false);
  };

  useEffect(() => {
    if (username) {
      getCurrentUser();
      fetchUserProfile();
    }
  }, [username]);

  const handleSendMessage = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      // Get current user info to get the room ID
      const currentUserResponse = await axios.get(`${API_CONFIG.BASE_URL}/profile/api/profile/me/`, {
        headers: { Authorization: `Token ${token}` }
      });

      const currentUsername = currentUserResponse.data.username;

      // Get or create room ID for the conversation
      const roomResponse = await axios.get(
        `${API_CONFIG.BASE_URL}/chat/api/get_private_room/${currentUsername}/${username}/`,
        {
          headers: { Authorization: `Token ${token}` }
        }
      );

      const roomId = roomResponse.data.room_name;

      // Navigate to chat with room ID
      router.push(`/chat/${roomId}`);
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось открыть чат');
    }
  };

  const handleViewAlbums = () => {
    // Navigate to user's photo albums
    router.push(`/albums/${username}`);
  };

  const formatBirthday = (birthday?: string) => {
    if (!birthday) return 'Не указано';
    const date = new Date(birthday);
    return date.toLocaleDateString('ru-RU');
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Загрузка профиля...</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Профиль не найден</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Назад</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backIcon} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#007AFF" />
          </TouchableOpacity>

          <View style={styles.avatarContainer}>
            <Image
              source={
                profile.avatar_url
                  ? { uri: profile.avatar_url }
                  : profile.gender === 'male'
                  ? require('../../assets/avatar/male.png')
                  : require('../../assets/avatar/female.png')
              }
              style={styles.avatar}
            />
            <View style={[
              styles.onlineIndicator,
              { backgroundColor: profile.is_online === 'online' ? '#4CAF50' : '#9E9E9E' }
            ]} />
          </View>

          <Text style={styles.name}>
            {profile.first_name} {profile.last_name}
          </Text>
          <Text style={styles.username}>@{profile.username}</Text>
          <Text style={[
            styles.onlineStatus,
            { color: profile.is_online === 'online' ? '#4CAF50' : '#9E9E9E' }
          ]}>
            {profile.is_online === 'online' ? 'в сети' : 'не в сети'}
          </Text>
        </View>

        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <Ionicons name="mail-outline" size={20} color="#666" />
            <Text style={styles.infoText}>{profile.email}</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={20} color="#666" />
            <Text style={styles.infoText}>
              {profile.gender === 'male' ? 'Мужчина' : 'Женщина'}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={20} color="#666" />
            <Text style={styles.infoText}>
              {formatBirthday(profile.birthday)}
              {profile.age && ` (${profile.age} лет)`}
            </Text>
          </View>
        </View>

        <View style={styles.actionSection}>
          <TouchableOpacity style={styles.albumsButton} onPress={handleViewAlbums}>
            <Ionicons name="images-outline" size={20} color="#007AFF" />
            <Text style={styles.albumsButtonText}>Фотоальбомы</Text>
          </TouchableOpacity>

          {currentUser === username ? (
            <TouchableOpacity 
              style={styles.editButton} 
              onPress={() => setEditModalVisible(true)}
            >
              <Ionicons name="create-outline" size={20} color="white" />
              <Text style={styles.editButtonText}>Редактировать профиль</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.messageButton} onPress={handleSendMessage}>
              <Ionicons name="chatbubble-outline" size={20} color="white" />
              <Text style={styles.messageButtonText}>Написать сообщение</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
      
      <ProfileEditModal
        visible={editModalVisible}
        profile={profile}
        onClose={() => setEditModalVisible(false)}
        onProfileUpdated={() => {
          fetchUserProfile();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: '#666',
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
  },
  header: {
    backgroundColor: 'white',
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
    position: 'relative',
  },
  backIcon: {
    position: 'absolute',
    top: 40,
    left: 20,
    zIndex: 1,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#f0f0f0',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: 'white',
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  username: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  onlineStatus: {
    fontSize: 14,
    fontWeight: '500',
  },
  infoSection: {
    backgroundColor: 'white',
    margin: 16,
    borderRadius: 12,
    padding: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
    flex: 1,
  },
  actionSection: {
    margin: 16,
    gap: 12,
  },
  albumsButton: {
    backgroundColor: 'white',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  albumsButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  messageButton: {
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
  },
  messageButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  editButton: {
    backgroundColor: '#34C759',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
  },
  editButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
