import React, { useEffect, useState } from 'react';
import { View, TextInput, TouchableOpacity, FlatList, Text, StyleSheet } from 'react-native';
import { useWebSocket } from '@/hooks/useWebSocket';

interface Message {
  id: number;
  message: string;
  sender__username: string;
  timestamp: number;
}

interface MessagesProps {
  roomId: string;
  user1Id: number;
  user2Id: number;
}

export const Messages: React.FC<MessagesProps> = ({ roomId, user1Id, user2Id }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');

  const { connect, disconnect, sendMessage, isConnected } = useWebSocket(
    `/chat/ws/private/${roomId}/`,
    {
      onOpen: () => {
        console.log('Чат подключен');
      },
      onMessage: (event) => {
        const data = JSON.parse(event.data);
        if (!data.error) {
          setMessages((prev) => [...prev, data]);
        } else {
          console.error('Ошибка сообщения:', data.error);
        }
      },
      onClose: () => {
        console.log('Чат отключен');
      },
      onError: (error) => {
        console.error('Ошибка чата:', error);
      },
    }
  );

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  const handleSendMessage = () => {
    if (newMessage.trim() && isConnected()) {
      console.log(`Sending message with user1Id: ${user1Id}, user2Id: ${user2Id}`);
      sendMessage({
        message: newMessage.trim(),
        timestamp: Math.floor(Date.now() / 1000),
        user1: user1Id,
        user2: user2Id,
      });
      setNewMessage('');
    }
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <View
      style={styles.messageContainer}
    >
      <Text style={styles.username}>{item.sender__username}</Text>
      <Text style={styles.messageText}>{item.message}</Text>
      <Text style={styles.timestamp}>
        {new Date(item.timestamp * 1000).toLocaleTimeString()}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id.toString()}
        style={styles.messagesList}
      />
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={newMessage}
          onChangeText={setNewMessage}
          placeholder="Введите сообщение..."
          placeholderTextColor="#666"
        />
        <TouchableOpacity
          style={styles.sendButton}
          onPress={handleSendMessage}
        >
          <Text style={styles.sendButtonText}>Отправить</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  messagesList: {
    flex: 1,
    padding: 10,
  },
  messageContainer: {
    padding: 10,
    marginVertical: 5,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    maxWidth: '80%',
  },
  username: {
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
    color: '#333',
  },
  messageText: {
    fontSize: 16,
    color: '#000',
  },
  timestamp: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    marginRight: 10,
    padding: 10,
    backgroundColor: '#f8f8f8',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
    color: '#000',
  },
  sendButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
  },
});