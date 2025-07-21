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
  Alert,
  Dimensions
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');
const albumWidth = (width - 48) / 2; // 2 columns with margins

interface Photo {
  id: number;
  image_url: string;
  thumbnail_url: string;
  caption: string;
  uploaded_at: string;
}

interface Album {
  id: number;
  title: string;
  hidden_flag: boolean;
  created_at: string;
  photos_count: number;
  cover_photo: Photo | null;
}

export default function UserAlbums() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAlbums = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      const response = await axios.get(
        `http://localhost:8000/photo/api/user/${username}/albums/`,
        {
          headers: { Authorization: `Token ${token}` }
        }
      );

      setAlbums(response.data);
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось загрузить альбомы');
      router.back();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAlbums();
  };

  useEffect(() => {
    if (username) {
      fetchAlbums();
    }
  }, [username]);

  const handleAlbumPress = (albumId: number) => {
    router.push(`/album/${albumId}`);
  };

  const renderAlbum = ({ item }: { item: Album }) => (
    <TouchableOpacity
      style={styles.albumItem}
      onPress={() => handleAlbumPress(item.id)}
    >
      <View style={styles.albumCover}>
        {item.cover_photo ? (
          <Image
            source={{ uri: item.cover_photo.thumbnail_url }}
            style={styles.coverImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.emptyCover}>
            <Ionicons name="images-outline" size={40} color="#ccc" />
          </View>
        )}
        
        {item.hidden_flag && (
          <View style={styles.hiddenBadge}>
            <Ionicons name="eye-off" size={16} color="white" />
          </View>
        )}
        
        <View style={styles.photoCount}>
          <Text style={styles.photoCountText}>{item.photos_count}</Text>
        </View>
      </View>
      
      <View style={styles.albumInfo}>
        <Text style={styles.albumTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.albumDate}>
          {new Date(item.created_at).toLocaleDateString('ru-RU')}
        </Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Загрузка альбомов...</Text>
      </View>
    );
  }

  if (albums.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#007AFF" />
        </TouchableOpacity>
        
        <Ionicons name="images-outline" size={64} color="#ccc" />
        <Text style={styles.emptyText}>У пользователя нет альбомов</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={fetchAlbums}>
          <Text style={styles.refreshButtonText}>Обновить</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#007AFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Альбомы @{username}</Text>
      </View>
      
      <FlatList
        data={albums}
        renderItem={renderAlbum}
        keyExtractor={(item) => item.id.toString()}
        numColumns={2}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContainer}
        columnWrapperStyle={styles.row}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 50,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    color: '#666',
    marginTop: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  refreshButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  listContainer: {
    padding: 16,
  },
  row: {
    justifyContent: 'space-between',
  },
  albumItem: {
    width: albumWidth,
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  albumCover: {
    position: 'relative',
    height: albumWidth,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    overflow: 'hidden',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  emptyCover: {
    width: '100%',
    height: '100%',
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hiddenBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 12,
    padding: 4,
  },
  photoCount: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  photoCountText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  albumInfo: {
    padding: 12,
  },
  albumTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  albumDate: {
    fontSize: 12,
    color: '#666',
  },
});