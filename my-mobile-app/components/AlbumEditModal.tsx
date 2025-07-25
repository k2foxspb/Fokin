
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  Alert,
  Switch,
  ActivityIndicator
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import {API_CONFIG} from "@/app/config";

interface Album {
  id: number;
  title: string;
  hidden_flag: boolean;
  created_at: string;
}

interface AlbumEditModalProps {
  visible: boolean;
  album: Album | null;
  onClose: () => void;
  onAlbumUpdated: () => void;
  onAlbumDeleted: () => void;
}

// Кастомное модальное окно подтверждения удаления альбома
const DeleteAlbumConfirmModal = ({
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
        <Text style={styles.deleteModalTitle}>Удалить альбом?</Text>
        <Text style={styles.deleteModalMessage}>
          Вы уверены, что хотите удалить этот альбом?{'\n'}
          Все фотографии в нем также будут удалены.{'\n'}
          Это действие нельзя отменить.
        </Text>

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

export default function AlbumEditModal({
  visible,
  album,
  onClose,
  onAlbumUpdated,
  onAlbumDeleted
}: AlbumEditModalProps) {
  const [title, setTitle] = useState('');
  const [hiddenFlag, setHiddenFlag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);

  useEffect(() => {
    if (album) {
      setTitle(album.title);
      setHiddenFlag(album.hidden_flag);
    }
  }, [album]);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Ошибка', 'Введите название альбома');
      return;
    }

    if (!album) return;

    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        Alert.alert('Ошибка', 'Необходимо войти в систему');
        return;
      }

      await axios.put(
        `${API_CONFIG.BASE_URL}/photo/api/album/${album.id}/`,
        {
          title: title.trim(),
          hidden_flag: hiddenFlag
        },
        {
          headers: { Authorization: `Token ${token}` }
        }
      );

      Alert.alert('Успех', 'Альбом успешно обновлен');
      onAlbumUpdated();
      onClose();
    } catch (error) {
      console.error('Error updating album:', error);
      Alert.alert('Ошибка', 'Не удалось обновить альбом');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePress = () => {
    console.log('🗑️ Delete album button pressed');
    setDeleteConfirmVisible(true);
  };

  const handleDeleteConfirm = async () => {
    if (!album) return;

    console.log('✅ Delete album confirmed');
    setLoading(true);

    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        Alert.alert('Ошибка', 'Необходимо войти в систему');
        return;
      }

      console.log('🔗 Sending DELETE request for album:', album.id);

      await axios.delete(
        `${API_CONFIG.BASE_URL}/photo/api/album/${album.id}/`,
        {
          headers: { Authorization: `Token ${token}` }
        }
      );

      console.log('✅ Album deleted successfully');
      Alert.alert('Успех', 'Альбом успешно удален');

      // Закрываем модальные окна
      setDeleteConfirmVisible(false);
      onAlbumDeleted();
      onClose();
    } catch (error) {
      console.error('❌ Error deleting album:', error);
      Alert.alert('Ошибка', 'Не удалось удалить альбом');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCancel = () => {
    console.log('❌ Delete album cancelled');
    setDeleteConfirmVisible(false);
  };

  const resetForm = () => {
    setTitle('');
    setHiddenFlag(false);
  };

  const handleClose = () => {
    resetForm();
    setDeleteConfirmVisible(false);
    onClose();
  };

  return (
    <>
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
            <Text style={styles.headerTitle}>Редактировать альбом</Text>
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

          <View style={styles.content}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Название альбома</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="Введите название альбома"
                maxLength={255}
                editable={!loading}
              />
            </View>

            <View style={styles.switchGroup}>
              <View style={styles.switchLabelContainer}>
                <Ionicons
                  name={hiddenFlag ? "eye-off" : "eye"}
                  size={20}
                  color="#666"
                  style={styles.switchIcon}
                />
                <Text style={styles.switchLabel}>Скрытый альбом</Text>
              </View>
              <Switch
                value={hiddenFlag}
                onValueChange={setHiddenFlag}
                disabled={loading}
                trackColor={{ false: '#767577', true: '#81b0ff' }}
                thumbColor={hiddenFlag ? '#007AFF' : '#f4f3f4'}
              />
            </View>

            <Text style={styles.switchDescription}>
              Скрытые альбомы видны только вам
            </Text>

            <View style={styles.dangerZone}>
              <Text style={styles.dangerZoneTitle}>Опасная зона</Text>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={handleDeletePress}
                disabled={loading}
              >
                <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                <Text style={styles.deleteButtonText}>Удалить альбом</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Кастомное модальное окно подтверждения удаления альбома */}
      <DeleteAlbumConfirmModal
        visible={deleteConfirmVisible}
        onCancel={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        loading={loading}
      />
    </>
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
  inputGroup: {
    marginBottom: 24,
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
  switchGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  switchLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  switchIcon: {
    marginRight: 8,
  },
  switchLabel: {
    fontSize: 16,
    color: '#1a1a1a',
  },
  switchDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 32,
    paddingHorizontal: 4,
  },
  dangerZone: {
    marginTop: 'auto',
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#e1e5e9',
  },
  dangerZoneTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF3B30',
    marginBottom: 12,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#FF3B30',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  deleteButtonText: {
    fontSize: 16,
    color: '#FF3B30',
    marginLeft: 8,
    fontWeight: '500',
  },
  // Стили для модального окна подтверждения удаления альбома
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
    maxWidth: 340,
    alignItems: 'center',
  },
  deleteModalIcon: {
    marginBottom: 16,
  },
  deleteModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
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
  confirmButton: {
    backgroundColor: '#ff3b30',
  },
  confirmButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});