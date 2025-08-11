import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Pressable, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNotifications } from '../contexts/NotificationContext';

export const NotificationToast: React.FC = () => {
  const { messages, unreadCount } = useNotifications();
  const [visible, setVisible] = useState(false);
  const [messageDetails, setMessageDetails] = useState<string[]>([]);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));

  useEffect(() => {
    if (messages.length > 0 && unreadCount > 0) {
      // Формируем детальный список сообщений по отправителям
      const details = messages.map(msg => {
        const senderName = msg.sender_name || `Пользователь ${msg.sender_id}`;

        // Показываем последнее сообщение вместо количества
        let messagePreview = msg.last_message || 'Новое сообщение';

        // Обрезаем длинные сообщения
        if (messagePreview.length > 40) {
          messagePreview = messagePreview.substring(0, 40) + '...';
        }

        // Если сообщений больше одного, добавляем счетчик
        const countInfo = msg.count > 1 ? ` (+${msg.count - 1})` : '';

        return `${senderName}: ${messagePreview}${countInfo}`;
      });

      setMessageDetails(details);
      showToast();
    }
  }, [messages, unreadCount]);

  const showToast = () => {
    setVisible(true);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // Автоматически скрываем через 5 секунд
    setTimeout(() => {
      hideToast();
    }, 5000);
  };

  const hideToast = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 50,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
    });
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <Pressable style={styles.toast} onPress={hideToast}>
        <MaterialCommunityIcons name="message-text" size={24} color="#fff" />
        <View style={styles.contentContainer}>
          <Text style={styles.title}>Новые сообщения</Text>
          <ScrollView style={styles.messagesContainer} showsVerticalScrollIndicator={false}>
            {messageDetails.map((detail, index) => (
              <Text key={index} style={styles.messageDetail}>
                {detail}
              </Text>
            ))}
          </ScrollView>
          <Text style={styles.totalCount}>
            Всего: {messages.reduce((sum, msg) => sum + msg.count, 0)} непрочитанных
          </Text>
        </View>
        <MaterialCommunityIcons name="close" size={20} color="#fff" />
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    zIndex: 1000,
  },
  toast: {
    backgroundColor: '#670000',
    borderRadius: 8,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    maxHeight: 200,
  },
  contentContainer: {
    flex: 1,
    gap: 5,
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  messagesContainer: {
    maxHeight: 100,
    flex: 0,
  },
  messageDetail: {
    color: '#fff',
    fontSize: 13,
    opacity: 0.9,
    marginBottom: 2,
  },
  totalCount: {
    color: '#fff',
    fontSize: 12,
    fontStyle: 'italic',
    opacity: 0.8,
  },
});