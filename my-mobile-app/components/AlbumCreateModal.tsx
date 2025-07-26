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
import {API_CONFIG} from "../app/config";

interface AlbumCreateModalProps {
  visible: boolean;
  onClose: () => void;
  onAlbumCreated: () => void;
}

export default function AlbumCreateModal({ visible, onClose, onAlbumCreated }: AlbumCreateModalProps) {
  const [title, setTitle] = useState('');
  const [isHidden, setIsHidden] = useState(false);
  const [loading, setLoading] = useState(false);

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
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Название альбома</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Введите название альбома"
              maxLength={255}
              editable={!loading}
            />

            <View style={styles.switchContainer}>
              <Text style={styles.label}>Скрытый альбом</Text>
              <Switch
                value={isHidden}
                onValueChange={setIsHidden}
                disabled={loading}
              />
            </View>

            <TouchableOpacity
              style={[styles.createButton, loading && styles.disabledButton]}
              onPress={handleCreate}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.createButtonText}>Создать альбом</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '90%',
    maxWidth: 400,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 4,
  },
  form: {
    gap: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  createButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  createButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});