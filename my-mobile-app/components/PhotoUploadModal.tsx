import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
  FlatList,
  ScrollView,
  Dimensions
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { API_CONFIG } from '../config';
import { useTheme } from '../contexts/ThemeContext';

const { width } = Dimensions.get('window');
const imagePreviewSize = (width - 60) / 3; // 3 images per row with margins

interface PhotoUploadModalProps {
  visible: boolean;
  onClose: () => void;
  onPhotoUploaded: () => void;
  albumId?: number;
}

interface SelectedImage {
  uri: string;
  width?: number;
  height?: number;
  type?: string;
  fileName?: string;
  caption?: string;
  id: string; // уникальный ID для каждого изображения
}

export default function PhotoUploadModal({
  visible,
  onClose,
  onPhotoUploaded,
  albumId
}: PhotoUploadModalProps) {
  const { theme } = useTheme();
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});
  const [globalCaption, setGlobalCaption] = useState('');
  const [useGlobalCaption, setUseGlobalCaption] = useState(true);

  const styles = createStyles(theme);

  const requestPermissions = async () => {
    try {
      const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();

      return {
        mediaGranted: mediaPermission.status === 'granted',
        cameraGranted: cameraPermission.status === 'granted'
      };
    } catch (error) {
      console.error('Error requesting permissions:', error);
      return { mediaGranted: false, cameraGranted: false };
    }
  };

  const pickImages = async () => {
    try {
      const permissions = await requestPermissions();
      if (!permissions.mediaGranted) {
        Alert.alert('Ошибка', 'Необходимо разрешение для доступа к галерее');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: 10, // максимум 10 фотографий за раз
      });

      if (!result.canceled && result.assets) {
        const newImages: SelectedImage[] = result.assets.map((asset, index) => ({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          type: asset.type,
          fileName: asset.fileName,
          caption: '',
          id: `${Date.now()}_${index}`, // уникальный ID
        }));

        setSelectedImages(prev => [...prev, ...newImages]);
        console.log('Selected images:', newImages.length);
      }
    } catch (error) {
      console.error('Error picking images:', error);
      Alert.alert('Ошибка', 'Не удалось выбрать изображения');
    }
  };

  const takePhoto = async () => {
    try {
      const permissions = await requestPermissions();
      if (!permissions.cameraGranted) {
        Alert.alert('Ошибка', 'Необходимо разрешение для доступа к камере');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const newImage: SelectedImage = {
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          type: asset.type,
          fileName: asset.fileName,
          caption: '',
          id: `camera_${Date.now()}`,
        };

        setSelectedImages(prev => [...prev, newImage]);
        console.log('Captured photo:', newImage);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Ошибка', 'Не удалось сделать фото');
    }
  };

  const removeImage = (imageId: string) => {
    setSelectedImages(prev => prev.filter(img => img.id !== imageId));
    // Удаляем прогресс для этого изображения
    setUploadProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[imageId];
      return newProgress;
    });
  };

  const updateImageCaption = (imageId: string, caption: string) => {
    setSelectedImages(prev =>
      prev.map(img => img.id === imageId ? { ...img, caption } : img)
    );
  };

  const handleUpload = async () => {
    if (selectedImages.length === 0 || !albumId) return;

    setUploading(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        Alert.alert('Ошибка', 'Необходимо войти в систему');
        return;
      }

      // Загружаем все изображения параллельно
      const uploadPromises = selectedImages.map(async (image) => {
        try {
          const formData = new FormData();

          // Обработка изображения в зависимости от платформы
          if (Platform.OS === 'web') {
            const response = await fetch(image.uri);
            const blob = await response.blob();
            const mimeType = blob.type || 'image/jpeg';
            const extension = mimeType.split('/')[1] || 'jpg';
            const fileName = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
            const file = new File([blob], fileName, { type: mimeType });
            formData.append('image', file);
          } else {
            const uri = image.uri;
            const fileType = uri.split('.').pop()?.toLowerCase() || 'jpg';
            const fileName = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileType}`;

            let mimeType = 'image/jpeg';
            switch (fileType) {
              case 'png': mimeType = 'image/png'; break;
              case 'gif': mimeType = 'image/gif'; break;
              case 'jpg':
              case 'jpeg': mimeType = 'image/jpeg'; break;
            }

            formData.append('image', {
              uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
              type: mimeType,
              name: fileName,
            } as any);
          }

          // Определяем подпись для изображения
          let caption = '';
          if (useGlobalCaption && globalCaption.trim()) {
            caption = globalCaption.trim();
          } else if (!useGlobalCaption && image.caption?.trim()) {
            caption = image.caption.trim();
          }

          if (caption) {
            formData.append('caption', caption);
          }

          const response = await axios({
            method: 'POST',
            url: `${API_CONFIG.BASE_URL}/photo/api/album/${albumId}/photos/create/`,
            data: formData,
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'multipart/form-data',
              'Accept': 'application/json',
            },
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const progress = (progressEvent.loaded * 100) / progressEvent.total;
                setUploadProgress(prev => ({
                  ...prev,
                  [image.id]: progress
                }));
              }
            },
          });

          console.log(`Upload successful for image ${image.id}:`, response.data);
          successCount++;

          // Помечаем как завершенную
          setUploadProgress(prev => ({
            ...prev,
            [image.id]: 100
          }));

        } catch (error: any) {
          console.error(`Upload error for image ${image.id}:`, error.response?.data || error.message);
          errorCount++;

          // Помечаем как ошибку
          setUploadProgress(prev => ({
            ...prev,
            [image.id]: -1 // -1 означает ошибку
          }));
        }
      });

      // Ждем завершения всех загрузок
      await Promise.all(uploadPromises);

      // Показываем результат
      if (successCount > 0 && errorCount === 0) {
        Alert.alert('Успех', `Успешно загружено ${successCount} фотографий`);
      } else if (successCount > 0 && errorCount > 0) {
        Alert.alert('Частично завершено', `Загружено: ${successCount}, ошибок: ${errorCount}`);
      } else {
        Alert.alert('Ошибка', 'Не удалось загрузить ни одной фотографии');
      }

      if (successCount > 0) {
        // Очищаем состояние и закрываем модал
        setSelectedImages([]);
        setGlobalCaption('');
        setUploadProgress({});
        onPhotoUploaded();
        onClose();
      }

    } catch (error) {
      Alert.alert('Ошибка', 'Произошла неожиданная ошибка при загрузке');
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setSelectedImages([]);
      setGlobalCaption('');
      setUploadProgress({});
      onClose();
    }
  };

  const renderImage = ({ item }: { item: SelectedImage }) => {
    const progress = uploadProgress[item.id] || 0;
    const hasError = progress === -1;
    const isCompleted = progress === 100 && !hasError;

    return (
      <View style={styles.imagePreview}>
        <Image source={{ uri: item.uri }} style={styles.previewImage} />

        {/* Прогресс или статус */}
        {uploading && (
          <View style={styles.progressOverlay}>
            {hasError ? (
              <View style={styles.errorIndicator}>
                <Ionicons name="close-circle" size={24} color="#ff3b30" />
              </View>
            ) : isCompleted ? (
              <View style={styles.successIndicator}>
                <Ionicons name="checkmark-circle" size={24} color="#34C759" />
              </View>
            ) : (
              <View style={styles.progressContainer}>
                <ActivityIndicator size="small" color="white" />
                <Text style={styles.progressText}>{Math.round(progress)}%</Text>
              </View>
            )}
          </View>
        )}

        {/* Кнопка удаления */}
        {!uploading && (
          <TouchableOpacity
            style={styles.removeButton}
            onPress={() => removeImage(item.id)}
          >
            <Ionicons name="close-circle" size={20} color="white" />
          </TouchableOpacity>
        )}

        {/* Индивидуальная подпись (если не используем глобальную) */}
        {!useGlobalCaption && (
          <View style={styles.captionContainer}>
            <TextInput
              style={styles.imageCaptionInput}
              value={item.caption}
              onChangeText={(text) => updateImageCaption(item.id, text)}
              placeholder="Подпись..."
              placeholderTextColor={theme.textSecondary}
              maxLength={500}
              multiline
              editable={!uploading}
            />
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          {/* Заголовок */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              Загрузка фотографий {selectedImages.length > 0 && `(${selectedImages.length})`}
            </Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton} disabled={uploading}>
              <Ionicons name="close" size={24} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Кнопки выбора */}
            {!uploading && (
              <View style={styles.actionButtons}>
                <TouchableOpacity style={styles.actionButton} onPress={pickImages}>
                  <Ionicons name="images" size={20} color={theme.primary} />
                  <Text style={styles.actionButtonText}>Выбрать из галереи</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionButton} onPress={takePhoto}>
                  <Ionicons name="camera" size={20} color={theme.primary} />
                  <Text style={styles.actionButtonText}>Сделать фото</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Превью выбранных изображений */}
            {selectedImages.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Выбранные фотографии:</Text>
                <FlatList
                  data={selectedImages}
                  renderItem={renderImage}
                  keyExtractor={(item) => item.id}
                  numColumns={3}
                  scrollEnabled={false}
                  contentContainerStyle={styles.imagesGrid}
                />
              </>
            )}

            {/* Настройки подписей */}
            {selectedImages.length > 0 && !uploading && (
              <View style={styles.captionSection}>
                <View style={styles.switchContainer}>
                  <Text style={styles.switchLabel}>Общая подпись для всех фото</Text>
                  <TouchableOpacity
                    style={[styles.switch, useGlobalCaption && styles.switchActive]}
                    onPress={() => setUseGlobalCaption(!useGlobalCaption)}
                  >
                    <View style={[styles.switchThumb, useGlobalCaption && styles.switchThumbActive]} />
                  </TouchableOpacity>
                </View>

                {useGlobalCaption && (
                  <TextInput
                    style={styles.globalCaptionInput}
                    value={globalCaption}
                    onChangeText={setGlobalCaption}
                    placeholder="Введите общую подпись для всех фотографий..."
                    placeholderTextColor={theme.textSecondary}
                    maxLength={500}
                    multiline
                  />
                )}

                {!useGlobalCaption && (
                  <Text style={styles.captionHint}>
                    Вы можете добавить индивидуальную подпись к каждой фотографии
                  </Text>
                )}
              </View>
            )}
          </ScrollView>

          {/* Кнопка загрузки */}
          {selectedImages.length > 0 && (
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.uploadButton, uploading && styles.uploadButtonDisabled]}
                onPress={handleUpload}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <ActivityIndicator color="white" size="small" />
                    <Text style={styles.uploadButtonText}>Загрузка...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="cloud-upload" size={20} color="white" />
                    <Text style={styles.uploadButtonText}>
                      Загрузить {selectedImages.length} {selectedImages.length === 1 ? 'фото' : 'фотографий'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    elevation: 8,
    shadowColor: theme.text,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.primary + '15',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.primary + '30',
  },
  actionButtonText: {
    color: theme.primary,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.text,
    marginBottom: 12,
  },
  imagesGrid: {
    gap: 8,
  },
  imagePreview: {
    width: imagePreviewSize,
    height: imagePreviewSize,
    margin: 4,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: theme.border,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressContainer: {
    alignItems: 'center',
    gap: 4,
  },
  progressText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  errorIndicator: {
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    borderRadius: 12,
    padding: 8,
  },
  successIndicator: {
    backgroundColor: 'rgba(52, 199, 89, 0.9)',
    borderRadius: 12,
    padding: 8,
  },
  captionContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 4,
  },
  imageCaptionInput: {
    color: 'white',
    fontSize: 10,
    textAlign: 'center',
    minHeight: 14,
  },
  captionSection: {
    marginTop: 20,
    gap: 16,
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.text,
    flex: 1,
  },
  switch: {
    width: 50,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.border,
    justifyContent: 'center',
    padding: 2,
  },
  switchActive: {
    backgroundColor: theme.primary,
  },
  switchThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'white',
  },
  switchThumbActive: {
    alignSelf: 'flex-end',
  },
  globalCaptionInput: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    backgroundColor: theme.background,
    color: theme.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  captionHint: {
    fontSize: 14,
    color: theme.textSecondary,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  uploadButton: {
    backgroundColor: theme.primary,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    elevation: 3,
    shadowColor: theme.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  uploadButtonDisabled: {
    backgroundColor: theme.textSecondary,
    opacity: 0.6,
  },
  uploadButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});