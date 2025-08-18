import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, usePathname } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';

interface AuthGuardProps {
  children: React.ReactNode;
}

const PUBLIC_ROUTES = [
  '/(auth)/login',
  '/(auth)/register', 
  '/(auth)/forgot-password',
  '/(auth)/confirm-email',
  '/index'
];

export default function AuthGuard({ children }: AuthGuardProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const pathname = usePathname();
  const { theme } = useTheme();

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');

      if (token) {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);

        // Если пользователь не авторизован и находится на защищенном маршруте
        if (!PUBLIC_ROUTES.includes(pathname) && !pathname.startsWith('/(auth)')) {
          router.replace('/(auth)/login');
        }
      }
    } catch (error) {
      console.error('Ошибка при проверке авторизации:', error);
      setIsAuthenticated(false);
      router.replace('/(auth)/login');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <View style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: theme.background
      }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  // Если пользователь не авторизован и пытается получить доступ к защищенному маршруту
  if (!isAuthenticated && !PUBLIC_ROUTES.includes(pathname) && !pathname.startsWith('/(auth)')) {
    return null; // Компонент не отображается, происходит перенаправление
  }

  return <>{children}</>;
}
