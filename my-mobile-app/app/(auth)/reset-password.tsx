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
  error: string;
}

export default function ResetPassword() {
  const { theme } = useTheme();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const params = useLocalSearchParams();

  const styles = createStyles(theme);

  const uid = params.uid as string;
  const token = params.token as string;

  useEffect(() => {
    if (!uid || !token) {
      Alert.alert('Ошибка', 'Неверная ссылка для сброса пароля', [
        {
          text: 'OK',
          onPress: () => router.replace('/(auth)/login'),
        },
      ]);
    }
  }, [uid, token]);

  const handleResetPassword = async () => {
    if (!newPassword.trim()) {
      Alert.alert('Ошибка', 'Введите новый пароль');
      return;
    }

    if (!confirmPassword.trim()) {
      Alert.alert('Ошибка', 'Подтвердите новый пароль');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Ошибка', 'Пароли не совпадают');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Ошибка', 'Пароль должен содержать минимум 6 символов');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(
        `${API_CONFIG.BASE_URL}/authentication/api/reset-password-confirm/`,
        {
          uid: uid,
          token: token,
          new_password: newPassword,
          confirm_password: confirmPassword,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );

      Alert.alert('Успех', 'Пароль успешно изменен!', [
        {
          text: 'OK',
          onPress: () => router.replace('/(auth)/login'),
        },
      ]);
    } catch (error) {
      let errorMessage = 'Произошла ошибка при изменении пароля';

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ 
          error?: string; 
          detail?: string;
          new_password?: string[];
          non_field_errors?: string[];
        }>;

        if (axiosError.response?.data) {
          const data = axiosError.response.data;
          if (data.error) {
            errorMessage = data.error;
          } else if (data.detail) {
            errorMessage = data.detail;
          } else if (data.new_password) {
            errorMessage = `Пароль: ${data.new_password[0]}`;
          } else if (data.non_field_errors) {
            errorMessage = data.non_field_errors[0];
          }
        }
      }

      Alert.alert('Ошибка', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Новый пароль</Text>
      <Text style={styles.subtitle}>
        Введите новый пароль для вашего аккаунта
      </Text>

      <Text style={styles.label}>Новый пароль *</Text>
      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder="Введите новый пароль"
        placeholderTextColor={theme.placeholder}
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />

      <Text style={styles.label}>Подтвердите пароль *</Text>
      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder="Повторите новый пароль"
        placeholderTextColor={theme.placeholder}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />

      <TouchableOpacity 
        style={[styles.button, loading && styles.disabledButton]} 
        onPress={handleResetPassword}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>Изменить пароль</Text>
        )}
      </TouchableOpacity>

      <View style={styles.linkContainer}>
        <Text style={styles.linkText}>Вспомнили пароль? </Text>
        <Link href="/(auth)/login" style={styles.link}>
          Войти
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
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 5,
    color: theme.text,
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
});
