import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import axios, { AxiosError } from 'axios'; // Добавляем AxiosError
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from "expo-router";
import { Link } from "expo-router";
import { API_CONFIG } from '../../config';
import { useTheme } from '../../contexts/ThemeContext';

interface Theme {
  background: string;
  surface: string;
  primary: string;
  text: string;
  textSecondary: string;
  border: string;
  placeholder: string;
}

interface LoginResponse {
  token: string;
  user: {
    id: number;
    username: string;
    // добавьте другие поля пользователя, если они есть
  };
}

export default function Login() { // Убираем параметр navigation, т.к. используем router
  const { theme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const styles = createStyles(theme);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Ошибка', 'Заполните все поля');
      return;
    }

    setLoading(true);

    // Отладочная информация
    const loginUrl = `${API_CONFIG.BASE_URL}/authentication/api/login/`;
    try {
      console.log('🔍 [LOGIN] Отправка запроса...');

      const response = await axios.post<LoginResponse>(loginUrl, {
        username: username.trim(),
        password,
      }, {
        timeout: 10000, // 10 секунд таймаут
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const { token } = response.data;

      // Сохраняем токен
      await AsyncStorage.setItem('userToken', token);

      // Устанавливаем токен для будущих запросов
      axios.defaults.headers.common['Authorization'] = `Token ${token}`;
      // Переходим на страницу новостей
      router.replace('/(main)/feed');
    } catch (error) {
      console.error('❌ [LOGIN] Ошибка входа:', error);

      const axiosError = error as AxiosError<{ error: string; detail?: string }>;

      // Подробная диагностика ошибки
      if (axiosError.response) {
        console.error('❌ [LOGIN] Ответ сервера:', axiosError.response.status);
        console.error('❌ [LOGIN] Данные ошибки:', axiosError.response.data);
        console.error('❌ [LOGIN] Заголовки:', axiosError.response.headers);
      } else if (axiosError.request) {
        console.error('❌ [LOGIN] Запрос отправлен, но нет ответа:', axiosError.request);
        console.error('❌ [LOGIN] Возможные причины: сервер недоступен, проблемы с сетью');
      } else {
        console.error('❌ [LOGIN] Ошибка настройки запроса:', axiosError.message);
      }

      let errorMessage = 'Произошла ошибка при входе';

      if (axiosError.response?.data?.error) {
        errorMessage = axiosError.response.data.error;
      } else if (axiosError.response?.data?.detail) {
        errorMessage = axiosError.response.data.detail;
      } else if (axiosError.code === 'NETWORK_ERROR' || axiosError.code === 'ERR_NETWORK') {
        errorMessage = 'Не удается подключиться к серверу. Проверьте подключение к интернету и убедитесь, что сервер запущен.';
      } else if (axiosError.code === 'ECONNREFUSED') {
        errorMessage = 'Соединение отклонено. Убедитесь, что сервер запущен на порту 8000.';
      } else if (axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED') {
        errorMessage = 'Превышено время ожидания. Сервер не отвечает.';
      }

      Alert.alert('Ошибка', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Вход в аккаунт</Text>
      
      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder="Имя пользователя"
        placeholderTextColor={theme.placeholder}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder="Пароль"
        placeholderTextColor={theme.placeholder}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      
      <TouchableOpacity 
        style={[styles.button, loading && styles.disabledButton]} 
        onPress={handleLogin}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>Войти</Text>
        )}
      </TouchableOpacity>
      
      <View style={styles.linkContainer}>
        <Link href="/(auth)/forgot-password" style={styles.link}>
          Забыли пароль?
        </Link>
      </View>
      
      <View style={styles.linkContainer}>
        <Text style={styles.linkText}>Нет аккаунта? </Text>
        <Link href="/(auth)/register" style={styles.link}>
          Зарегистрироваться
        </Link>
      </View>
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: theme.background,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: theme.text,
  },
  input: {
    backgroundColor: theme.surface,
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  button: {
    backgroundColor: theme.primary,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  disabledButton: {
    backgroundColor: theme.textSecondary,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  linkContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 10,
  },
  linkText: {
    fontSize: 16,
    color: theme.textSecondary,
  },
  link: {
    fontSize: 16,
    color: theme.primary,
    fontWeight: '500',
  },
});