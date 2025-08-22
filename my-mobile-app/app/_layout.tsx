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
    // Предварительная инициализация Firebase сервиса для настройки навигации
    const setupFirebaseNavigation = async () => {
      try {
        console.log('📱 [App] Setting up Firebase navigation reference...');

        const firebaseService = FirebaseNotificationService.getInstance();

        // Устанавливаем ссылку на навигацию для обработки deep links
        if (navigationRef.current) {
          firebaseService.setNavigationRef(navigationRef);
          console.log('📱 [App] Navigation reference set for Firebase service');
        } else {
          // Пробуем установить ссылку через небольшую задержку
          setTimeout(() => {
            if (navigationRef.current) {
              firebaseService.setNavigationRef(navigationRef);
              console.log('📱 [App] Navigation reference set for Firebase service (delayed)');
            } else {
              console.warn('📱 [App] Navigation reference still not available');
            }
          }, 1000);
        }

        // Проверяем есть ли необработанные фоновые сообщения
        const checkBackgroundMessage = async () => {
          try {
            const lastMessageStr = await AsyncStorage.getItem('lastBackgroundMessage');

            if (lastMessageStr) {
              const lastMessage = JSON.parse(lastMessageStr);

              if (!lastMessage.processed) {
                console.log('📱 [App] Found unprocessed background message:', lastMessage);

                // Помечаем как обработанное
                await AsyncStorage.setItem('lastBackgroundMessage', JSON.stringify({
                  ...lastMessage,
                  processed: true
                }));

                console.log('📱 [App] Background message marked as processed');
              }
            }
          } catch (error) {
            console.error('📱 [App] Error checking background message:', error);
          }
        };

        await checkBackgroundMessage();

      } catch (error) {
        console.error('📱 [App] Error setting up Firebase navigation:', error);
      }
    };

    // Небольшая задержка для инициализации навигации
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