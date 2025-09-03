// Firebase background message handler
// Обрабатывает push-уведомления когда приложение в фоне или закрыто

import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  try {
    // КРИТИЧНО: В background handler Firebase автоматически показывает системное уведомление
    // Мы НЕ должны создавать дополнительные уведомления здесь
    console.log('🔥 [FCM-BG] ✅ System notification will be shown automatically by Firebase');

    // Сохраняем данные для обработки при возврате в приложение
    if (remoteMessage.data?.type === 'message_notification') {
      const messageInfo = {
        chatId: remoteMessage.data.chatId,
        senderId: remoteMessage.data.senderId,
        timestamp: Date.now(),
        processed: false,
        messageId: remoteMessage.messageId || '',
        notificationTitle: remoteMessage.notification?.title || 'Новое сообщение',
        notificationBody: remoteMessage.notification?.body || '',
      };

      await AsyncStorage.setItem('lastBackgroundMessage', JSON.stringify(messageInfo));
      console.log('🔥 [FCM-BG] ✅ Background message data saved for app resume handling');
    }

    // Обновляем счетчик badge
    try {
      // Используем Expo Notifications для badge (более надежно)
      const { getDefaultExpoNotificationsModule } = require('expo-notifications');
      const NotificationsModule = getDefaultExpoNotificationsModule();

      if (NotificationsModule) {
        const currentBadge = await NotificationsModule.getBadgeCountAsync();
        const newBadge = (currentBadge || 0) + 1;
        await NotificationsModule.setBadgeCountAsync(newBadge);
        console.log('🔥 [FCM-BG] ✅ Badge updated:', currentBadge, '->', newBadge);
      }
    } catch (badgeError) {
      console.log('🔥 [FCM-BG] Badge update failed (this is normal):', badgeError.message);
    }

    // Логируем успешную обработку
    console.log('🔥 [FCM-BG] ✅ Background message handled successfully');

    // ВАЖНО: Возвращаем Promise.resolve() для корректного завершения
    return Promise.resolve();

  } catch (error) {
    console.error('🔥 [FCM-BG] ❌ Error handling background message:', error);
    return Promise.resolve(); // Всегда возвращаем resolved promise
  }
});

console.log('🔥 [FCM-BG] ✅ Background message handler registered and ready');
