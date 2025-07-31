import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { useWebSocket } from '../hooks/useWebSocket';

// Настройка обработки уведомлений
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

interface NotificationContextType {
  expoPushToken: string | null;
  notification: Notifications.Notification | null;
  unreadCount: number;
  senderCounts: Map<number, number>;
  setUnreadCount: (count: number) => void;
  incrementUnreadCount: () => void;
  clearUnreadCount: () => void;
  setSenderCount: (senderId: number, count: number) => void;
  incrementSenderCount: (senderId: number) => void;
  clearSenderCount: (senderId: number) => void;
}

const NotificationContext = createContext<NotificationContextType>({
  expoPushToken: null,
  notification: null,
  unreadCount: 0,
  senderCounts: new Map(),
  setUnreadCount: () => {},
  incrementUnreadCount: () => {},
  clearUnreadCount: () => {},
  setSenderCount: () => {},
  incrementSenderCount: () => {},
  clearSenderCount: () => {},
});

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [senderCounts, setSenderCounts] = useState<Map<number, number>>(new Map());

  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);

  // 🔥 ПРОВЕРИМ ПОДКЛЮЧЕНИЕ К WebSocket
  const { connect, disconnect, isConnected } = useWebSocket(
    '/ws/notification/',
    {
      onOpen: () => {
        console.log('🌐 ✅ Notifications WebSocket CONNECTED');
      },
      onMessage: (event: MessageEvent) => {
        console.log('🔔 📨 WebSocket message received:', event.data);
        try {
          const data = JSON.parse(event.data);
          console.log('🔔 📊 Parsed WebSocket data:', data);

          if (data.type === 'messages_by_sender_update') {
            console.log('🔔 🔄 Processing messages_by_sender_update');
            console.log('🔔 📈 unique_sender_count:', data.unique_sender_count);
            console.log('🔔 📬 messages:', data.messages);

            // Обновляем общий счетчик
            if (typeof data.unique_sender_count === 'number') {
              console.log('🔔 ⚡ Setting unread count to:', data.unique_sender_count);
              setUnreadCountWithSave(data.unique_sender_count);
            }

            // Обновляем счетчики по отправителям
            if (data.messages && typeof data.messages === 'object') {
              setSenderCounts(prev => {
                const newMap = new Map();
                Object.entries(data.messages).forEach(([senderId, count]) => {
                  if (typeof count === 'number' && count > 0) {
                    newMap.set(Number(senderId), count);
                  }
                });
                console.log('🔔 🗺️ Updated sender counts:', newMap);
                return newMap;
              });
            }
          }
        } catch (error) {
          console.error('🔔 ❌ Error parsing WebSocket notification message:', error);
        }
      },
      onClose: () => {
        console.log('🌐 ❌ Notifications WebSocket DISCONNECTED');
      },
      onError: (error: Event) => {
        console.error('🌐 🚨 Notifications WebSocket ERROR:', error);
      }
    }
  );

  // Загрузка/сохранение счетчиков
  const loadUnreadCount = async () => {
    try {
      const saved = await AsyncStorage.getItem('unreadCount');
      if (saved) {
        const count = parseInt(saved, 10);
        const finalCount = isNaN(count) ? 0 : count;
        setUnreadCount(finalCount);
        console.log('📊 ✅ Loaded unread count from storage:', finalCount);
      }
    } catch (error) {
      console.error('📊 ❌ Error loading unread count:', error);
    }
  };

  const saveUnreadCount = async (count: number) => {
    try {
      await AsyncStorage.setItem('unreadCount', count.toString());
      console.log('💾 ✅ Saved unread count to storage:', count);
    } catch (error) {
      console.error('💾 ❌ Error saving unread count:', error);
    }
  };

  // Методы для работы с счетчиками
  const setSenderCount = (senderId: number, count: number) => {
    console.log('📤 Setting sender count:', senderId, '=', count);
    setSenderCounts(prev => {
      const newMap = new Map(prev);
      if (count > 0) {
        newMap.set(senderId, count);
      } else {
        newMap.delete(senderId);
      }
      return newMap;
    });
  };

  const incrementSenderCount = (senderId: number) => {
    console.log('⬆️ Incrementing sender count for:', senderId);
    setSenderCounts(prev => {
      const newMap = new Map(prev);
      const currentCount = newMap.get(senderId) || 0;
      const newCount = currentCount + 1;
      newMap.set(senderId, newCount);
      console.log('⬆️ New sender count:', senderId, '=', newCount);
      return newMap;
    });
  };

  const clearSenderCount = (senderId: number) => {
    console.log('🧹 Clearing sender count for:', senderId);
    setSenderCounts(prev => {
      const newMap = new Map(prev);
      newMap.delete(senderId);
      return newMap;
    });
  };

  const incrementUnreadCount = () => {
    console.log('⬆️ Incrementing unread count');
    setUnreadCount(prev => {
      const newCount = prev + 1;
      saveUnreadCount(newCount);
      console.log('⬆️ New unread count:', newCount);
      return newCount;
    });
  };

  const clearUnreadCount = () => {
    console.log('🧹 Clearing all unread counts');
    setUnreadCount(0);
    saveUnreadCount(0);
    setSenderCounts(new Map());
  };

  const setUnreadCountWithSave = (count: number) => {
    console.log('📝 Setting unread count with save:', count);
    setUnreadCount(count);
    saveUnreadCount(count);
  };

  // 🔥 ЛОГИРУЕМ ИЗМЕНЕНИЯ СОСТОЯНИЯ
  useEffect(() => {
    console.log('🔢 📊 NotificationProvider: unreadCount changed to:', unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    console.log('🔢 🗺️ NotificationProvider: senderCounts changed to:', senderCounts);
  }, [senderCounts]);

  // Регистрация push токена (упрощенная версия)
  async function registerForPushNotificationsAsync() {
    try {
      console.log('🔔 📝 Starting push notification registration...');

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
          sound: undefined,
          enableVibrate: true,
        });
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('❌ Push notification permissions not granted!');
        return null;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync();
      console.log('🎯 ✅ Expo Push Token obtained:', tokenData.data);
      return tokenData.data;
    } catch (error) {
      console.error('💥 Error during push notification setup:', error);
      return null;
    }
  }

  useEffect(() => {
    console.log('🚀 🔧 NotificationProvider: Setting up...');

    // Регистрация push токена
    registerForPushNotificationsAsync().then(token => {
      if (token) {
        setExpoPushToken(token);
        console.log('✅ Push token set successfully');
      }
    });

    // Загрузка сохраненного счетчика
    loadUnreadCount();

    // 🔥 Подключаем WebSocket для уведомлений
    console.log('🌐 🔌 Connecting to notifications WebSocket...');
    connect();

    // Обработчики push уведомлений
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('📢 === PUSH NOTIFICATION RECEIVED ===');
      setNotification(notification);

      const notificationData = notification.request.content.data;
      if (notificationData?.type === 'message' || notificationData?.message_type === 'chat') {
        console.log('💬 Processing chat message notification');
        incrementUnreadCount();

        const senderId = notificationData?.sender_id || notificationData?.from_user_id;
        if (senderId) {
          incrementSenderCount(Number(senderId));
        }
      }
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('👆 === NOTIFICATION RESPONSE ===');
    });

    return () => {
      console.log('🧹 NotificationProvider: Cleaning up...');
      disconnect();
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        expoPushToken,
        notification,
        unreadCount,
        senderCounts,
        setUnreadCount: setUnreadCountWithSave,
        incrementUnreadCount,
        clearUnreadCount,
        setSenderCount,
        incrementSenderCount,
        clearSenderCount,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};