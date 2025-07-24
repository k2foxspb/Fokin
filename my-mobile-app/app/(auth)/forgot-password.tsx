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
import { Link } from "expo-router";

const API_URL = 'http://localhost:8000';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handlePasswordReset = async () => {
    if (!email.trim()) {
      Alert.alert('Ошибка', 'Введите email адрес');
      return;
    }

    if (!validateEmail(email.trim())) {
      Alert.alert('Ошибка', 'Введите корректный email адрес');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${API_URL}/authentication/api/password-reset/`, {
        email: email.trim(),
      });

      setEmailSent(true);
      Alert.alert(
        'Успех', 
        'Инструкции по восстановлению пароля отправлены на ваш email',
        [{ text: 'OK' }]
      );
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; email?: string[] }>;
      let errorMessage = 'Произошла ошибка при отправке запроса';
      
      if (axiosError.response?.data) {
        const data = axiosError.response.data;
        if (data.error) {
          errorMessage = data.error;
        } else if (data.email) {
          errorMessage = `Email: ${data.email[0]}`;
        }
      }
      
      Alert.alert('Ошибка', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) {
    return (
      <View style={styles.container}>
        <View style={styles.successContainer}>
          <Text style={styles.successTitle}>Письмо отправлено!</Text>
          <Text style={styles.successText}>
            Мы отправили инструкции по восстановлению пароля на адрес:
          </Text>
          <Text style={styles.emailText}>{email}</Text>
          <Text style={styles.instructionText}>
            Проверьте свою почту и следуйте инструкциям в письме для восстановления пароля.
          </Text>
          <Text style={styles.noteText}>
            Не получили письмо? Проверьте папку "Спам" или попробуйте еще раз.
          </Text>
          
          <TouchableOpacity 
            style={styles.button} 
            onPress={() => {
              setEmailSent(false);
              setEmail('');
            }}
          >
            <Text style={styles.buttonText}>Отправить еще раз</Text>
          </TouchableOpacity>
          
          <View style={styles.linkContainer}>
            <Link href="/(auth)/login" style={styles.link}>
              Вернуться к входу
            </Link>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Восстановление пароля</Text>
      <Text style={styles.subtitle}>
        Введите ваш email адрес и мы отправим вам инструкции по восстановлению пароля
      </Text>
      
      <TextInput
        style={styles.input}
        placeholder="Email адрес"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        editable={!loading}
      />
      
      <TouchableOpacity 
        style={[styles.button, loading && styles.disabledButton]} 
        onPress={handlePasswordReset}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>Отправить инструкции</Text>
        )}
      </TouchableOpacity>
      
      <View style={styles.linkContainer}>
        <Text style={styles.linkText}>Вспомнили пароль? </Text>
        <Link href="/(auth)/login" style={styles.link}>
          Войти
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
    marginBottom: 15,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: '#666',
    lineHeight: 22,
  },
  input: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
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
  successContainer: {
    alignItems: 'center',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 20,
    textAlign: 'center',
  },
  successText: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    marginBottom: 10,
  },
  emailText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#007AFF',
    textAlign: 'center',
    marginBottom: 20,
  },
  instructionText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 15,
  },
  noteText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 30,
  },
});