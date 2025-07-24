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
  Image,
  ScrollView,
  Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Picker } from '@react-native-picker/picker';
import { API_CONFIG } from '@/app/config';

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
}

interface ProfileEditModalProps {
  visible: boolean;
  profile: UserProfile | null;
  onClose: () => void;
  onProfileUpdated: () => void;
}

export default function ProfileEditModal({ 
  visible, 
  profile, 
  onClose, 
  onProfileUpdated 
}: ProfileEditModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('male');
  const [birthday, setBirthday] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || '');
      setLastName(profile.last_name || '');
      setGender(profile.gender || 'male');
      setBirthday(profile.birthday || '');
      setAvatar(profile.avatar_url || null);
    }
  }, [profile]);

  const pickImage = async () => {
    try {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Ошибка', 'Необходимо разрешение для доступа к галерее');
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: 'image',
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
            exif: false
        });

        if (!result.canceled && result.assets && result.assets[0]) {
            const asset = result.assets[0];
            console.log('Selected image asset:', asset);
            setAvatar(asset.uri);
        }
    } catch (error) {
        console.error('Error picking image:', error);
        Alert.alert('Ошибка', 'Не удалось выбрать изображение');
    }
};






const handleSave = async () => {
    if (!profile) return;

    setLoading(true);
    try {
        const token = await AsyncStorage.getItem('userToken');
        if (!token) {
            Alert.alert('Ошибка', 'Необходимо войти в систему');
            return;
        }

        const formData = new FormData();

        if (firstName.trim()) {
            formData.append('first_name', firstName.trim());
        }
        if (lastName.trim()) {
            formData.append('last_name', lastName.trim());
        }
        formData.append('gender', gender);
        if (birthday) {
            formData.append('birthday', birthday);
        }

        // Исправленная обработка аватара
        if (avatar && avatar !== profile.avatar_url) {
            let localUri = avatar;
            let filename = localUri.split('/').pop() || 'avatar.jpg';

            // Убеждаемся что у файла правильное расширение
            if (!filename.match(/\.(jpg|jpeg|png|gif)$/i)) {
                filename = `${filename}.jpg`;
            }

            // Определяем MIME тип более точно
            let mimeType = 'image/jpeg';
            const extension = filename.toLowerCase().split('.').pop();

            switch (extension) {
                case 'png':
                    mimeType = 'image/png';
                    break;
                case 'gif':
                    mimeType = 'image/gif';
                    break;
                case 'jpg':
                case 'jpeg':
                default:
                    mimeType = 'image/jpeg';
                    break;
            }

            // Создаем правильный объект файла для React Native
            const fileObject = {
                uri: localUri,
                type: mimeType,
                name: filename,
            };

            formData.append('avatar', fileObject as any);
        }

        console.log('FormData entries:');
        for (let [key, value] of formData.entries()) {
            console.log(key, value);
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/profile/api/profile/me/`, {
            method: 'PUT',
            headers: {
                'Authorization': `Token ${token}`,
                // Не устанавливаем Content-Type для multipart/form-data
            },
            body: formData
        });

        const responseData = await response.json();

        if (response.ok) {
            Alert.alert('Успех', 'Профиль успешно обновлен');
            onProfileUpdated();
            onClose();
        } else {
            console.error('Server error response:', responseData);
            throw new Error(JSON.stringify(responseData));
        }
    } catch (error: any) {
        console.error('Error updating profile:', error);
        let errorMessage = 'Не удалось обновить профиль';

        try {
            const errorData = JSON.parse(error.message);
            if (typeof errorData === 'object') {
                errorMessage = Object.entries(errorData)
                    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
                    .join('\n');
            }
        } catch {
            errorMessage = error.message || errorMessage;
        }

        Alert.alert('Ошибка', errorMessage);
    } finally {
        setLoading(false);
    }
};






  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  };

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setGender('male');
    setBirthday('');
    setAvatar(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>Отмена</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Редактировать профиль</Text>
          <TouchableOpacity 
            onPress={handleSave} 
            style={styles.saveButton}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <Text style={styles.saveButtonText}>Сохранить</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Avatar Section */}
          <View style={styles.avatarSection}>
            <TouchableOpacity onPress={pickImage} style={styles.avatarContainer}>
              {avatar ? (
                <Image source={{ uri: avatar }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person" size={40} color="#ccc" />
                </View>
              )}
              <View style={styles.avatarOverlay}>
                <Ionicons name="camera" size={20} color="white" />
              </View>
            </TouchableOpacity>
            <Text style={styles.avatarText}>Нажмите, чтобы изменить фото</Text>
          </View>

          {/* Name Section */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Имя</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Введите имя"
              maxLength={150}
              editable={!loading}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Фамилия</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Введите фамилию"
              maxLength={150}
              editable={!loading}
            />
          </View>

          {/* Gender Section */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Пол</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={gender}
                onValueChange={setGender}
                enabled={!loading}
                style={styles.picker}
              >
                <Picker.Item label="Мужчина" value="male" />
                <Picker.Item label="Женщина" value="female" />
              </Picker>
            </View>
          </View>

          {/* Birthday Section */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>День рождения</Text>
            <TextInput
              style={styles.input}
              value={birthday}
              onChangeText={setBirthday}
              placeholder="ГГГГ-ММ-ДД"
              maxLength={10}
              editable={!loading}
            />
            <Text style={styles.inputHint}>Формат: ГГГГ-ММ-ДД (например, 1990-01-15)</Text>
          </View>

          {/* Username and Email (Read-only) */}
          <View style={styles.readOnlySection}>
            <Text style={styles.sectionTitle}>Информация аккаунта</Text>
            
            <View style={styles.readOnlyGroup}>
              <Text style={styles.readOnlyLabel}>Логин</Text>
              <Text style={styles.readOnlyValue}>@{profile?.username}</Text>
            </View>

            <View style={styles.readOnlyGroup}>
              <Text style={styles.readOnlyLabel}>Email</Text>
              <Text style={styles.readOnlyValue}>{profile?.email}</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#007AFF',
  },
  saveButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e1e5e9',
  },
  avatarOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#007AFF',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  avatarText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e1e5e9',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1a1a1a',
  },
  inputHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  pickerContainer: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e1e5e9',
    borderRadius: 8,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  readOnlySection: {
    marginTop: 24,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#e1e5e9',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 16,
  },
  readOnlyGroup: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  readOnlyLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  readOnlyValue: {
    fontSize: 16,
    color: '#1a1a1a',
    fontWeight: '500',
  },
});