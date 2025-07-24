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

  const getCurrentUser = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) return;

      const response = await axios.get(
        'http://localhost:8000/profile/api/current-user/',
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
        `http://localhost:8000/photo/api/album/${id}/`,
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

  const deletePhoto = async (photoId: number) => {
  console.log('🔴 deletePhoto called with photoId:', photoId);

  Alert.alert(
    'Удалить фотографию?',
    'Это действие нельзя отменить',
    [
      {
        text: 'Отмена',
        style: 'cancel',
        onPress: () => console.log('❌ Delete cancelled')
      },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          console.log('✅ User confirmed deletion, starting delete process...');
          setDeletingPhoto(true);

          try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
              console.log('❌ No token found');
              Alert.alert('Ошибка', 'Необходимо войти в систему');
              return;
            }

            console.log('🔗 Sending DELETE request to:', `http://localhost:8000/photo/api/photo/${photoId}/`);
            console.log('🔑 With token:', token.substring(0, 10) + '...');

            const response = await axios.delete(
              `http://localhost:8000/photo/api/photo/${photoId}/`,
              {
                headers: {
                  Authorization: `Token ${token}`,
                  'Content-Type': 'application/json'
                },
                timeout: 10000
              }
            );

            console.log('✅ Delete response status:', response.status);
            console.log('📝 Delete response data:', response.data);

            Alert.alert('Успех', 'Фотография удалена');
            closeModal();

            // Обновляем альбом
            console.log('🔄 Refreshing album...');
            await fetchAlbum();

          } catch (error: any) {
            console.error('❌ Error deleting photo:', error);

            if (error.response) {
              console.error('📝 Error response status:', error.response.status);
              console.error('📝 Error response data:', error.response.data);
              console.error('📝 Error response headers:', error.response.headers);

              if (error.response.status === 403) {
                Alert.alert('Ошибка', 'У вас нет прав для удаления этой фотографии');
              } else if (error.response.status === 404) {
                Alert.alert('Ошибка', 'Фотография не найдена');
              } else {
                Alert.alert('Ошибка', `Не удалось удалить фотографию (${error.response.status})`);
              }
            } else if (error.request) {
              console.error('📝 No response received:', error.request);
              Alert.alert('Ошибка', 'Сервер не отвечает');
            } else {
              console.error('📝 Request setup error:', error.message);
              Alert.alert('Ошибка', 'Ошибка при отправке запроса');
            }
          } finally {
            setDeletingPhoto(false);
          }
        }
      }
    ],
    { cancelable: false }
  );
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

      {/* Photo Modal - полностью переработанное */}
      <Modal
  visible={modalVisible}
  transparent={true}
  animationType="fade"
  onRequestClose={closeModal}
  statusBarTranslucent={true}
>
  <View style={styles.modalContainer}>
    {/* Кнопки вверху - вне TouchableOpacity */}
    <View style={styles.modalHeader}>
      <TouchableOpacity
        style={styles.modalButton}
        onPress={() => {
          console.log('🔴 Close button tapped');
          closeModal();
        }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="close" size={24} color="white" />
        <Text style={styles.buttonText}>Закрыть</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.modalButton, styles.deleteButton]}
        onPress={(e) => {
          e.stopPropagation(); // Останавливаем всплытие события
          console.log('🗑️ Delete button tapped for photo:', selectedPhoto?.id);
          if (selectedPhoto && !deletingPhoto) {
            deletePhoto(selectedPhoto.id);
          }
        }}
        disabled={deletingPhoto}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        {deletingPhoto ? (
          <ActivityIndicator size="small" color="white" />
        ) : (
          <>
            <Ionicons name="trash" size={24} color="#ff3b30" />
            <Text style={[styles.buttonText, { color: '#ff3b30' }]}>Удалить</Text>
          </>
        )}
      </TouchableOpacity>
    </View>

    {/* Фон для закрытия модального окна */}
    <TouchableOpacity
      style={styles.modalBackground}
      onPress={closeModal}
      activeOpacity={1}
    >
      {/* Контент - НЕ TouchableOpacity! */}
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
  // Новые стили для модального окна
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
  paddingTop: 60, // Увеличиваем отступ сверху
  position: 'absolute',
  top: 0,
  zIndex: 10, // Увеличиваем z-index
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
  marginTop: 40, // Добавляем отступ для кнопок
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
  elevation: 5, // Для Android
  shadowColor: '#000', // Для iOS
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.3,
  shadowRadius: 4,
},
deleteButton: {
  backgroundColor: 'rgba(255, 59, 48, 0.9)',
  borderWidth: 2,
  borderColor: '#ff3b30',
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


});