import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking, Vibration, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNotifications } from '../contexts/NotificationContext';
import { useTheme } from '../contexts/ThemeContext';
import * as Notifications from 'expo-notifications';

interface NotificationPermissionManagerProps {
  style?: any;
}

export const NotificationPermissionManager: React.FC<NotificationPermissionManagerProps> = ({ style }) => {
  const { theme } = useTheme();
  const [isRequesting, setIsRequesting] = useState(false);

  // Получаем контекст уведомлений; если провайдер отсутствует, используем пустой объект.
  // requestPermissions может быть undefined – в этом случае создаём безопасный заглушечный
  // async‑метод, который просто возвращает false (разрешения не получены).
  const {
    debugInfo = { hasPermission: false },
    requestPermissions: rp,
  } = useNotifications() || {};

  const requestPermissions = rp
    ? rp
    : async () => {
        // Нет провайдера – считаем, что разрешения не получены.
        return false;
      };

  // Обрабатываем уведомления, когда приложение находится в фокусе
  useEffect(() => {
    // Переменная для хранения подписки, если она будет создана
    let subscription: any = null;

    // Выполняем только на мобильных платформах
    if (Platform.OS !== 'web') {
      // Попытка установить глобальный обработчик уведомлений
      try {
        if (typeof Notifications.setNotificationHandler === 'function') {
          Notifications.setNotificationHandler({
            handleNotification: () => ({
              shouldShowAlert: false,
              shouldPlaySound: false,
              shouldSetBadge: false,
            }),
          });
        }
      } catch (e) {
        console.warn('Ошибка при установке NotificationHandler:', e);
      }

      // Попытка добавить слушатель получения уведомления
      try {
        if (typeof Notifications.addNotificationReceivedListener === 'function') {
          subscription = Notifications.addNotificationReceivedListener(() => {
            Vibration.vibrate();
          });
        }
      } catch (e) {
        console.warn('Ошибка при добавлении NotificationReceivedListener:', e);
      }
    }

    // Функция‑очистка, вызываемая при размонтировании компонента
    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  const handleRequestPermissions = async () => {
    setIsRequesting(true);
    try {
      const granted = await requestPermissions();
      if (!granted) {
        Alert.alert(
          'Разрешения не предоставлены',
          'Для получения уведомлений о новых сообщениях необходимо предоставить разрешения в настройках устройства.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Открыть настройки', onPress: () => Linking.openSettings() }
          ]
        );
      }
    } catch (error) {
      console.error('Error requesting permissions:', error);
    } finally {
      setIsRequesting(false);
    }
  };

  // Не показываем компонент, если разрешения уже получены.
  // Защищаемся от возможного undefined у debugInfo.
  if (debugInfo && debugInfo.hasPermission) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.surface }, style]}>
      <View style={styles.iconContainer}>
        <Ionicons name="notifications-off-outline" size={24} color={theme.error} />
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: theme.text }]}>
          Уведомления отключены
        </Text>
        <Text style={[styles.description, { color: theme.textSecondary }]}>
          Включите уведомления, чтобы не пропустить новые сообщения
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: theme.primary }]}
        onPress={handleRequestPermissions}
        disabled={isRequesting}
      >
        <Text style={[styles.buttonText, { color: theme.background }]}>
          {isRequesting ? 'Запрос...' : 'Включить'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    margin: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.3)',
  },
  iconContainer: {
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  description: {
    fontSize: 12,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    minWidth: 60,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
});