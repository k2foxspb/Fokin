import React, { useEffect, useState } from "react";
import { StyleSheet, ActivityIndicator } from "react-native";
import { Text, View } from "react-native";
import { router } from "expo-router";
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Index() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      
      if (token) {
        // Пользователь авторизован, перенаправляем на страницу новостей (feed)
        router.replace('/(tabs)/feed');
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
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Загрузка...</Text>
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
    color: "#007AFF",
    fontSize: 16,
  },
});