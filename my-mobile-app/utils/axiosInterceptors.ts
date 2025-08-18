import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Alert } from 'react-native';

// Функция для настройки interceptors
export const setupAxiosInterceptors = () => {
  // Request interceptor для добавления токена
  axios.interceptors.request.use(
    async (config) => {
      const token = await AsyncStorage.getItem('userToken');
      if (token) {
        config.headers.Authorization = `Token ${token}`;
      }
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor для обработки 401 ошибок
  axios.interceptors.response.use(
    (response) => {
      return response;
    },
    async (error) => {
      if (error.response?.status === 401) {
        // Удаляем токен из AsyncStorage
        await AsyncStorage.removeItem('userToken');
        await AsyncStorage.removeItem('userData');

        // Очищаем заголовок Authorization
        delete axios.defaults.headers.common['Authorization'];

        // Показываем уведомление
        Alert.alert(
          'Сессия истекла',
          'Ваша сессия истекла. Пожалуйста, войдите снова.',
          [
            {
              text: 'OK',
              onPress: () => router.replace('/(auth)/login'),
            },
          ]
        );

        // Перенаправляем на страницу входа
        router.replace('/(auth)/login');
      }

      return Promise.reject(error);
    }
  );
};
