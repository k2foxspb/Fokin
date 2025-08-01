import React, { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { API_CONFIG } from '../../config';

export default function ConfirmEmail() {
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const params = useLocalSearchParams();

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
          console.error('Error retrieving email:', error);
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

    setLoading(true);
    try {
      const response = await axios.post(
        `${API_CONFIG.BASE_URL}/authentication/api/verify-email/`,
        {
          email: email,
          verification_code: verificationCode,
        }
      );

      // Store token if provided
      if (response.data.token) {
        await AsyncStorage.setItem('userToken', response.data.token);
        axios.defaults.headers.common['Authorization'] = `Token ${response.data.token}`;
      }

      Alert.alert('Успех', 'Email успешно подтвержден!', [
        {
          text: 'OK',
          onPress: () => router.replace('/(main)/feed'),
        },
      ]);
    } catch (error) {
      let errorMessage = 'Произошла ошибка при подтверждении email';
      
      if (axios.isAxiosError(error) && error.response?.data) {
        const data = error.response.data;
        if (data.error) {
          errorMessage = data.error;
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
        { email: email }
      );
      
      Alert.alert('Успех', 'Новый код подтверждения отправлен на ваш email');
    } catch (error) {
      let errorMessage = 'Произошла ошибка при отправке кода';
      
      if (axios.isAxiosError(error) && error.response?.data) {
        const data = error.response.data;
        if (data.error) {
          errorMessage = data.error;
        }
      }
      
      Alert.alert('Ошибка', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Подтверждение Email</Text>
      
      <Text style={styles.description}>
        Мы отправили код подтверждения на адрес {email}.
        Пожалуйста, введите этот код ниже.
      </Text>
      
      <TextInput
        style={styles.input}
        placeholder="Код подтверждения"
        value={verificationCode}
        onChangeText={setVerificationCode}
        keyboardType="number-pad"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
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
        <Text style={styles.resendButtonText}>Отправить код повторно</Text>
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
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: '#666',
  },
  input: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    fontSize: 18,
    textAlign: 'center',
    letterSpacing: 5,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  resendButton: {
    padding: 10,
    alignItems: 'center',
  },
  resendButtonText: {
    color: '#007AFF',
    fontSize: 14,
  },
});