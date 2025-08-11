// services/userService.ts (создайте новый файл)
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_CONFIG } from '../config';

interface UserInfo {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
}

// Кеш для хранения информации о пользователях
const userCache = new Map<number, UserInfo>();

export const getUsersByIds = async (userIds: number[]): Promise<Map<number, UserInfo>> => {
  try {
    const token = await AsyncStorage.getItem('userToken');
    if (!token) {
      throw new Error('No auth token');
    }

    // Фильтруем ID, которых нет в кеше
    const uncachedIds = userIds.filter(id => !userCache.has(id));

    if (uncachedIds.length > 0) {
      // Исправляем URL - убираем лишний слеш в конце
      const response = await axios.post(
        `${API_CONFIG.BASE_URL}/profile/api/users/bulk/`,
        { user_ids: uncachedIds },
        { headers: { Authorization: `Token ${token}` } }
      );

      // Логируем для отладки
      console.log('Bulk users API response:', response.data);

      // Сохраняем в кеш
      response.data.forEach((user: UserInfo) => {
        userCache.set(user.id, user);
      });
    }

    // Возвращаем Map с данными всех запрошенных пользователей
    const result = new Map<number, UserInfo>();
    userIds.forEach(id => {
      const user = userCache.get(id);
      if (user) {
        result.set(id, user);
      }
    });

    return result;
  } catch (error) {
    // Добавим больше информации для отладки
    if (axios.isAxiosError(error)) {
      console.error('Axios error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        method: error.config?.method,
        data: error.response?.data
      });
    }
    console.error('Error fetching users by IDs:', error);
    return new Map();
  }
};


export const clearUserCache = () => {
  userCache.clear();
};