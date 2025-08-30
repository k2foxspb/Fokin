import { Stack } from "expo-router";
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NotificationProvider } from '../contexts/NotificationContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { StyleSheet } from 'react-native';
import { useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import FirebaseNotificationService from '../services/firebaseNotificationService';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function RootLayout() {
  const navigationRef = useRef<any>(null);

  useEffect(() => {
    const setupFirebaseNavigation = async () => {
      try {
        const firebaseService = FirebaseNotificationService.getInstance();

        if (navigationRef.current) {
          firebaseService.setNavigationRef(navigationRef);
        } else {
          setTimeout(() => {
            if (navigationRef.current) {
              firebaseService.setNavigationRef(navigationRef);
            }
          }, 1000);
        }

        const checkBackgroundMessage = async () => {
          try {
            const lastMessageStr = await AsyncStorage.getItem('lastBackgroundMessage');

            if (lastMessageStr) {
              const lastMessage = JSON.parse(lastMessageStr);

              if (!lastMessage.processed) {
                await AsyncStorage.setItem('lastBackgroundMessage', JSON.stringify({
                  ...lastMessage,
                  processed: true
                }));
              }
            }
          } catch (error) {
            // Тихо обрабатываем ошибки
          }
        };

        await checkBackgroundMessage();
      } catch (error) {
        // Тихо обрабатываем ошибки
      }
    };

    const timer = setTimeout(() => {
      setupFirebaseNavigation();
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.container}>
        <ThemeProvider>
          <NotificationProvider>
            <Stack screenOptions={{ headerShown: false }} ref={navigationRef}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(main)" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="chat/[id]" />
              {/* Другие экраны */}
            </Stack>
          </NotificationProvider>
        </ThemeProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});