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
  Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { API_CONFIG } from '../config';

interface PhotoUploadModalProps {
  visible: boolean;
  onClose: () => void;
  onPhotoUploaded: () => void;
  albumId?: number;
}

export default function PhotoUploadModal({
  visible,
  onClose,
  onPhotoUploaded,
  albumId
}: PhotoUploadModalProps) {
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

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

  const pickImage = async () => {
    try {
      const permissions = await requestPermissions();
      if (!permissions.mediaGranted) {
        Alert.alert('Ошибка', 'Необходимо разрешение для доступа к галерее');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        console.log('Selected image:', {
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
        });
        setSelectedImage(asset);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Ошибка', 'Не удалось выбрать изображение');
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
        console.log('Captured photo:', {
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
        });
        setSelectedImage(asset);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Ошибка', 'Не удалось сделать фото');
    }
  };


const handleUpload = async () => {
    if (!selectedImage || !albumId) return;

    setUploading(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        Alert.alert('Ошибка', 'Необходимо войти в систему');
        return;
      }

      // Создаем FormData
      const formData = new FormData();

      // Определяем способ обработки в зависимости от платформы
      if (Platform.OS === 'web') {
        // Для React Native Web
        const response = await fetch(selectedImage.uri);
        const blob = await response.blob();

        // Определяем расширение файла
        const mimeType = blob.type || 'image/jpeg';
        const extension = mimeType.split('/')[1] || 'jpg';
        const fileName = `photo_${Date.now()}.${extension}`;

        // Создаем File объект для web
        const file = new File([blob], fileName, { type: mimeType });
        formData.append('image', file);

        console.log('Web upload - File details:', {
          fileName,
          type: mimeType,
          size: blob.size
        });
      } else {
        // Для мобильных платформ
        const uri = selectedImage.uri;
        const fileType = uri.split('.').pop()?.toLowerCase() || 'jpg';
        const fileName = `photo_${Date.now()}.${fileType}`;

        let mimeType = 'image/jpeg';
        switch (fileType) {
          case 'png':
            mimeType = 'image/png';
            break;
          case 'gif':
            mimeType = 'image/gif';
            break;
          case 'jpg':
          case 'jpeg':
            mimeType = 'image/jpeg';
            break;
        }

        formData.append('image', {
          uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
          type: mimeType,
          name: fileName,
        } as any);

        console.log('Mobile upload - File details:', {
          fileName,
          type: mimeType,
          uri
        });
      }

      // Добавляем подпись, если есть
      if (caption.trim()) {
        formData.append('caption', caption.trim());
      }

      console.log('Upload request details:', {
        url: `${API_CONFIG.BASE_URL}/photo/api/album/${albumId}/photos/create/`,
        token: token.substring(0, 10) + '...',
        platform: Platform.OS,
        caption: caption.trim() || 'no caption',
      });

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
            setUploadProgress(progress);
          }
        },
      });

      console.log('Upload successful:', response.data);
      Alert.alert('Успех', 'Фотография успешно загружена');

      setSelectedImage(null);
      setCaption('');
      onPhotoUploaded();
      onClose();

    } catch (error: any) {
      console.error('Upload error:', error.response?.data || error.message);
      let errorMessage = 'Не удалось загрузить фотографию';

      if (error.response?.data) {
        const errorData = error.response.data;
        if (errorData.image) {
          errorMessage = Array.isArray(errorData.image)
            ? errorData.image.join('\n')
            : errorData.image;
        } else if (errorData.error) {
          errorMessage = errorData.error;
        }
      }

      Alert.alert('Ошибка', errorMessage);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
};



  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#007AFF" />
            </TouchableOpacity>
            <Text style={styles.title}>Добавить фото</Text>
            <TouchableOpacity
              onPress={handleUpload}
              disabled={!selectedImage || uploading}
            >
              <Text style={[
                styles.uploadButton,
                (!selectedImage || uploading) && styles.uploadButtonDisabled
              ]}>
                Загрузить
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.imageContainer}>
            {selectedImage ? (
              <Image
                source={{ uri: selectedImage.uri }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.placeholderContainer}>
                <Ionicons name="images-outline" size={64} color="#ccc" />
                <Text style={styles.placeholderText}>
                  Выберите фото из галереи или сделайте новое
                </Text>
              </View>
            )}
          </View>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Добавьте подпись к фото..."
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={255}
              editable={!uploading}
            />
          </View>

          {uploading ? (
            <View style={styles.progressContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.progressText}>
                Загрузка... {uploadProgress.toFixed(0)}%
              </Text>
            </View>
          ) : (
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={styles.button}
                onPress={pickImage}
                disabled={uploading}
              >
                <Ionicons name="images" size={24} color="white" />
                <Text style={styles.buttonText}>Галерея</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.button}
                onPress={takePhoto}
                disabled={uploading}
              >
                <Ionicons name="camera" size={24} color="white" />
                <Text style={styles.buttonText}>Камера</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  content: {
    flex: 1,
    backgroundColor: 'white',
    marginTop: 50,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  uploadButton: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  uploadButtonDisabled: {
    opacity: 0.5,
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  placeholderContainer: {
    alignItems: 'center',
    padding: 20,
  },
  placeholderText: {
    marginTop: 12,
    textAlign: 'center',
    color: '#666',
    fontSize: 16,
  },
  inputContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  input: {
    height: 80,
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    textAlignVertical: 'top',
  },
  buttonContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  progressContainer: {
    padding: 16,
    alignItems: 'center',
  },
  progressText: {
    marginTop: 8,
    color: '#666',
    fontSize: 14,
  },
});