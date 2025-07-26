
import React, {useState, useEffect, useRef} from 'react';
import {
    View,
    TextInput,
    StyleSheet,
    Text,
    Pressable,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Alert,
    ActivityIndicator,
} from 'react-native';
import {Stack, useLocalSearchParams, useRouter} from 'expo-router';
import {useWebSocket} from '../../hooks/useWebSocket';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {MaterialIcons} from '@expo/vector-icons';
import { API_CONFIG } from '../../config';

interface Message {
    id: number;
    message: string;
    timestamp: number | string;
    sender__username: string;
    sender_id?: number;
}

interface User {
    id: number;
    username: string;
    avatar?: string;
}

// Функция для безопасного форматирования времени
const formatTimestamp = (timestamp: number | string | undefined): string => {
    if (!timestamp) {
        console.warn('Empty timestamp provided');
        return '--:--';
    }

    try {
        let date: Date;

        if (typeof timestamp === 'string') {
            // Если это строка, пробуем несколько форматов
            if (timestamp.includes('.') && timestamp.includes(',')) {
                // Формат "25.07.2025, 15:30:00" из Django
                const cleanTimestamp = timestamp.replace(',', '');
                const parts = cleanTimestamp.split(' ');
                if (parts.length >= 2) {
                    const datePart = parts[0].split('.').reverse().join('-'); // DD.MM.YYYY -> YYYY-MM-DD
                    const timePart = parts[1];
                    date = new Date(`${datePart}T${timePart}`);
                } else {
                    date = new Date(timestamp);
                }
            } else if (timestamp.includes('-') && timestamp.includes('T')) {
                // ISO формат
                date = new Date(timestamp);
            } else {
                // Пробуем парсить как число
                const numTimestamp = parseFloat(timestamp);
                if (!isNaN(numTimestamp)) {
                    date = new Date(numTimestamp < 1e10 ? numTimestamp * 1000 : numTimestamp);
                } else {
                    date = new Date(timestamp);
                }
            }
        } else if (typeof timestamp === 'number') {
            // Если timestamp в секундах (меньше 1e10), умножаем на 1000
            date = new Date(timestamp < 1e10 ? timestamp * 1000 : timestamp);
        } else {
            console.warn('Unknown timestamp format:', timestamp);
            return '--:--';
        }

        // Проверяем валидность даты
        if (isNaN(date.getTime())) {
            console.warn('Invalid date from timestamp:', timestamp);
            return '--:--';
        }

        return date.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        console.error('Error formatting timestamp:', timestamp, error);
        return '--:--';
    }
};

export default function ChatScreen() {
    const {id: roomId} = useLocalSearchParams();
    const [messages, setMessages] = useState<Message[]>([]);
    const [messageText, setMessageText] = useState('');
    const [currentUsername, setCurrentUsername] = useState('');
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [recipient, setRecipient] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isConnected, setIsConnected] = useState(false);
    const [isDataLoaded, setIsDataLoaded] = useState(false);
    const flatListRef = useRef<FlatList>(null);
    const router = useRouter();

    // Отладочная информация
    useEffect(() => {
        console.log('=== CURRENT USER INFO ===');
        console.log('Current Username:', currentUsername);
        console.log('Current User ID:', currentUserId);
        console.log('=== MESSAGES ===');
        messages.forEach((msg, index) => {
            console.log(`Message ${index}:`, {
                id: msg.id,
                sender__username: msg.sender__username,
                sender_id: msg.sender_id,
                timestamp: msg.timestamp,
                isMyMessage: msg.sender_id === currentUserId
            });
        });
    }, [messages, currentUserId, currentUsername]);

    // WebSocket хук с дополнительной отладкой
    const {connect, disconnect, sendMessage, isConnected: wsIsConnected, reconnect} = useWebSocket(
        `/wss/private/${roomId}/`,
        {
            onOpen: () => {
                console.log('=== WebSocket CONNECTED ===');
                console.log('Room ID:', roomId);
                setIsConnected(true);
            },
            onMessage: (event: any) => {
                console.log('=== WebSocket MESSAGE RECEIVED ===');
                console.log('Raw data:', event.data);

                try {
                    const data = JSON.parse(event.data);
                    console.log('Parsed data:', data);

                    // Игнорируем системные сообщения
                    if (data.type === 'messages_by_sender_update') {
                        console.log('Ignoring system message');
                        return;
                    }

                    // Обработка ошибок от consumer
                    if (data.error) {
                        console.error('WebSocket error:', data.error);
                        Alert.alert('Ошибка', data.error);
                        return;
                    }

                    // Обработка сообщений чата
                    if (data.message) {
                        console.log('Processing chat message:', data);

                        const newMessage: Message = {
                            id: data.id || Date.now(),
                            message: data.message,
                            timestamp: data.timestamp || Math.floor(Date.now() / 1000),
                            sender__username: data.sender__username,
                            sender_id: data.sender_id
                        };

                        console.log('New message object:', newMessage);

                        setMessages(prev => {
                            // Проверяем, нет ли уже такого сообщения
                            const exists = prev.some(msg => msg.id === newMessage.id);
                            if (!exists) {
                                console.log('Adding new message to list');
                                return [...prev, newMessage];
                            } else {
                                console.log('Message already exists, not adding');
                            }
                            return prev;
                        });

                        // Скроллим вниз при получении нового сообщения
                        setTimeout(() => {
                            flatListRef.current?.scrollToEnd({animated: true});
                        }, 100);
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            },
            onClose: () => {
                setIsConnected(false);
            },
            onError: (error: any) => {
                console.error('=== WebSocket ERROR ===');
                console.error('Error:', error);
                setIsConnected(false);

                // Попытка переподключения через 3 секунды
                setTimeout(() => {
                    if (!wsIsConnected()) {
                        console.log('Attempting to reconnect...');
                        reconnect();
                    }
                }, 3000);
            }
        }
    );

    // Получение токена
    const getToken = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
                Alert.alert('Ошибка', 'Необходимо войти в систему');
                router.replace('/login');
                return null;
            }
            return token;
        } catch (error) {
            console.error('Error getting token:', error);
            return null;
        }
    };

    // Получение информации о текущем пользователе
    const fetchCurrentUser = async () => {
        try {
            const token = await getToken();
            if (!token) return null;

            console.log('Fetching current user from:', `${API_CONFIG.BASE_URL}/profile/api/profile/me/`);

            const response = await axios.get(
                `${API_CONFIG.BASE_URL}/profile/api/profile/me/`,
                {
                    headers: {'Authorization': `Token ${token}`}
                }
            );

            console.log('Current user response:', response.data);

            const userData = {
                id: response.data.id,
                username: response.data.username
            };

            setCurrentUsername(userData.username);
            setCurrentUserId(userData.id);
            console.log('Current user loaded:', userData.username, 'id:', userData.id);

            return userData;
        } catch (error) {
            console.error('Error fetching current user:', error);
            if (axios.isAxiosError(error)) {
                console.error('Response status:', error.response?.status);
                console.error('Response data:', error.response?.data);
                console.error('Request URL:', error.config?.url);
            }
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                Alert.alert('Ошибка', 'Сессия истекла. Войдите снова.');
                router.replace('/login');
            } else {
                Alert.alert('Ошибка', 'Не удалось загрузить данные пользователя');
            }
            return null;
        }
    };

    // Получение информации о получателе
    const fetchRecipientInfo = async () => {
        try {
            const token = await getToken();
            if (!token) return null;

            const response = await axios.get(
                `${API_CONFIG.BASE_URL}/chat/api/room/${roomId}/info/`,
                {
                    headers: {'Authorization': `Token ${token}`}
                }
            );

            const recipientData = {
                id: response.data.other_user.id,
                username: response.data.other_user.username,
                avatar: response.data.other_user.avatar
            };

            setRecipient(recipientData);
            console.log('Recipient info loaded:', recipientData);

            return recipientData;
        } catch (error) {
            console.error('Error fetching recipient info:', error);
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                Alert.alert('Ошибка', 'Сессия истекла. Войдите снова.');
                router.replace('/login');
            }
            return null;
        }
    };

    // Получение истории сообщений
    const fetchChatHistory = async () => {
        try {
            const token = await getToken();
            if (!token) return;

            const response = await axios.get(
                `${API_CONFIG.BASE_URL}/profile/api/chat_history/${roomId}/`,
                {
                    headers: {
                        'Authorization': `Token ${token}`,
                        'Content-Type': 'application/json',
                    }
                }
            );

            if (response.data && response.data.messages) {
                console.log('Raw messages from API:', response.data.messages);

                // Обрабатываем каждое сообщение для корректного формата timestamp
                const processedMessages = response.data.messages.map((msg: any) => ({
                    ...msg,
                    timestamp: msg.timestamp // Оставляем как есть, форматирование в UI
                }));

                setMessages(processedMessages);
                console.log('Chat history loaded:', processedMessages.length, 'messages');

                // Скроллим вниз после загрузки истории
                setTimeout(() => {
                    flatListRef.current?.scrollToEnd({animated: false});
                }, 100);
            }
        } catch (error) {
            console.error('Error loading chat history:', error);
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                Alert.alert('Ошибка', 'Сессия истекла. Войдите снова.');
                router.replace('/login');
            }
        }
    };

    // Инициализация чата
    useEffect(() => {
        if (!roomId) {
            console.error('Room ID is missing');
            router.back();
            return;
        }

        const initializeChat = async () => {
            setIsLoading(true);
            try {
                console.log('=== INITIALIZING CHAT ===');

                // Получаем все данные последовательно
                const currentUser = await fetchCurrentUser();
                const recipientInfo = await fetchRecipientInfo();
                await fetchChatHistory();

                // Проверяем, что данные загружены
                if (currentUser && recipientInfo) {
                    console.log('All data loaded successfully, connecting to WebSocket...');
                    setIsDataLoaded(true);

                    // Подключаемся к WebSocket только после загрузки всех данных
                    setTimeout(() => {
                        connect();
                    }, 100);
                } else {
                    console.error('Failed to load required data');
                    Alert.alert('Ошибка', 'Не удалось загрузить необходимые данные');
                }

            } catch (error) {
                console.error('Error initializing chat:', error);
                Alert.alert('Ошибка', 'Не удалось загрузить чат');
            } finally {
                setIsLoading(false);
            }
        };

        initializeChat();

        return () => {
            console.log('Cleaning up chat screen');
            disconnect();
        };
    }, [roomId]);

    // Отправка сообщения
    const handleSend = () => {
        console.log('=== SENDING MESSAGE ===');
        console.log('Message text:', messageText);
        console.log('Is connected:', isConnected);
        console.log('Is data loaded:', isDataLoaded);
        console.log('Current user ID:', currentUserId);
        console.log('Recipient ID:', recipient?.id);

        if (!messageText.trim()) {
            console.log('Message is empty, aborting');
            return;
        }

        if (!isConnected) {
            console.log('Not connected, aborting');
            Alert.alert('Ошибка', 'Нет соединения с сервером');
            return;
        }

        if (!isDataLoaded) {
            console.log('Data not loaded yet, aborting');
            Alert.alert('Ошибка', 'Данные еще загружаются');
            return;
        }

        if (!recipient?.id || !currentUserId) {
            console.log('Missing recipient or current user ID, aborting');
            console.log('Recipient:', recipient);
            console.log('Current user ID:', currentUserId);
            Alert.alert('Ошибка', 'Недостаточно данных для отправки сообщения');
            return;
        }

        const timestamp = Math.floor(Date.now() / 1000);

        // Формируем данные в том формате, который ожидает consumer
        const messageData = {
            message: messageText.trim(),
            timestamp: timestamp,
            user1: currentUserId,      // ID текущего пользователя
            user2: recipient.id        // ID получателя
        };

        console.log('Sending message with data:', JSON.stringify(messageData, null, 2));

        try {
            sendMessage(messageData);
            setMessageText('');
            console.log('Message sent successfully');
        } catch (error) {
            console.error('Error sending message:', error);
            Alert.alert('Ошибка', 'Не удалось отправить сообщение');
        }
    };

    // Компонент статуса подключения
    const ConnectionStatus = () => (
        <View style={styles.statusContainer}>
            <View style={[
                styles.statusIndicator,
                { backgroundColor: isConnected && isDataLoaded ? '#4CAF50' : '#F44336' }
            ]} />
            <Text style={styles.statusText}>
                {isConnected && isDataLoaded ? 'Подключено' : 'Загрузка...'}
            </Text>
            {!isConnected && isDataLoaded && (
                <Pressable
                    style={styles.reconnectButton}
                    onPress={reconnect}
                >
                    <Text style={styles.reconnectText}>Переподключиться</Text>
                </Pressable>
            )}
        </View>
    );

    // Рендер сообщения - исправленная логика с безопасным форматированием времени
    const renderMessage = ({item}: {item: Message}) => {
        // Определяем, является ли это моим сообщением
        let isMyMessage = false;

        if (item.sender_id !== undefined && currentUserId !== null) {
            isMyMessage = item.sender_id === currentUserId;
        } else if (item.sender__username && currentUsername) {
            isMyMessage = item.sender__username === currentUsername;
        }

        console.log('Rendering message:', {
            messageId: item.id,
            senderUsername: item.sender__username,
            senderId: item.sender_id,
            currentUserId: currentUserId,
            currentUsername: currentUsername,
            isMyMessage: isMyMessage,
            timestamp: item.timestamp,
            formattedTime: formatTimestamp(item.timestamp)
        });

        return (
            <View style={[
                styles.messageContainer,
                isMyMessage ? styles.myMessage : styles.otherMessage
            ]}>
                {/* Показываем имя отправителя ТОЛЬКО для чужих сообщений */}
                {!isMyMessage && (
                    <Text style={styles.senderName}>{item.sender__username}</Text>
                )}

                <Text style={[
                    styles.messageText,
                    isMyMessage ? styles.myMessageText : styles.otherMessageText
                ]}>
                    {item.message}
                </Text>

                <Text style={[
                    styles.timestamp,
                    isMyMessage ? styles.myTimestamp : styles.otherTimestamp
                ]}>
                    {formatTimestamp(item.timestamp)}
                </Text>
            </View>
        );
    };

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.loadingText}>Загрузка чата...</Text>
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
            <Stack.Screen
                options={{
                    title: recipient?.username || 'Чат',
                    headerShown: true,
                    headerLeft: () => (
                        <Pressable onPress={() => router.back()} style={styles.backButton}>
                            <MaterialIcons name="arrow-back" size={24} color="#007AFF"/>
                        </Pressable>
                    ),
                    headerStyle: {backgroundColor: '#fff'},
                    headerShadowVisible: false,
                }}
            />

            <ConnectionStatus />

            <FlatList
                ref={flatListRef}
                data={messages}
                style={styles.chatbox}
                contentContainerStyle={styles.chatboxContent}
                keyExtractor={(item, index) => `message-${item.id}-${index}`}
                renderItem={renderMessage}
                onContentSizeChange={() => {
                    setTimeout(() => {
                        flatListRef.current?.scrollToEnd({animated: true});
                    }, 100);
                }}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>Нет сообщений</Text>
                    </View>
                }
                showsVerticalScrollIndicator={false}
            />

            <View style={styles.inputContainer}>
                <TextInput
                    style={styles.input}
                    value={messageText}
                    onChangeText={setMessageText}
                    placeholder="Введите сообщение..."
                    placeholderTextColor="#999"
                    multiline
                    maxLength={1000}
                />
                <Pressable
                    style={[
                        styles.sendButton,
                        {
                            backgroundColor: messageText.trim() && isConnected && isDataLoaded ? '#007AFF' : '#F0F0F0',
                            opacity: messageText.trim() && isConnected && isDataLoaded ? 1 : 0.5
                        }
                    ]}
                    onPress={handleSend}
                    disabled={!messageText.trim() || !isConnected || !isDataLoaded}
                >
                    <MaterialIcons
                        name="send"
                        size={20}
                        color={messageText.trim() && isConnected && isDataLoaded ? "#fff" : "#A0A0A0"}
                    />
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: '#666',
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: '#F8F8F8',
        borderBottomWidth: 1,
        borderBottomColor: '#E8E8E8',
    },
    statusIndicator: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 8,
    },
    statusText: {
        fontSize: 12,
        color: '#666',
        flex: 1,
    },
    reconnectButton: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        backgroundColor: '#007AFF',
        borderRadius: 4,
    },
    reconnectText: {
        color: '#fff',
        fontSize: 12,
    },
    backButton: {
        marginLeft: 16,
        padding: 8,
    },
    chatbox: {
        flex: 1,
        backgroundColor: '#F5F5F5',
    },
    chatboxContent: {
        padding: 16,
        paddingBottom: 20,
    },
    messageContainer: {
        maxWidth: '80%',
        marginVertical: 4,
        padding: 12,
        borderRadius: 16,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.1,
        shadowRadius: 1,
    },
    myMessage: {
        alignSelf: 'flex-end',
        backgroundColor: '#007AFF',
        marginLeft: '20%',
        borderBottomRightRadius: 4,
    },
    otherMessage: {
        alignSelf: 'flex-start',
        backgroundColor: '#fff',
        marginRight: '20%',
        borderBottomLeftRadius: 4,
        borderWidth: 1,
        borderColor: '#E8E8E8',
    },
    senderName: {
        fontSize: 12,
        color: '#666',
        marginBottom: 4,
        fontWeight: '600',
    },
    messageText: {
        fontSize: 16,
        lineHeight: 22,
    },
    myMessageText: {
        color: '#fff',
    },
    otherMessageText: {
        color: '#000',
    },
    timestamp: {
        fontSize: 11,
        marginTop: 4,
        alignSelf: 'flex-end',
    },
    myTimestamp: {
        color: 'rgba(255, 255, 255, 0.8)',
    },
    otherTimestamp: {
        color: '#666',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 100,
    },
    emptyText: {
        fontSize: 16,
        color: '#999',
    },
    inputContainer: {
        flexDirection: 'row',
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#E8E8E8',
        backgroundColor: '#fff',
        alignItems: 'flex-end',
    },
    input: {
        flex: 1,
        backgroundColor: '#F8F8F8',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginRight: 12,
        fontSize: 16,
        maxHeight: 100,
        minHeight: 44,
        textAlignVertical: 'top',
    },
    sendButton: {
        justifyContent: 'center',
        alignItems: 'center',
        width: 44,
        height: 44,
        borderRadius: 22,
    },
});