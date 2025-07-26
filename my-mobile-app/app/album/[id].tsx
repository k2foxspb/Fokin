
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
import PhotoUploadModal from '../../components/PhotoUploadModal';
import AlbumEditModal from '../../components/AlbumEditModal';
import { API_CONFIG } from '../../config';

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
  user?: {
    username: string;
  };
}

// Кастомное модальное окно подтверждения удаления
const DeleteConfirmModal = ({
  visible,
  onCancel,
  onConfirm,
  loading
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}) => (
  <Modal
    visible={visible}
    transparent={true}
    animationType="fade"
    onRequestClose={onCancel}
  >
    <View style={styles.deleteModalContainer}>
      <View style={styles.deleteModalContent}>
        <Ionicons name="warning" size={48} color="#ff3b30" style={styles.deleteModalIcon} />
        <Text style={styles.deleteModalTitle}>Удалить фотографию?</Text>
        <Text style={styles.deleteModalMessage}>Это действие нельзя отменить</Text>

        <View style={styles.deleteModalButtons}>
          <TouchableOpacity
            style={[styles.deleteModalButton, styles.cancelButton]}
            onPress={onCancel}
            disabled={loading}
          >
            <Text style={styles.cancelButtonText}>Отмена</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.deleteModalButton, styles.confirmButton]}
            onPress={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text style={styles.confirmButtonText}>Удалить</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

export default function AlbumDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);

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
      console.log('Current user:', response.data.username);
      setCurrentUser(response.data.username);
    } catch (error) {
      console.log('Error fetching current user:', error);
    }
  };

  const fetchAlbum = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      console.log('Fetching album with ID:', id);
      const response = await axios.get(
        `${API_CONFIG.BASE_URL}/photo/api/album/${id}/`,
        {
          headers: { Authorization: `Token ${token}` }
        }
      );

      console.log('Full Album response:', JSON.stringify(response.data, null, 2));

      // Фильтруем фотографии, убираем те, у которых нет image_url
      const filteredPhotos = response.data.photos.filter((photo: Photo) =>
        photo.image_url && photo.thumbnail_url
      );

      console.log('Filtered photos:', filteredPhotos.length, 'from', response.data.photos.length);

      setAlbum({
        ...response.data,
        photos: filteredPhotos
      });
    } catch (error) {
      console.error('Error fetching album:', error);
      Alert.alert('Ошибка', 'Не удалось загрузить альбом');
      router.back();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const deletePhoto = async () => {
    if (!selectedPhoto) return;

    console.log('🔴 Starting delete process for photo:', selectedPhoto.id);
    setDeletingPhoto(true);

    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        console.log('❌ No token found');
        Alert.alert('Ошибка', 'Необходимо войти в систему');
        return;
      }

      console.log('🔗 Sending DELETE request to:', `${API_CONFIG.BASE_URL}photo/${selectedPhoto.id}/`);

      const response = await axios.delete(
        `${API_CONFIG.BASE_URL}/photo/api/photo/${selectedPhoto.id}/`,
        {
          headers: {
            Authorization: `Token ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 15000
        }
      );

      console.log('✅ Delete response status:', response.status);
      Alert.alert('Успех', 'Фотография удалена');

      // Закрываем все модальные окна
      setDeleteConfirmVisible(false);
      closeModal();

      // Обновляем альбом
      await fetchAlbum();

    } catch (error: any) {
      console.error('❌ Error deleting photo:', error);

      let errorMessage = 'Не удалось удалить фотографию';

      if (error.response) {
        switch (error.response.status) {
          case 403:
            errorMessage = 'У вас нет прав для удаления этой фотографии';
            break;
          case 404:
            errorMessage = 'Фотография не найдена';
            await fetchAlbum();
            break;
          case 500:
            errorMessage = 'Внутренняя ошибка сервера';
            break;
          default:
            errorMessage = `Ошибка сервера (${error.response.status})`;
        }
      } else if (error.request) {
        errorMessage = 'Сервер не отвечает. Проверьте подключение к интернету';
      } else {
        errorMessage = `Ошибка: ${error.message}`;
      }

      Alert.alert('Ошибка', errorMessage);
    } finally {
      setDeletingPhoto(false);
    }
  };

  const handleDeletePress = () => {
    console.log('🗑️ Delete button pressed');
    setDeleteConfirmVisible(true);
  };

  const handleDeleteConfirm = () => {
    console.log('✅ Delete confirmed');
    deletePhoto();
  };

  const handleDeleteCancel = () => {
    console.log('❌ Delete cancelled');
    setDeleteConfirmVisible(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAlbum();
  };

  useEffect(() => {
    if (id) {
      console.log('Album ID from params:', id, typeof id);
      getCurrentUser();
      fetchAlbum();
    }
  }, [id]);

  const handlePhotoPress = (photo: Photo) => {
    console.log('Photo pressed:', photo.id);
    setSelectedPhoto(photo);
    setModalVisible(true);
  };

  const closeModal = () => {
    console.log('Closing modal');
    setModalVisible(false);
    setSelectedPhoto(null);
    setDeleteConfirmVisible(false);
  };

  const handleAlbumUpdated = () => {
    fetchAlbum();
  };

  const handleAlbumDeleted = () => {
    router.back();
  };

  const isOwner = currentUser && album && (
    currentUser === album.user?.username ||
    currentUser === (album as any).owner?.username ||
    currentUser === (album as any).creator?.username
  );

  console.log('Owner check:', {
    currentUser,
    albumUser: album?.user?.username,
    isOwner
  });

  const renderPhoto = ({ item, index }: { item: Photo; index: number }) => {
    console.log(`Rendering photo ${index}:`, item.id, item.thumbnail_url);
    return (
      <TouchableOpacity
        style={styles.photoItem}
        onPress={() => {
          console.log(`Photo ${item.id} pressed`);
          handlePhotoPress(item);
        }}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: item.thumbnail_url }}
          style={styles.photoImage}
          resizeMode="cover"
          onError={(error) => console.log('Image load error:', error)}
        />
      </TouchableOpacity>
    );
  };

  const albumId = id ? parseInt(id.toString(), 10) : undefined;
  console.log('Parsed albumId:', albumId);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Загрузка альбома...</Text>
      </View>
    );
  }

  if (!album || !albumId) {
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
            {album.photos.length} {album.photos.length === 1 ? 'фото' : 'фотографий'}
            {album.hidden_flag && ' • Скрытый'}
          </Text>
        </View>

        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setEditModalVisible(true)}
          >
            <Ionicons name="create-outline" size={24} color="#007AFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setUploadModalVisible(true)}
          >
            <Ionicons name="camera" size={24} color="#007AFF" />
          </TouchableOpacity>
        </View>
      </View>

      {album.photos.length === 0 ? (
        <View style={styles.emptyPhotosContainer}>
          <Ionicons name="images-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>В альбоме пока нет фотографий</Text>
          <TouchableOpacity
            style={styles.uploadFirstButton}
            onPress={() => setUploadModalVisible(true)}
          >
            <Text style={styles.uploadFirstButtonText}>Загрузить первое фото</Text>
          </TouchableOpacity>
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
          extraData={album.photos}
        />
      )}

      {/* Photo Modal - исправленная версия */}
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeModal}
        statusBarTranslucent={true}
      >
        <View style={styles.modalContainer}>
          {/* Кнопки вверху */}
          <View style={styles.modalHeader}>
            {/* Кнопка удаления слева - показываем только владельцу */}
            {isOwner && selectedPhoto && (
              <TouchableOpacity
                style={[styles.modalButton, styles.deleteButton]}
                onPress={handleDeletePress}
                disabled={deletingPhoto}
                activeOpacity={0.7}
              >
                <Ionicons name="trash" size={24} color="#ff3b30" />
                <Text style={[styles.buttonText, { color: '#ffffff' }]}>Удалить</Text>
              </TouchableOpacity>
            )}

            {/* Кнопка закрытия справа */}
            <TouchableOpacity
              style={[
                styles.modalButton,
                !isOwner && styles.modalButtonCentered
              ]}
              onPress={closeModal}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={24} color="white" />
              <Text style={styles.buttonText}>Закрыть</Text>
            </TouchableOpacity>
          </View>

          {/* Фон для закрытия модального окна */}
          <TouchableOpacity
            style={styles.modalBackground}
            onPress={closeModal}
            activeOpacity={1}
          >
            {/* Контент */}
            <View style={styles.modalContent}>
              {/* Изображение */}
              <View style={styles.imageContainer}>
                {selectedPhoto && (
                  <Image
                    source={{ uri: selectedPhoto.image_url }}
                    style={styles.fullImage}
                    resizeMode="contain"
                  />
                )}
              </View>

              {/* Информация */}
              {selectedPhoto?.caption && (
                <Text style={styles.caption}>{selectedPhoto.caption}</Text>
              )}

              {selectedPhoto && (
                <Text style={styles.photoDate}>
                  {new Date(selectedPhoto.uploaded_at).toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Кастомное модальное окно подтверждения удаления */}
      <DeleteConfirmModal
        visible={deleteConfirmVisible}
        onCancel={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        loading={deletingPhoto}
      />

      <PhotoUploadModal
        visible={uploadModalVisible}
        onClose={() => setUploadModalVisible(false)}
        onPhotoUploaded={() => {
          setUploadModalVisible(false);
          fetchAlbum();
        }}
        albumId={albumId}
      />

      <AlbumEditModal
        visible={editModalVisible}
        album={album}
        onClose={() => setEditModalVisible(false)}
        onAlbumUpdated={handleAlbumUpdated}
        onAlbumDeleted={handleAlbumDeleted}
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
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    marginLeft: 12,
    padding: 4,
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
  uploadFirstButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  uploadFirstButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
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
  // Стили для модального окна просмотра фото
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 15,
    paddingTop: 60,
    position: 'absolute',
    top: 0,
    zIndex: 10,
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    height: '70%',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 40,
  },
  modalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    minWidth: 120,
    justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  modalButtonCentered: {
    marginLeft: 'auto',
  },
  deleteButton: {

    borderWidth: 2,

  },
  buttonText: {
    color: 'white',
    marginLeft: 8,
    fontSize: 15,
    fontWeight: '600',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  fullImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  caption: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 20,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingVertical: 10,
    borderRadius: 8,
  },
  photoDate: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  // Стили для модального окна подтверждения удаления
  deleteModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  deleteModalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
  deleteModalIcon: {
    marginBottom: 16,
  },
  deleteModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  deleteModalMessage: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  deleteModalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  deleteModalButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  cancelButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#ff3b30',
  },
  confirmButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});