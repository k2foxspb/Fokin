import React, { useEffect, useState } from "react";
import { StyleSheet, ActivityIndicator } from "react-native";
import { Text, View } from "react-native";
import { router } from "expo-router";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext';
import { setupAxiosInterceptors } from '../utils/axiosInterceptors';

export default function Index() {
  const [isLoading, setIsLoading] = useState(true);
  const { theme } = useTheme();

  useEffect(() => {
    // Настраиваем axios interceptors
    setupAxiosInterceptors();
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      
      if (token) {
        // Пользователь авторизован, перенаправляем на страницу новостей (feed)
        router.replace('/(main)/feed');
      } else {
        // Пользователь не авторизован, перенаправляем на страницу авторизации
        router.replace('/(auth)/login');
      }
    } catch (error) {
      console.error('Ошибка при проверке статуса авторизации:', error);
      // В случае ошибки перенаправляем на страницу авторизации
      router.replace('/(auth)/login');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Загрузка...</Text>
      </View>
    );
  }

  return null; // Этот компонент не должен отображаться, так как происходит перенаправление
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
  link: {
    fontSize: 16,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
});