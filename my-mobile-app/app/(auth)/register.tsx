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
import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from "expo-router";
import { Link } from "expo-router";
import { API_CONFIG } from '@/config';

interface RegisterResponse {
  token: string;
  user: {
    id: number;
    username: string;
    email: string;
  };
}

export default function Register() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const validateForm = () => {
    if (!username.trim()) {
      Alert.alert('Ошибка', 'Введите имя пользователя');
      return false;
    }
    if (!email.trim()) {
      Alert.alert('Ошибка', 'Введите email');
      return false;
    }
    if (!email.includes('@')) {
      Alert.alert('Ошибка', 'Введите корректный email');
      return false;
    }
    if (!password) {
      Alert.alert('Ошибка', 'Введите пароль');
      return false;
    }
    if (password.length < 6) {
      Alert.alert('Ошибка', 'Пароль должен содержать минимум 6 символов');
      return false;
    }
    if (password !== confirmPassword) {
      Alert.alert('Ошибка', 'Пароли не совпадают');
      return false;
    }
    return true;
  };

  const handleRegister = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const response = await axios.post<RegisterResponse>(`${API_CONFIG.BASE_URL}/authentication/api/register/`, {
        username: username.trim(),
        email: email.trim(),
        password,
        password_confirm: confirmPassword,
      });

      const { token } = response.data;

      // Сохраняем токен
      await AsyncStorage.setItem('userToken', token);

      // Устанавливаем токен для будущих запросов
      axios.defaults.headers.common['Authorization'] = `Token ${token}`;

      Alert.alert('Успех', 'Регистрация прошла успешно!', [
        {
          text: 'OK',
          onPress: () => router.replace('/(tabs)/feed'),
        },
      ]);
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; [key: string]: any }>;
      let errorMessage = 'Произошла ошибка при регистрации';
      
      if (axiosError.response?.data) {
        const data = axiosError.response.data;
        if (data.error) {
          errorMessage = data.error;
        } else if (data.username) {
          errorMessage = `Имя пользователя: ${data.username[0]}`;
        } else if (data.email) {
          errorMessage = `Email: ${data.email[0]}`;
        } else if (data.password) {
          errorMessage = `Пароль: ${data.password[0]}`;
        }
      }
      
      Alert.alert('Ошибка', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Регистрация</Text>
      
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
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
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
      
      <TextInput
        style={styles.input}
        placeholder="Подтвердите пароль"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      
      <TouchableOpacity 
        style={[styles.button, loading && styles.disabledButton]} 
        onPress={handleRegister}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>Зарегистрироваться</Text>
        )}
      </TouchableOpacity>
      
      <View style={styles.linkContainer}>
        <Text style={styles.linkText}>Уже есть аккаунт? </Text>
        <Link href="/(auth)/login" style={styles.link}>
          Войти
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
    marginTop: 10,
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
    marginTop: 20,
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