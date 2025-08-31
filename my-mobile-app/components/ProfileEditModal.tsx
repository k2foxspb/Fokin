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
  ScrollView,
  Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Picker } from '@react-native-picker/picker';
import { API_CONFIG } from '../config';
import CachedImage from './CachedImage';
import { useTheme } from '../contexts/ThemeContext';

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
  const { theme } = useTheme();
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
            mediaTypes: ImagePicker.MediaTypeOptions.Images, // Исправлено
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

        // Улучшенная обработка аватара для разных платформ
        if (avatar && avatar !== profile.avatar_url) {
            if (Platform.OS === 'web') {
                // Для React Native Web
                try {
                    const response = await fetch(avatar);
                    const blob = await response.blob();

                    const mimeType = blob.type || 'image/jpeg';
                    const extension = mimeType.split('/')[1] || 'jpg';
                    const fileName = `avatar_${Date.now()}.${extension}`;

                    const file = new File([blob], fileName, { type: mimeType });
                    formData.append('avatar', file);

                    console.log('Web avatar file:', {
                        fileName,
                        type: mimeType,
                        size: blob.size
                    });
                } catch (error) {
                    console.error('Error processing avatar for web:', error);
                    Alert.alert('Ошибка', 'Не удалось обработать изображение');
                    return;
                }
            } else {
                // Для мобильных платформ
                let filename = avatar.split('/').pop() || 'avatar.jpg';

                if (!filename.match(/\.(jpg|jpeg|png|gif)$/i)) {
                    filename = `${filename}.jpg`;
                }

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

                const fileObject = {
                    uri: avatar,
                    type: mimeType,
                    name: filename,
                };

                formData.append('avatar', fileObject as any);

                console.log('Mobile avatar file:', {
                    filename,
                    type: mimeType,
                    uri: avatar
                });
            }
        }

        // Убираем цикл formData.entries() для совместимости
        console.log('Sending profile update request...');

        const response = await axios({
            method: 'PUT',
            url: `${API_CONFIG.BASE_URL}/profile/api/profile/me/`,
            data: formData,
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'multipart/form-data',
            }
        });

        if (response.status === 200) {
            Alert.alert('Успех', 'Профиль успешно обновлен');
            onProfileUpdated();
            onClose();
        } else {
            throw new Error('Unexpected response status: ' + response.status);
        }
    } catch (error: any) {
        console.error('Error updating profile:', error);
        let errorMessage = 'Не удалось обновить профиль';

        if (error.response?.data) {
            const errorData = error.response.data;
            if (typeof errorData === 'object') {
                errorMessage = Object.entries(errorData)
                    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
                    .join('\n');
            }
        } else if (error.message) {
            errorMessage = error.message;
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
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={handleClose} style={styles.cancelButton}>
            <Text style={[styles.cancelButtonText, { color: theme.primary }]}>Отмена</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Редактировать профиль</Text>
          <TouchableOpacity 
            onPress={handleSave} 
            style={styles.saveButton}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <Text style={[styles.saveButtonText, { color: theme.primary }]}>Сохранить</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Avatar Section */}
          <View style={styles.avatarSection}>
            <TouchableOpacity onPress={pickImage} style={styles.avatarContainer}>
              <CachedImage
                uri={avatar || ''}

                style={styles.avatar}
              />
              <View style={[styles.avatarOverlay, { backgroundColor: theme.primary }]}>
                <Ionicons name="camera" size={20} color={theme.surface} />
              </View>
            </TouchableOpacity>
            <Text style={[styles.avatarText, { color: theme.textSecondary }]}>Нажмите, чтобы изменить фото</Text>
          </View>

          {/* Name Section */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme.text }]}>Имя</Text>
            <TextInput
              style={[styles.input, { 
                backgroundColor: theme.surface, 
                borderColor: theme.border,
                color: theme.text
              }]}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Введите имя"
              placeholderTextColor={theme.placeholder}
              maxLength={150}
              editable={!loading}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme.text }]}>Фамилия</Text>
            <TextInput
              style={[styles.input, { 
                backgroundColor: theme.surface, 
                borderColor: theme.border,
                color: theme.text
              }]}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Введите фамилию"
              placeholderTextColor={theme.placeholder}
              maxLength={150}
              editable={!loading}
            />
          </View>

          {/* Gender Section */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme.text }]}>Пол</Text>
            <View style={[styles.pickerContainer, { 
              backgroundColor: theme.surface, 
              borderColor: theme.border 
            }]}>
              <Picker
                selectedValue={gender}
                onValueChange={setGender}
                enabled={!loading}
                style={[styles.picker, { color: theme.text }]}
              >
                <Picker.Item label="Мужчина" value="male" />
                <Picker.Item label="Женщина" value="female" />
              </Picker>
            </View>
          </View>

          {/* Birthday Section */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme.text }]}>День рождения</Text>
            <TextInput
              style={[styles.input, { 
                backgroundColor: theme.surface, 
                borderColor: theme.border,
                color: theme.text
              }]}
              value={birthday}
              onChangeText={setBirthday}
              placeholder="ГГГГ-ММ-ДД"
              placeholderTextColor={theme.placeholder}
              maxLength={10}
              editable={!loading}
            />
            <Text style={[styles.inputHint, { color: theme.textSecondary }]}>Формат: ГГГГ-ММ-ДД (например, 1990-01-15)</Text>
          </View>

          {/* Username and Email (Read-only) */}
          <View style={[styles.readOnlySection, { borderTopColor: theme.border }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Информация аккаунта</Text>

            <View style={[styles.readOnlyGroup, { backgroundColor: theme.surface }]}>
              <Text style={[styles.readOnlyLabel, { color: theme.textSecondary }]}>Логин</Text>
              <Text style={[styles.readOnlyValue, { color: theme.text }]}>@{profile?.username}</Text>
            </View>

            <View style={[styles.readOnlyGroup, { backgroundColor: theme.surface }]}>
              <Text style={[styles.readOnlyLabel, { color: theme.textSecondary }]}>Email</Text>
              <Text style={[styles.readOnlyValue, { color: theme.text }]}>{profile?.email}</Text>
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelButtonText: {
    fontSize: 16,
  },
  saveButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
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
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    overflow: 'hidden',
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'white',
  },
  avatarText: {
    fontSize: 14,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  inputHint: {
    fontSize: 12,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  pickerContainer: {
    borderWidth: 1,
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
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  readOnlyGroup: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  readOnlyLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  readOnlyValue: {
    fontSize: 16,
    fontWeight: '500',
  },
});