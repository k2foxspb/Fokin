import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
} from 'react-native';
import axios, { AxiosError } from 'axios'; // Добавляем AxiosError
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from "expo-router";

const API_URL = 'http://localhost:8000'; // для Android эмулятора
// const API_URL = 'http://localhost:8000'; // для iOS симулятора

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

  const handleLogin = async () => {
    try {
      const response = await axios.post<LoginResponse>(`${API_URL}/authentication/api/login/`, {
        username,
        password,
      });

      const { token } = response.data;

      // Сохраняем токен
      await AsyncStorage.setItem('userToken', token);

      // Устанавливаем токен для будущих запросов
      axios.defaults.headers.common['Authorization'] = `Token ${token}`;

      // Переходим на экран профиля
      router.replace('(tabs)/profile'); // Изменяем путь в соответствии со структурой Expo Router
    } catch (error) {
      const axiosError = error as AxiosError<{ error: string }>;
      Alert.alert(
        'Ошибка',
        axiosError.response?.data?.error || 'Произошла ошибка при входе'
      );
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Имя пользователя"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none" // Добавляем для удобства
        autoCorrect={false} // Добавляем для удобства
      />
      <TextInput
        style={styles.input}
        placeholder="Пароль"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none" // Добавляем для удобства
        autoCorrect={false} // Добавляем для удобства
      />
      <TouchableOpacity style={styles.button} onPress={handleLogin}>
        <Text style={styles.buttonText}>Войти</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  input: {
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 5,
    marginBottom: 10,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 5,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});