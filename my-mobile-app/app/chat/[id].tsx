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
    Image,
    TouchableOpacity,
} from 'react-native';
import {Stack, useLocalSearchParams, useRouter} from 'expo-router';
import {useWebSocket} from '../../hooks/useWebSocket';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {MaterialIcons} from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useNotifications } from '../../contexts/NotificationContext';
import {API_CONFIG} from '../../config';

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
    gender?: string;
    is_online?: string;
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
            if (timestamp.includes('.') && timestamp.includes(',')) {
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
                date = new Date(timestamp);
            } else {
                const numTimestamp = parseFloat(timestamp);
                if (!isNaN(numTimestamp)) {
                    date = new Date(numTimestamp < 1e10 ? numTimestamp * 1000 : numTimestamp);
                } else {
                    date = new Date(timestamp);
                }
            }
        } else if (typeof timestamp === 'number') {
            date = new Date(timestamp < 1e10 ? timestamp * 1000 : timestamp);
        } else {
            console.warn('Unknown timestamp format:', timestamp);
            return '--:--';
        }

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
    const { theme } = useTheme();
    const { userStatuses } = useNotifications();
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

    // Создаем стили с темой
    const styles = createStyles(theme);

    // Отладочная информация
    useEffect(() => {

        messages.forEach((msg, index) => {
        });
    }, [messages, currentUserId, currentUsername]);

    // WebSocket хук с дополнительной отладкой
    const {connect, disconnect, sendMessage, isConnected: wsIsConnected, reconnect} = useWebSocket(
        `/${API_CONFIG.WS_PROTOCOL}/private/${roomId}/`,
        {
            onOpen: () => {

                setIsConnected(true);
            },
            onMessage: (event: any) => {


                try {
                    const data = JSON.parse(event.data);


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
                        const newMessage: Message = {
                            id: data.id || Date.now(),
                            message: data.message,
                            timestamp: data.timestamp || Math.floor(Date.now() / 1000),
                            sender__username: data.sender__username,
                            sender_id: data.sender_id
                        };

                        setMessages(prev => {
                            const exists = prev.some(msg => msg.id === newMessage.id);
                            if (!exists) {
                                return [...prev, newMessage];
                            }
                            return prev;
                        });

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
                console.error('WebSocket ERROR:', error);
                setIsConnected(false);

                setTimeout(() => {
                    if (!wsIsConnected()) {
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

            const response = await axios.get(
                `${API_CONFIG.BASE_URL}/profile/api/profile/me/`,
                {
                    headers: {'Authorization': `Token ${token}`}
                }
            );

            const userData = {
                id: response.data.id,
                username: response.data.username
            };

            setCurrentUsername(userData.username);
            setCurrentUserId(userData.id);

            return userData;
        } catch (error) {
            console.error('Error fetching current user:', error);
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                Alert.alert('Ошибка', 'Сессия истекла. Войдите снова.');
                router.replace('/login');
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
                avatar: response.data.other_user.avatar,
                is_online: response.data.other_user.is_online
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
                const processedMessages = response.data.messages.map((msg: any) => ({
                    ...msg,
                    timestamp: msg.timestamp
                }));

                setMessages(processedMessages);

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
                const currentUser = await fetchCurrentUser();
                const recipientInfo = await fetchRecipientInfo();
                await fetchChatHistory();

                if (currentUser && recipientInfo) {
                    setIsDataLoaded(true);

                    setTimeout(() => {
                        connect();
                    }, 100);
                } else {
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
        if (!messageText.trim() || !isConnected || !isDataLoaded || !recipient?.id || !currentUserId) {
            return;
        }

        const timestamp = Math.floor(Date.now() / 1000);

        const messageData = {
            message: messageText.trim(),
            timestamp: timestamp,
            user1: currentUserId,
            user2: recipient.id
        };

        try {
            sendMessage(messageData);
            setMessageText('');
        } catch (error) {
            console.error('Error sending message:', error);
            Alert.alert('Ошибка', 'Не удалось отправить сообщение');
        }
    };

    // Переход в профиль пользователя
    const navigateToProfile = () => {
        if (recipient?.username) {
            router.push(`/user/${recipient.username}`);
        }
    };

    // Компонент заголовка с информацией о пользователе
    const ChatHeader = () => {
        const isOnline = recipient?.id ? userStatuses.get(recipient.id) === 'online' : false;
        const userStatus = recipient?.id && userStatuses.has(recipient.id)
            ? isOnline
            : recipient?.is_online === 'online';

        return (
            <TouchableOpacity
                style={styles.headerUserInfo}
                onPress={navigateToProfile}
                activeOpacity={0.7}
            >
                <View style={styles.avatarContainer}>
                    <Image
                        source={
                            {uri: `${API_CONFIG.BASE_URL}${recipient?.avatar}`}
                        }
                        style={styles.avatar}
                    />
                    <View style={[
                        styles.onlineIndicator,
                        {backgroundColor: userStatus ? theme.online : theme.offline}
                    ]}/>
                </View>
                <View style={styles.userInfo}>
                    <Text style={[styles.username, { color: theme.text }]}>{recipient?.username || 'Пользователь'}</Text>
                    <Text style={[
                        styles.onlineStatus,
                        {color: userStatus ? theme.online : theme.offline}
                    ]}>
                        {userStatus ? 'в сети' : 'не в сети'}
                    </Text>
                </View>
            </TouchableOpacity>
        );
    };

    // Рендер сообщения
    const renderMessage = ({item}: { item: Message }) => {
        let isMyMessage = false;

        if (item.sender_id !== undefined && currentUserId !== null) {
            isMyMessage = item.sender_id === currentUserId;
        } else if (item.sender__username && currentUsername) {
            isMyMessage = item.sender__username === currentUsername;
        }

        return (
            <View style={[
                styles.messageContainer,
                isMyMessage ? styles.myMessage : styles.otherMessage
            ]}>
                {!isMyMessage && (
                    <Text style={[styles.senderName, { color: theme.textSecondary }]}>{item.sender__username}</Text>
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
                <ActivityIndicator size="large" color={theme.primary}/>
                <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Загрузка чата...</Text>
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
                    headerShown: true,
                    headerLeft: () => (
                        <Pressable onPress={() => router.back()} style={styles.backButton}>
                            <MaterialIcons name="arrow-back" size={24} color={theme.primary}/>
                        </Pressable>
                    ),
                    headerTitle: () => <ChatHeader/>,
                    headerStyle: {backgroundColor: theme.headerBackground},
                    headerShadowVisible: false,
                }}
            />

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
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Нет сообщений</Text>
                    </View>
                }
                showsVerticalScrollIndicator={false}
            />

            <View style={styles.inputContainer}>
                <TextInput
                    style={[styles.input, { backgroundColor: theme.surface, color: theme.text }]}
                    value={messageText}
                    onChangeText={setMessageText}
                    placeholder="Введите сообщение..."
                    placeholderTextColor={theme.placeholder}
                    multiline
                    maxLength={1000}
                />
                <Pressable
                    style={[
                        styles.sendButton,
                        {
                            backgroundColor: messageText.trim() && isConnected && isDataLoaded ? theme.primary : theme.placeholder,
                            opacity: messageText.trim() && isConnected && isDataLoaded ? 1 : 0.5
                        }
                    ]}
                    onPress={handleSend}
                    disabled={!messageText.trim() || !isConnected || !isDataLoaded}
                >
                    <MaterialIcons
                        name="send"
                        size={20}
                        color={messageText.trim() && isConnected && isDataLoaded ? "#fff" : theme.textSecondary}
                    />
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}

const createStyles = (theme: any) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.background,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: theme.background,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
    },
    backButton: {
        marginLeft: 16,
        padding: 8,
    },
    headerUserInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    avatarContainer: {
        position: 'relative',
        marginRight: 12,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
    },
    onlineIndicator: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: theme.surface,
    },
    userInfo: {
        flex: 1,
    },
    username: {
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 2,
    },
    onlineStatus: {
        fontSize: 12,
        fontWeight: '500',
    },
    chatbox: {
        flex: 1,
        backgroundColor: theme.chatBackground,
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
        shadowColor: theme.text,
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.1,
        shadowRadius: 1,
    },
    myMessage: {
        alignSelf: 'flex-end',
        backgroundColor: theme.primary,
        marginLeft: '20%',
        borderBottomRightRadius: 4,
    },
    otherMessage: {
        alignSelf: 'flex-start',
        backgroundColor: theme.surface,
        marginRight: '20%',
        borderBottomLeftRadius: 4,
        borderWidth: 1,
        borderColor: theme.border,
    },
    senderName: {
        fontSize: 12,
        marginBottom: 4,
        fontWeight: '600',
    },
    messageText: {
        fontSize: 16,
        lineHeight: 22,
    },
    myMessageText: {
        color: 'white',
    },
    otherMessageText: {
        color: theme.text,
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
        color: theme.textSecondary,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 100,
    },
    emptyText: {
        fontSize: 16,
    },
    inputContainer: {
        flexDirection: 'row',
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        backgroundColor: theme.surface,
        alignItems: 'flex-end',
    },
    input: {
        flex: 1,
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginRight: 12,
        fontSize: 16,
        maxHeight: 100,
        minHeight: 44,
        textAlignVertical: 'top',
        borderWidth: 1,
        borderColor: theme.border,
    },
    sendButton: {
        justifyContent: 'center',
        alignItems: 'center',
        width: 44,
        height: 44,
        borderRadius: 22,
    },
});