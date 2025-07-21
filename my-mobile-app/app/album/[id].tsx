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
  Dimensions,
  Modal
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');
const photoSize = (width - 48) / 3; // 3 columns with margins

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
  photos: Photo[];
  photos_count: number;
}

export default function AlbumDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const fetchAlbum = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      const response = await axios.get(
        `http://localhost:8000/photo/api/album/${id}/`,
        {
          headers: { Authorization: `Token ${token}` }
        }
      );

      setAlbum(response.data);
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось загрузить альбом');
      router.back();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAlbum();
  };

  useEffect(() => {
    if (id) {
      fetchAlbum();
    }
  }, [id]);

  const handlePhotoPress = (photo: Photo) => {
    setSelectedPhoto(photo);
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setSelectedPhoto(null);
  };

  const renderPhoto = ({ item }: { item: Photo }) => (
    <TouchableOpacity
      style={styles.photoItem}
      onPress={() => handlePhotoPress(item)}
    >
      <Image
        source={{ uri: item.thumbnail_url }}
        style={styles.photoImage}
        resizeMode="cover"
      />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Загрузка альбома...</Text>
      </View>
    );
  }

  if (!album) {
    return (
      <View style={styles.emptyContainer}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#007AFF" />
        </TouchableOpacity>
        
        <Ionicons name="alert-circle-outline" size={64} color="#ccc" />
        <Text style={styles.emptyText}>Альбом не найден</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#007AFF" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{album.title}</Text>
          <Text style={styles.headerSubtitle}>
            {album.photos_count} {album.photos_count === 1 ? 'фото' : 'фотографий'}
            {album.hidden_flag && ' • Скрытый'}
          </Text>
        </View>
      </View>

      {album.photos.length === 0 ? (
        <View style={styles.emptyPhotosContainer}>
          <Ionicons name="images-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>В альбоме пока нет фотографий</Text>
          <TouchableOpacity style={styles.refreshButton} onPress={fetchAlbum}>
            <Text style={styles.refreshButtonText}>Обновить</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={album.photos}
          renderItem={renderPhoto}
          keyExtractor={(item) => item.id.toString()}
          numColumns={3}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContainer}
        />
      )}

      {/* Photo Modal */}
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.modalContainer}>
          <TouchableOpacity style={styles.modalOverlay} onPress={closeModal} />
          
          <View style={styles.modalContent}>
            <TouchableOpacity style={styles.closeButton} onPress={closeModal}>
              <Ionicons name="close" size={24} color="white" />
            </TouchableOpacity>
            
            {selectedPhoto && (
              <>
                <Image
                  source={{ uri: selectedPhoto.image_url }}
                  style={styles.modalImage}
                  resizeMode="contain"
                />
                
                {selectedPhoto.caption && (
                  <View style={styles.captionContainer}>
                    <Text style={styles.captionText}>{selectedPhoto.caption}</Text>
                  </View>
                )}
                
                <View style={styles.photoInfo}>
                  <Text style={styles.photoDate}>
                    {new Date(selectedPhoto.uploaded_at).toLocaleDateString('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
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
  emptyPhotosContainer: {
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
  photoItem: {
    width: photoSize,
    height: photoSize,
    margin: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContent: {
    width: width * 0.9,
    maxHeight: height * 0.8,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: -50,
    right: 0,
    zIndex: 1,
    padding: 10,
  },
  modalImage: {
    width: '100%',
    height: height * 0.6,
    borderRadius: 8,
  },
  captionContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    width: '100%',
  },
  captionText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
  },
  photoInfo: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  photoDate: {
    color: 'white',
    fontSize: 12,
    textAlign: 'center',
  },
});