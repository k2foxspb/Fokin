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
    TouchableOpacity,
    SafeAreaView,
} from 'react-native';
import {Stack, useLocalSearchParams, useRouter} from 'expo-router';
import {useWebSocket} from '../../hooks/useWebSocket';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {MaterialIcons} from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useNotifications } from '../../contexts/NotificationContext';
import CachedImage from '../../components/CachedImage';
import {API_CONFIG} from '../../config';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
            return '--:--';
        }

        if (isNaN(date.getTime())) {
            return '--:--';
        }

        return date.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        return '--:--';
    }
};

export default function ChatScreen() {
    const { theme } = useTheme();
    const { userStatuses } = useNotifications();
    const insets = useSafeAreaInsets();
    const {id: roomId} = useLocalSearchParams();
    const [messages, setMessages] = useState<Message[]>([]);
    const [messageText, setMessageText] = useState('');
    const [currentUsername, setCurrentUsername] = useState('');
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [recipient, setRecipient] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isConnected, setIsConnected] = useState(false);
    const [isDataLoaded, setIsDataLoaded] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const flatListRef = useRef<FlatList>(null);
    const router = useRouter();

    // Создаем стили с темой
    const styles = createStyles(theme);


    // WebSocket хук
    const {connect, disconnect, sendMessage, isConnected: wsIsConnected, reconnect} = useWebSocket(
        `/${API_CONFIG.WS_PROTOCOL}/private/${roomId}/`,
        {
            onOpen: () => {
                setIsConnected(true);
            },
            onMessage: (event: any) => {
                console.log('💬 [CHAT] ========== RAW WebSocket MESSAGE ==========');
                console.log('💬 [CHAT] Raw data:', event.data);

                try {
                    const data = JSON.parse(event.data);
                    console.log('💬 [CHAT] Parsed data:', {
                        type: data.type || 'chat_message', // Устанавливаем дефолтный тип для обычных сообщений
                        hasMessage: !!data.message,
                        hasError: !!data.error,
                        allKeys: Object.keys(data),
                        dataPreview: JSON.stringify(data).substring(0, 200)
                    });

                    // Игнорируем системные сообщения
                    if (data.type === 'messages_by_sender_update') {
                        console.log('💬 [CHAT] Ignoring system message: messages_by_sender_update');
                        return;
                    }

                    // Обработка ошибок от consumer
                    if (data.error) {
                        console.error('💬 [CHAT] Server error received:', data.error);
                        Alert.alert('Ошибка', data.error);
                        return;
                    }

                    // Обработка сообщений чата (включая сообщения без типа)
                    if (data.message && (!data.type || data.type === 'chat_message')) {
                        console.log('💬 [CHAT] Processing chat message:', {
                            id: data.id,
                            message: data.message,
                            sender: data.sender__username,
                            timestamp: data.timestamp
                        });
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
                                return [newMessage, ...prev]; // Добавляем в начало массива
                            }
                            return prev;
                        });

                        setTimeout(() => {
                            if (flatListRef.current) {
                                flatListRef.current.scrollToIndex({
                                    index: 0,
                                    animated: true
                                });
                            }
                        }, 100);
                    }
                } catch (error) {
                    // Тихо игнорируем ошибки парсинга
                }
            },
            onClose: () => {
                setIsConnected(false);
            },
            onError: (error: any) => {
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
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                Alert.alert('Ошибка', 'Сессия истекла. Войдите снова.');
                router.replace('/(auth)/login');
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

            return recipientData;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                Alert.alert('Ошибка', 'Сессия истекла. Войдите снова.');
                router.replace('/(auth)/login');
            }
            return null;
        }
    };

    // Получение истории сообщений с пагинацией
    const fetchChatHistory = async (pageNum: number = 1, limit: number = 15) => {
        try {
            const token = await getToken();
            if (!token) return;

            const response = await axios.get(
                `${API_CONFIG.BASE_URL}/profile/api/chat_history/${roomId}/`,
                {
                    headers: {
                        'Authorization': `Token ${token}`,
                        'Content-Type': 'application/json',
                    },
                    params: {
                        page: pageNum,
                        limit: limit
                    }
                }
            );

            if (response.data && response.data.messages) {
                const processedMessages = response.data.messages.map((msg: any) => ({
                    ...msg,
                    timestamp: msg.timestamp
                }));

                if (pageNum === 1) {
                    // Первая загрузка - заменяем все сообщения
                    setMessages(processedMessages.reverse()); // Реверсируем для правильного порядка
                    setPage(1);
                } else {
                    // Загрузка дополнительных сообщений - добавляем в начало
                    setMessages(prev => [...processedMessages.reverse(), ...prev]);
                }

                // Проверяем, есть ли еще сообщения
                setHasMore(processedMessages.length === limit);

                if (pageNum === 1) {
                    // Только при первой загрузке прокручиваем вниз
                    setTimeout(() => {
                        if (flatListRef.current && processedMessages.length > 0) {
                            flatListRef.current.scrollToIndex({
                                index: 0,
                                animated: false
                            });
                        }
                    }, 100);
                }
            }
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                Alert.alert('Ошибка', 'Сессия истекла. Войдите снова.');
                router.replace('/(auth)/login');
            }
        }
    };

    // Загрузка дополнительных сообщений
    const loadMoreMessages = async () => {
        if (!hasMore || isLoadingMore) return;

        setIsLoadingMore(true);
        const nextPage = page + 1;

        try {
            await fetchChatHistory(nextPage, 15);
            setPage(nextPage);
        } finally {
            setIsLoadingMore(false);
        }
    };

    // Инициализация чата
    useEffect(() => {
        if (!roomId) {
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
                Alert.alert('Ошибка', 'Не удалось загрузить чат');
            } finally {
                setIsLoading(false);
            }
        };

        initializeChat();

        return () => {
            disconnect();
        };
    }, [roomId]);

    // Тест-функция для проверки связи с сервером
    const testServerConnection = () => {
        console.log('🧪 [CHAT-TEST] Testing server connection...');

        // Отправляем простой пинг
        const pingMessage = {
            type: 'ping',
            timestamp: Date.now()
        };

        try {
            sendMessage(pingMessage);
            console.log('🧪 [CHAT-TEST] Ping sent, waiting for pong...');

            setTimeout(() => {
                console.log('🧪 [CHAT-TEST] 3 seconds passed - did server respond?');
            }, 3000);
        } catch (error) {
            // Ошибка отправки ping сообщения
        }
    };

    // Отправка сообщения
    const handleSend = () => {
        console.log('💬 [CHAT] ========== SENDING MESSAGE ==========');
        console.log('💬 [CHAT] Send conditions check:', {
            hasText: !!messageText.trim(),
            isConnected: isConnected,
            isDataLoaded: isDataLoaded,
            hasRecipient: !!recipient?.id,
            hasCurrentUser: !!currentUserId,
            messageLength: messageText.trim().length
        });

        if (!messageText.trim() || !isConnected || !isDataLoaded || !recipient?.id || !currentUserId) {
            console.log('💬 [CHAT] ❌ Cannot send - missing requirements');
            return;
        }

        // ТЕСТ: отправляем пинг перед сообщением
        if (messageText.trim() === '/test') {
            testServerConnection();
            setMessageText('');
            return;
        }

        const timestamp = Math.floor(Date.now() / 1000);

        const messageData = {
            type: 'chat_message', // Добавляем обязательное поле type
            message: messageText.trim(),
            timestamp: timestamp,
            user1: currentUserId,
            user2: recipient.id
        };

        console.log('💬 [CHAT] Sending message data:', messageData);
        console.log('💬 [CHAT] Message will be sent to room:', roomId);

        try {
            sendMessage(messageData);
            console.log('💬 [CHAT] ✅ sendMessage called successfully');
            setMessageText('');

            // Даем время на получение ответа от сервера
            setTimeout(() => {
                console.log('💬 [CHAT] 🕐 5 seconds passed after sending - checking if message appeared...');
            }, 5000);

        } catch (error) {
            console.error('💬 [CHAT] ❌ Error in sendMessage:', error);
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
                <View style={styles.userInfo}>
                    <Text style={[styles.username, { color: theme.text }]}>{recipient?.username || 'Пользователь'}</Text>
                    <Text style={[
                        styles.onlineStatus,
                        {color: userStatus ? theme.online : theme.offline}
                    ]}>
                        {userStatus ? 'в сети' : 'не в сети'}
                    </Text>
                </View>
                {/* Онлайн индикатор рядом с текстом */}
                <View style={[
                    styles.headerOnlineIndicator,
                    {backgroundColor: userStatus ? theme.online : theme.offline}
                ]}/>
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
        <View style={styles.container}>
            <KeyboardAvoidingView
                style={styles.keyboardView}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
            >
                {/* Header Section */}
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => router.back()}
                    >
                        <MaterialIcons name="arrow-back" size={24} color={theme.primary} />
                    </TouchableOpacity>

                    {/* Мини аватарка */}
                    <View style={styles.miniAvatarContainer}>
                        <CachedImage
                            uri={
                                recipient?.avatar
                                    ? recipient.avatar.startsWith('http') 
                                      ? recipient.avatar 
                                      : `${API_CONFIG.BASE_URL}${recipient.avatar}`
                                    : ''
                            }
                            style={styles.miniAvatar}
                        />
                    </View>

                    <ChatHeader/>
                </View>

                <FlatList
                    ref={flatListRef}
                    data={messages}
                    style={styles.chatbox}
                    contentContainerStyle={styles.chatboxContent}
                    keyExtractor={(item, index) => `message-${item.id}-${index}`}
                    renderItem={renderMessage}
                    inverted
                    onEndReached={loadMoreMessages}
                    onEndReachedThreshold={0.1}
                    ListFooterComponent={
                        isLoadingMore ? (
                            <View style={styles.loadingMoreContainer}>
                                <ActivityIndicator size="small" color={theme.primary} />
                                <Text style={[styles.loadingMoreText, { color: theme.textSecondary }]}>
                                    Загрузка сообщений...
                                </Text>
                            </View>
                        ) : null
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Нет сообщений</Text>
                        </View>
                    }
                    showsVerticalScrollIndicator={false}
                    maintainVisibleContentPosition={{
                        minIndexForVisible: 0,
                        autoscrollToTopThreshold: 10
                    }}
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
        </View>
    );
}

const createStyles = (theme: any) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.background,
    },
    keyboardView: {
        flex: 1,
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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 70,
        paddingBottom: 20,
        backgroundColor: theme.headerBackground,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
    },
    backButton: {
        padding: 8,
        marginRight: 8,
    },
    miniAvatarContainer: {
        marginRight: 12,
    },
    miniAvatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 2,
        borderColor: theme.primary,
        backgroundColor: '#f0f0f0', // Фон на случай загрузки
    },
    headerUserInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    userInfo: {
        flex: 1,
    },
    headerOnlineIndicator: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginLeft: 8,
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
    loadingMoreContainer: {
        paddingVertical: 16,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
    },
    loadingMoreText: {
        marginLeft: 8,
        fontSize: 14,
    },
});