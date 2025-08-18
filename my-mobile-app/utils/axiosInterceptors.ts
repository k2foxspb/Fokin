import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Alert } from 'react-native';

let isRedirecting = false;

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
      if (error.response?.status === 401 && !isRedirecting) {
        isRedirecting = true;

        try {
          // Удаляем токен из AsyncStorage
          await AsyncStorage.removeItem('userToken');
          await AsyncStorage.removeItem('userData');

          // Очищаем заголовок Authorization
          delete axios.defaults.headers.common['Authorization'];

          // Перенаправляем на страницу входа
          router.replace('/(auth)/login');

          // Показываем уведомление
          setTimeout(() => {
            Alert.alert(
              'Сессия истекла',
              'Ваша сессия истекла. Пожалуйста, войдите снова.'
            );
          }, 500);

        } finally {
          // Сбрасываем флаг через 2 секунды
          setTimeout(() => {
            isRedirecting = false;
          }, 2000);
        }
      }

      return Promise.reject(error);
    }
  );
};
