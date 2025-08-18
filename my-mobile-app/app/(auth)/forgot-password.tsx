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
import { router } from 'expo-router';
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
  success: string;
  error: string;
}

export default function ForgotPassword() {
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const styles = createStyles(theme);

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
      await axios.post(`${API_CONFIG.BASE_URL}/authentication/api/password-reset/`, {
        email: email.trim(),
      });

      setEmailSent(true);
      Alert.alert(
        'Успех', 
        'Код восстановления пароля отправлен на ваш email',
        [
          { 
            text: 'OK',
            onPress: () => {
              router.push({
                pathname: '/(auth)/reset-password-with-code',
                params: { email: email.trim() }
              });
            }
          }
        ]
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
            Мы отправили код восстановления пароля на адрес:
          </Text>
          <Text style={styles.emailText}>{email}</Text>
          <Text style={styles.instructionText}>
            Проверьте свою почту и введите полученный код в приложении для восстановления пароля.
          </Text>
          <Text style={styles.noteText}>
            Не получили письмо? Проверьте папку "Спам" или попробуйте еще раз.
          </Text>

          <TouchableOpacity 
            style={styles.button} 
            onPress={() => {
              router.push({
                pathname: '/(auth)/reset-password-with-code',
                params: { email: email }
              });
            }}
          >
            <Text style={styles.buttonText}>Ввести код</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.button, { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.primary }]} 
            onPress={() => {
              setEmailSent(false);
              setEmail('');
            }}
          >
            <Text style={[styles.buttonText, { color: theme.primary }]}>Отправить еще раз</Text>
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
        style={[styles.input, { color: theme.text }]}
        placeholder="Email адрес"
        placeholderTextColor={theme.placeholder}
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
        <Text style={styles.linkText}>Уже есть код? </Text>
        <Link href="/(auth)/reset-password-with-code" style={styles.link}>
          Ввести код
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
    marginBottom: 15,
    color: theme.text,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: theme.textSecondary,
    lineHeight: 22,
  },
  input: {
    backgroundColor: theme.surface,
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
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
  successContainer: {
    alignItems: 'center',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.success || theme.primary,
    marginBottom: 20,
    textAlign: 'center',
  },
  successText: {
    fontSize: 16,
    color: theme.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  emailText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.primary,
    textAlign: 'center',
    marginBottom: 20,
  },
  instructionText: {
    fontSize: 16,
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 15,
  },
  noteText: {
    fontSize: 14,
    color: theme.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 30,
  },
});