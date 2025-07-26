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
import { API_CONFIG } from '@/config';

interface LoginResponse {
  token: string;
  user: {
    id: number;
    username: string;
    // добавьте другие поля пользователя, если они есть
  };
}

export default function Login() { // Убираем параметр navigation, т.к. используем router
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Ошибка', 'Заполните все поля');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post<LoginResponse>(`${API_CONFIG.BASE_URL}/authentication/api/login/`, {
        username: username.trim(),
        password,
      });

      const { token } = response.data;

      // Сохраняем токен
      await AsyncStorage.setItem('userToken', token);

      // Устанавливаем токен для будущих запросов
      axios.defaults.headers.common['Authorization'] = `Token ${token}`;

      // Переходим на страницу новостей
      router.replace('/(tabs)/feed');
    } catch (error) {
      const axiosError = error as AxiosError<{ error: string }>;
      Alert.alert(
        'Ошибка',
        axiosError.response?.data?.error || 'Произошла ошибка при входе'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Вход в аккаунт</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Имя пользователя"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      <TextInput
        style={styles.input}
        placeholder="Пароль"
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

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: '#333',
  },
  input: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  disabledButton: {
    backgroundColor: '#ccc',
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
    color: '#666',
  },
  link: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
});