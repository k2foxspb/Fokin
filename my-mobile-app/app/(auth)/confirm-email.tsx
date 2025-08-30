import React, { useState, useEffect } from 'react';
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
import { router, useLocalSearchParams } from 'expo-router';
import { Link } from 'expo-router';
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

export default function ConfirmEmail() {
  const { theme } = useTheme();
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const params = useLocalSearchParams();

  const styles = createStyles(theme);

  useEffect(() => {
    // Get email from params or AsyncStorage
    const getEmail = async () => {
      if (params.email) {
        setEmail(params.email as string);
      } else {
        try {
          const userDataString = await AsyncStorage.getItem('userData');
          if (userDataString) {
            const userData = JSON.parse(userDataString);
            setEmail(userData.email || '');
          }
        } catch (error) {
          // Ошибка получения email
        }
      }
    };

    getEmail();
  }, [params.email]);

  const handleVerify = async () => {
    if (!verificationCode.trim()) {
      Alert.alert('Ошибка', 'Введите код подтверждения');
      return;
    }

    if (!email.trim()) {
      Alert.alert('Ошибка', 'Email не найден');
      return;
    }

    setLoading(true);
    try {
      console.log('Отправка запроса на подтверждение:', {
        email: email,
        verification_code: verificationCode.trim()
      });

      // Основной запрос подтверждения и активации
      const response = await axios.post(
        `${API_CONFIG.BASE_URL}/authentication/api/verify-email/`,
        {
          email: email.trim(),
          verification_code: verificationCode.trim(),
        },
        {
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );

      console.log('Ответ сервера:', response.data);

      // Store token if provided
      if (response.data.token) {
        await AsyncStorage.setItem('userToken', response.data.token);
        axios.defaults.headers.common['Authorization'] = `Token ${response.data.token}`;
      }

      // Update user data if provided
      if (response.data.user) {
        await AsyncStorage.setItem('userData', JSON.stringify(response.data.user));
      }

      Alert.alert('Успех', 'Email подтвержден и аккаунт активирован!', [
        {
          text: 'OK',
          onPress: () => router.replace('/(main)/feed'),
        },
      ]);
    } catch (error) {
      console.error('Ошибка подтверждения:', error);

      let errorMessage = 'Произошла ошибка при подтверждении email';

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ 
          error?: string; 
          detail?: string;
          verification_code?: string[];
          email?: string[];
          non_field_errors?: string[];
        }>;

        console.log('Статус ошибки:', axiosError.response?.status);
        console.log('Данные ошибки:', axiosError.response?.data);

        if (axiosError.response?.data) {
          const data = axiosError.response.data;
          if (data.error) {
            errorMessage = data.error;
          } else if (data.detail) {
            errorMessage = data.detail;
          } else if (data.verification_code) {
            errorMessage = `Код подтверждения: ${data.verification_code[0]}`;
          } else if (data.email) {
            errorMessage = `Email: ${data.email[0]}`;
          } else if (data.non_field_errors) {
            errorMessage = data.non_field_errors[0];
          }
        }

        // Дополнительная попытка активации при ошибке
        if (axiosError.response?.status === 400 && errorMessage.toLowerCase().includes('код')) {
          // Если проблема с кодом, не пытаемся активировать
        } else {
          try {
            console.log('Попытка принудительной активации пользователя...');
            const activateResponse = await axios.post(
              `${API_CONFIG.BASE_URL}/authentication/api/activate-user/`,
              {
                email: email.trim(),
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                }
              }
            );

            console.log('Принудительная активация успешна:', activateResponse.data);

            Alert.alert('Успех', 'Аккаунт активирован!', [
              {
                text: 'OK',
                onPress: () => router.replace('/(main)/feed'),
              },
            ]);
            return;

          } catch (activationError) {
            // Ошибка принудительной активации
          }
        }
      }

      Alert.alert('Ошибка', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!email) {
      Alert.alert('Ошибка', 'Email не найден');
      return;
    }

    setLoading(true);
    try {
      await axios.post(
        `${API_CONFIG.BASE_URL}/authentication/api/resend-verification/`,
        { email: email.trim() },
        {
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );

      Alert.alert('Успех', 'Новый код подтверждения отправлен на ваш email');
      setVerificationCode(''); // Очищаем поле ввода
    } catch (error) {
      let errorMessage = 'Произошла ошибка при отправке кода';

      if (axios.isAxiosError(error) && error.response?.data) {
        const data = error.response.data;
        if (data.error) {
          errorMessage = data.error;
        } else if (data.detail) {
          errorMessage = data.detail;
        }
      }

      Alert.alert('Ошибка', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Подтверждение Email</Text>

      <Text style={styles.description}>
        Мы отправили код подтверждения на адрес:
      </Text>
      <Text style={styles.emailText}>{email}</Text>
      <Text style={styles.description}>
        Пожалуйста, введите этот код ниже.
      </Text>

      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder="Введите код подтверждения"
        placeholderTextColor={theme.placeholder}
        value={verificationCode}
        onChangeText={setVerificationCode}
        keyboardType="number-pad"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
        maxLength={6}
      />

      <TouchableOpacity 
        style={[styles.button, loading && styles.disabledButton]} 
        onPress={handleVerify}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>Подтвердить</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.resendButton} 
        onPress={handleResendCode}
        disabled={loading}
      >
        <Text style={[styles.resendButtonText, { color: theme.primary }]}>
          Отправить код повторно
        </Text>
      </TouchableOpacity>

      <View style={styles.linkContainer}>
        <Text style={styles.linkText}>Проблемы с подтверждением? </Text>
        <Link href="/(auth)/login" style={styles.link}>
          Вернуться к входу
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
    marginBottom: 20,
    color: theme.text,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 15,
    color: theme.textSecondary,
    lineHeight: 22,
  },
  emailText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 15,
    color: theme.primary,
  },
  input: {
    backgroundColor: theme.surface,
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    fontSize: 18,
    textAlign: 'center',
    letterSpacing: 3,
    borderWidth: 1,
    borderColor: theme.border,
  },
  button: {
    backgroundColor: theme.primary,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
  },
  disabledButton: {
    backgroundColor: theme.textSecondary,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  resendButton: {
    padding: 15,
    alignItems: 'center',
    marginBottom: 20,
  },
  resendButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  linkContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 10,
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