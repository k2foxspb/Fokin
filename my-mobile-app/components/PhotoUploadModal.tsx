import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  FlatList,
  ScrollView,
  Dimensions,
  Linking
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { API_CONFIG } from '../config';
import { useTheme } from '../contexts/ThemeContext';
import CachedImage from "./CachedImage";
import {opacity} from "react-native-reanimated/src/Colors";

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

  // Функция handlePermissionOnAndroid удалена, так как больше не используется

  const pickImages = async () => {
    try {
        // Самый простой вариант с минимумом параметров
        console.log('Starting image picker with minimal configuration...');
        let pickerResult = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
        });

        console.log('Picker result:', pickerResult.canceled ? 'canceled' : 'not canceled');

        if (!pickerResult.canceled) {
            console.log('Assets:', pickerResult.assets ? `found ${pickerResult.assets.length} assets` : 'no assets');

            if (pickerResult.assets && pickerResult.assets.length > 0) {
                Alert.alert('Выбрано', `Выбрано ${pickerResult.assets.length} изображений`);

                const newImages: SelectedImage[] = pickerResult.assets.map((asset, i) => {
                    // Упрощенный подход для создания объектов изображений
                    return {
                        uri: asset.uri,
                        width: 100,
                        height: 100,
                        type: 'image/jpeg',
                        fileName: `simple_${i}.jpg`,
                        caption: '',
                        id: `simple_${Date.now()}_${i}`,
                    };
                });

                console.log(`Created ${newImages.length} image objects`);
                setSelectedImages(prev => [...prev, ...newImages]);
            } else {
                Alert.alert('Внимание', 'Не удалось получить выбранные изображения');
            }
        } else {
            console.log('User cancelled image picker');
        }
    } catch (error) {
        console.error('Error picking images:', error);
        Alert.alert('Ошибка', 'Не удалось выбрать изображения. Попробуйте еще раз.');
    }
  };

  const takePhoto = async () => {
    try {
        // Проверяем специфичные для Android настройки
        if (Platform.OS === 'android') {
            const androidPermissionOk = await handlePermissionOnAndroid();
            if (!androidPermissionOk) return;
        }

        // Запрашиваем разрешение для камеры
        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        console.log('Camera permission result:', cameraPermission);

        if (cameraPermission.status !== 'granted') {
            Alert.alert('Ошибка', 'Необходимо разрешение для доступа к камере');
            return;
        }

        console.log('Launching camera...');
        const result = await ImagePicker.launchCameraAsync({
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.7,
            mediaTypes: ImagePicker.MediaTypeOptions.Images
        });

        console.log('Camera result:', {
            canceled: result.canceled,
            hasAssets: result.assets ? result.assets.length > 0 : false
        });

        if (!result.canceled && result.assets && result.assets[0]) {
            const asset = result.assets[0];
            console.log('Photo captured:', {
                uri: asset.uri.substring(0, 50) + '...',
                width: asset.width,
                height: asset.height
            });

            const newImage: SelectedImage = {
                uri: asset.uri,
                width: asset.width || 200,
                height: asset.height || 200,
                type: 'image/jpeg',
                fileName: `camera_${Date.now()}.jpg`,
                caption: '',
                id: `camera_${Date.now()}`,
            };

            setSelectedImages(prev => [...prev, newImage]);
            console.log('Camera photo added to state');
        } else {
            console.log('Camera canceled or failed');
        }
    } catch (error) {
        console.error('Error taking photo:', error);
        Alert.alert('Ошибка камеры', 'Не удалось сделать фото. Проверьте разрешения.');
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

          successCount++;

          // Помечаем как завершенную
          setUploadProgress(prev => ({
            ...prev,
            [image.id]: 100
          }));

        } catch (error: any) {
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

          // Проверяем доступность разрешений при открытии модального окна
          const checkPermissions = async () => {
            try {
              const mediaLibrary = await ImagePicker.getMediaLibraryPermissionsAsync();
              const camera = await ImagePicker.getCameraPermissionsAsync();

              console.log('Current permissions status:', {
                mediaLibrary: mediaLibrary.status,
                camera: camera.status
              });
            } catch (error) {
              console.error('Error checking permissions:', error);
            }
          };

          checkPermissions();
      onClose();
    }
  };

  const renderImage = ({ item }: { item: SelectedImage }) => {
    const progress = uploadProgress[item.id] || 0;
    const hasError = progress === -1;
    const isCompleted = progress === 100 && !hasError;

    return (
      <View style={styles.imagePreview}>
        <CachedImage 
          uri={item.uri} 
          style={styles.previewImage}
          showLoader={false}
        />

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
      transparent={false}
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          {/* Тестовая кнопка удалена */}

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
              <View>
                <View style={styles.actionButtons}>
                  <TouchableOpacity 
                    style={[styles.actionButton, { backgroundColor: theme.primary }]} 
                    onPress={async () => {
                      try {
                        console.log("Открытие галереи для выбора фотографий...");

                        // Добавляем поддержку выбора нескольких фотографий
                        const result = await ImagePicker.launchImageLibraryAsync({
                          allowsMultipleSelection: true,
                          selectionLimit: 10, // Максимум 10 фотографий за раз
                          mediaTypes: ImagePicker.MediaTypeOptions.Images,
                          quality: 0.8
                        });

                        console.log("Результат выбора:", 
                          result.canceled ? "отменено" : `выбрано ${result.assets?.length || 0} фото`);

                        if (!result.canceled && result.assets && result.assets.length > 0) {
                          const newImages = result.assets.map((asset, index) => ({
                            uri: asset.uri,
                            width: asset.width || 100,
                            height: asset.height || 100,
                            type: "image/jpeg",
                            fileName: `gallery_${index}.jpg`,
                            caption: '',
                            id: `gallery_${Date.now()}_${index}`,
                          }));

                          setSelectedImages(prev => [...prev, ...newImages]);
                          Alert.alert("Успех", `Выбрано ${newImages.length} фотографий`);
                        }
                      } catch (error) {
                        console.error("Ошибка при выборе фотографий:", error);
                        Alert.alert("Ошибка", "Не удалось выбрать фотографии");
                      }
                    }}
                  >
                    <Ionicons name="images" size={36} color="white" />
                    <Text style={[styles.actionButtonText, { color: "white" }]}>Выбрать из галереи</Text>
                    <Text style={[styles.actionButtonSubtext, { color: "rgba(255, 255, 255, 0.8)" }]}>
                      Можно выбрать несколько
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.actionButton, { backgroundColor: '#34C759' }]}
                    onPress={async () => {
                      try {
                        console.log("Запуск камеры...");

                        // Запрашиваем разрешение на камеру, это обязательно
                        const { status } = await ImagePicker.requestCameraPermissionsAsync();

                        if (status !== 'granted') {
                          Alert.alert("Ошибка", "Необходимо разрешение для доступа к камере");
                          return;
                        }

                        const result = await ImagePicker.launchCameraAsync({
                          quality: 0.8,
                          allowsEditing: true,
                          aspect: [4, 3]
                        });

                        console.log("Результат съемки:", 
                          result.canceled ? "отменено" : "фото сделано");

                        if (!result.canceled && result.assets && result.assets[0]) {
                          const asset = result.assets[0];
                          const newImage = {
                            uri: asset.uri,
                            width: asset.width || 100,
                            height: asset.height || 100,
                            type: "image/jpeg",
                            fileName: `camera_${Date.now()}.jpg`,
                            caption: '',
                            id: `camera_${Date.now()}`,
                          };

                          setSelectedImages(prev => [...prev, newImage]);
                          Alert.alert("Успех", "Фото сделано");
                        }
                      } catch (error) {
                        console.error("Ошибка при съемке фото:", error);
                        Alert.alert("Ошибка", "Не удалось сделать фото");
                      }
                    }}
                  >
                    <Ionicons name="camera" size={36} color="white" />
                    <Text style={[styles.actionButtonText, { color: "white" }]}>
                      Сделать фото
                    </Text>
                    <Text style={[styles.actionButtonSubtext, { color: "rgba(255, 255, 255, 0.8)" }]}>
                      С помощью камеры
                    </Text>
                  </TouchableOpacity>
                </View>
                            </View>
            )}

            {/* Превью выбранных изображений */}
            {selectedImages.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>
                  Выбранные фотографии: {selectedImages.length}
                </Text>

                <FlatList
                  data={selectedImages}
                  renderItem={renderImage}
                  keyExtractor={(item) => item.id}
                  numColumns={3}
                  scrollEnabled={false}
                  contentContainerStyle={styles.imagesGrid}
                />

                <View style={{marginTop: 10, padding: 10, backgroundColor: theme.background, borderRadius: 8, borderWidth: 1, borderColor: theme.border}}>
                  <Text style={{fontSize: 12, color: theme.text}}>
                    Выбрано {selectedImages.length} фото
                  </Text>
                  {selectedImages.length > 0 && selectedImages[0].uri && (
                    <Text style={{fontSize: 10, color: theme.textSecondary, marginTop: 5}}>
                      URI: {selectedImages[0].uri.substring(0, 40)}...
                    </Text>
                  )}
                </View>
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
    backgroundColor: theme.background,
  },
  modalContent: {
    flex: 1,
    backgroundColor: theme.surface,
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
    paddingTop: 50, // Учитываем статус-бар на iOS
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.text,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    gap: 15,
    marginBottom: 30,
    marginTop: 20,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    borderRadius: 20,
    borderWidth: 0,
    elevation: 4,
    shadowColor: theme.text,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 10,
    textAlign: 'center',
  },
  actionButtonSubtext: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
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
    backgroundColor: theme.error || 'rgba(255, 59, 48, 0.9)',
    borderRadius: 12,
    padding: 8,
  },
  successIndicator: {
    backgroundColor: theme.success || 'rgba(52, 199, 89, 0.9)',
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
    backgroundColor: theme.background,
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
    color: theme.buttonText || 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});