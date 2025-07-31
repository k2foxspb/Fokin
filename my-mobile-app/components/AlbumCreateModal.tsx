
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
  Switch
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import {API_CONFIG} from "../config";
import { useTheme } from '../contexts/ThemeContext';

interface AlbumCreateModalProps {
  visible: boolean;
  onClose: () => void;
  onAlbumCreated: () => void;
}

export default function AlbumCreateModal({ visible, onClose, onAlbumCreated }: AlbumCreateModalProps) {
  const { theme } = useTheme();
  const [title, setTitle] = useState('');
  const [isHidden, setIsHidden] = useState(false);
  const [loading, setLoading] = useState(false);

  const styles = createStyles(theme);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Ошибка', 'Введите название альбома');
      return;
    }

    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        Alert.alert('Ошибка', 'Необходимо войти в систему');
        return;
      }

      await axios.post(
        `${API_CONFIG.BASE_URL}/photo/api/albums/create/`,
        {
          title: title.trim(),
          hidden_flag: isHidden
        },
        {
          headers: { Authorization: `Token ${token}` }
        }
      );

      Alert.alert('Успех', 'Альбом создан успешно');
      setTitle('');
      setIsHidden(false);
      onAlbumCreated();
      onClose();
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось создать альбом');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setTitle('');
    setIsHidden(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Создать альбом</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Название альбома</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Введите название альбома"
              placeholderTextColor={theme.textSecondary}
              maxLength={255}
              editable={!loading}
            />

            <View style={styles.switchContainer}>
              <View style={styles.switchLabelContainer}>
                <Text style={styles.label}>Скрытый альбом</Text>
                <Text style={styles.switchDescription}>
                  Только вы сможете видеть этот альбом
                </Text>
              </View>
              <Switch
                value={isHidden}
                onValueChange={setIsHidden}
                disabled={loading}
                trackColor={{ false: theme.border, true: theme.primary + '50' }}
                thumbColor={isHidden ? theme.primary : theme.textSecondary}
              />
            </View>

            <TouchableOpacity
              style={[styles.createButton, loading && styles.disabledButton]}
              onPress={handleCreate}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <>
                  <Ionicons name="add-circle-outline" size={20} color="white" />
                  <Text style={styles.createButtonText}>Создать альбом</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 24,
    width: '90%',
    maxWidth: 400,
    elevation: 8,
    shadowColor: theme.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 20,
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
  form: {
    gap: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.text,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: theme.background,
    color: theme.text,
    fontWeight: '500',
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  switchLabelContainer: {
    flex: 1,
    marginRight: 16,
  },
  switchDescription: {
    fontSize: 13,
    color: theme.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  createButton: {
    backgroundColor: theme.primary,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 8,
    elevation: 3,
    shadowColor: theme.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  disabledButton: {
    backgroundColor: theme.textSecondary,
    opacity: 0.6,
  },
  createButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});