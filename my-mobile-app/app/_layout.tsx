import { Stack } from "expo-router";
import { useEffect } from "react";
import { useSegments, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NotificationProvider } from '../contexts/NotificationContext';

export default function RootLayout() {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const token = await AsyncStorage.getItem("userToken");

      const inAuthGroup = segments[0] === "(auth)";

      if (!token && !inAuthGroup) {
        // Перенаправляем на логин, если нет токена
        router.replace("/login");
      } else if (token && inAuthGroup) {
        // Перенаправляем на профиль, если есть токен
        router.replace("/(tabs)/feed");
      }
    };

    checkAuth();
  }, [segments]);

  return (
    <NotificationProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </NotificationProvider>
  );


}