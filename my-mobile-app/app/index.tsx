import React, { useEffect, useState } from "react";
import { StyleSheet, ActivityIndicator } from "react-native";
import { Text, View } from "react-native";
import { router } from "expo-router";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext';
import { setupAxiosInterceptors } from '../utils/axiosInterceptors';

export default function Index() {
  const { theme } = useTheme();

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Настраиваем axios interceptors
        setupAxiosInterceptors();

        // Проверяем токен
        const token = await AsyncStorage.getItem('userToken');

        if (token) {
          router.replace('/(main)/feed');
        } else {
          router.replace('/(auth)/login');
        }

      } catch (error) {
        // Ошибка при инициализации
        router.replace('/(auth)/login');
      }
    };

    initializeApp();
  }, []);

  // Показываем индикатор загрузки пока происходит перенаправление
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Загрузка...</Text>
    </View>
  );
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