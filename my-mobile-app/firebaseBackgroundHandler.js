// Firebase background message handler
// Обрабатывает push-уведомления когда приложение в фоне или закрыто

import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Platform} from "react-native";

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('🔥 [FCM] Background message received:', remoteMessage);

  try {
    // Сохраняем информацию о фоновом сообщении для обработки при открытии приложения
    if (remoteMessage.data?.type === 'message_notification') {
      const messageInfo = {
        chatId: remoteMessage.data.chatId,
        senderId: remoteMessage.data.senderId,
        timestamp: Date.now(),
        processed: false,
        messageId: remoteMessage.messageId || ''
      };

      await AsyncStorage.setItem('lastBackgroundMessage', JSON.stringify(messageInfo));
      console.log('🔥 [FCM] Background message info saved');
    }

    // Увеличиваем счётчик badge (если доступно)
    if (Platform.OS === 'ios') {
      // iOS badge обработка
      const currentBadge = await messaging().getApplicationBadge();
      await messaging().setApplicationBadge(currentBadge + 1);
    }

  } catch (error) {
    console.error('🔥 [FCM] Error handling background message:', error);
  }
});

console.log('🔥 [FCM] Background message handler registered');
