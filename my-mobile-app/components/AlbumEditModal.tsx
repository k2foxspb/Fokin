
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
import { API_CONFIG } from "../config";
import { useTheme } from '../contexts/ThemeContext';

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
  loading,
  theme
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
  theme: any;
}) => (
  <Modal
    visible={visible}
    transparent={true}
    animationType="fade"
    onRequestClose={onCancel}
  >
    <View style={{
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
    }}>
      <View style={{
        backgroundColor: theme.surface,
        borderRadius: 16,
        padding: 24,
        width: '100%',
        maxWidth: 340,
        alignItems: 'center',
      }}>
        <Ionicons name="warning" size={48} color={theme.error || "#ff3b30"} style={{ marginBottom: 16 }} />
        <Text style={{
          fontSize: 20,
          fontWeight: 'bold',
          color: theme.text,
          marginBottom: 12,
          textAlign: 'center',
        }}>Удалить альбом?</Text>
        <Text style={{
          fontSize: 16,
          color: theme.textSecondary,
          marginBottom: 24,
          textAlign: 'center',
          lineHeight: 22,
        }}>
          Вы уверены, что хотите удалить этот альбом?{'\n'}
          Все фотографии в нем также будут удалены.{'\n'}
          Это действие нельзя отменить.
        </Text>

        <View style={{
          flexDirection: 'row',
          width: '100%',
          gap: 12,
        }}>
          <TouchableOpacity
            style={{
              flex: 1,
              paddingVertical: 12,
              paddingHorizontal: 20,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 44,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.background,
            }}
            onPress={onCancel}
            disabled={loading}
          >
            <Text style={{
              color: theme.primary,
              fontSize: 16,
              fontWeight: '600',
            }}>Отмена</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              flex: 1,
              paddingVertical: 12,
              paddingHorizontal: 20,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 44,
              backgroundColor: theme.error || '#ff3b30',
            }}
            onPress={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text style={{
                color: 'white',
                fontSize: 16,
                fontWeight: '600',
              }}>Удалить</Text>
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
  const { theme } = useTheme();
  const [title, setTitle] = useState('');
  const [hiddenFlag, setHiddenFlag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);

  const styles = createStyles(theme);

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
        // Ошибка обновления альбома
      Alert.alert('Ошибка', 'Не удалось обновить альбом');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePress = () => {
    setDeleteConfirmVisible(true);
  };

  const handleDeleteConfirm = async () => {
    if (!album) return;

    setLoading(true);

    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        Alert.alert('Ошибка', 'Необходимо войти в систему');
        return;
      }

      await axios.delete(
        `${API_CONFIG.BASE_URL}/photo/api/album/${album.id}/`,
        {
          headers: { Authorization: `Token ${token}` }
        }
      );

      Alert.alert('Успех', 'Альбом успешно удален');

      // Закрываем модальные окна
      setDeleteConfirmVisible(false);
      onAlbumDeleted();
      onClose();
    } catch (error) {
      console.error('Error deleting album:', error);
      Alert.alert('Ошибка', 'Не удалось удалить альбом');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCancel = () => {
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
        <View style={[styles.container, { backgroundColor: theme.background }]}>
          <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
            <TouchableOpacity onPress={handleClose} style={styles.cancelButton}>
              <Text style={[styles.cancelButtonText, { color: theme.primary }]}>Отмена</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Редактировать альбом</Text>
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

          <View style={styles.content}>
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: theme.text }]}>Название альбома</Text>
              <TextInput
                style={[styles.input, { 
                  backgroundColor: theme.surface, 
                  borderColor: theme.border,
                  color: theme.text
                }]}
                value={title}
                onChangeText={setTitle}
                placeholder="Введите название альбома"
                placeholderTextColor={theme.textSecondary}
                maxLength={255}
                editable={!loading}
              />
            </View>

            <View style={[styles.switchGroup, { backgroundColor: theme.surface }]}>
              <View style={styles.switchLabelContainer}>
                <Ionicons
                  name={hiddenFlag ? "eye-off" : "eye"}
                  size={20}
                  color={theme.textSecondary}
                  style={styles.switchIcon}
                />
                <Text style={[styles.switchLabel, { color: theme.text }]}>Скрытый альбом</Text>
              </View>
              <Switch
                value={hiddenFlag}
                onValueChange={setHiddenFlag}
                disabled={loading}
                trackColor={{ false: theme.border, true: theme.primary + '80' }}
                thumbColor={hiddenFlag ? theme.primary : theme.surface}
              />
            </View>

            <Text style={[styles.switchDescription, { color: theme.textSecondary }]}>
              Скрытые альбомы видны только вам
            </Text>

            <View style={[styles.dangerZone, { borderTopColor: theme.border }]}>
              <Text style={[styles.dangerZoneTitle, { color: theme.error || '#FF3B30' }]}>Опасная зона</Text>
              <TouchableOpacity
                style={[styles.deleteButton, { 
                  backgroundColor: theme.surface,
                  borderColor: theme.error || '#FF3B30' 
                }]}
                onPress={handleDeletePress}
                disabled={loading}
              >
                <Ionicons name="trash-outline" size={20} color={theme.error || '#FF3B30'} />
                <Text style={[styles.deleteButtonText, { color: theme.error || '#FF3B30' }]}>Удалить альбом</Text>
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
        theme={theme}
      />
    </>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  cancelButtonText: {
    fontSize: 14,
  },
  saveButton: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
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
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  switchGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  },
  switchDescription: {
    fontSize: 14,
    marginBottom: 32,
    paddingHorizontal: 4,
  },
  dangerZone: {
    marginTop: 'auto',
    paddingTop: 24,
    borderTopWidth: 1,
  },
  dangerZoneTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  deleteButtonText: {
    fontSize: 16,
    marginLeft: 8,
    fontWeight: '500',
  },
});