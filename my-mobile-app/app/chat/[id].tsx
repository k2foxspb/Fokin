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
    Image,
    Modal,
    AppState,
    Linking,
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
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Video, ResizeMode, Audio, AVPlaybackStatus } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
interface Message {
    id: number;
    message: string;
    timestamp: number | string;
    sender__username: string;
    sender_id?: number;
    mediaType?: 'image' | 'video' | 'file';
    mediaUri?: string;
    mediaBase64?: string;
    mediaHash?: string;
    mediaFileName?: string;
    mediaSize?: number;
    mimeType?: string;
    isUploading?: boolean;
    uploadProgress?: number;
    needsReload?: boolean;
    serverFileUrl?: string; // URL файла на сервере для больших файлов
    uploadMethod?: 'websocket' | 'http' | 'chunk'; // Метод загрузки
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
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [isImageViewerVisible, setIsImageViewerVisible] = useState(false);
    const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
    const [isVideoViewerVisible, setIsVideoViewerVisible] = useState(false);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [isVideoMuted, setIsVideoMuted] = useState(false); // Изменено: по умолчанию звук включен
    const [videoError, setVideoError] = useState<string | null>(null);
    const [appState, setAppState] = useState(AppState.currentState);
    const [audioSessionReady, setAudioSessionReady] = useState(false);
    const [reconnectAttempts, setReconnectAttempts] = useState(0);
    const [lastReconnectTime, setLastReconnectTime] = useState(0);
    const [inlineVideoStates, setInlineVideoStates] = useState<{[key: string]: {
        isPlaying: boolean,
        isMuted: boolean,
        isExpanded: boolean,
        duration: number,
        position: number,
        isLoaded: boolean
    }}>({});
    const [fullscreenVideoId, setFullscreenVideoId] = useState<string | null>(null);
    const flatListRef = useRef<FlatList>(null);
    const videoRef = useRef<any>(null);
    const inlineVideoRefs = useRef<{[key: string]: any}>({});
    const prevPendingCount = useRef(0);
    const router = useRouter();

    // Функция для безопасного обновления сообщения с сохранением всех полей
    const updateMessageSafely = (messageId: number | string, updates: Partial<Message>) => {
        console.log('🔒 [SAFE-UPDATE] Updating message safely:', { messageId, updates: Object.keys(updates) });

        setMessages(prev =>
            prev.map(msg => {
                if (msg.id === messageId) {
                    const updatedMsg = { ...msg, ...updates };

                    console.log('🔒 [SAFE-UPDATE] Message updated:', {
                        id: updatedMsg.id,
                        mediaType: updatedMsg.mediaType,
                        hasMediaUri: !!updatedMsg.mediaUri,
                        hasMediaBase64: !!updatedMsg.mediaBase64,
                        mediaHash: updatedMsg.mediaHash
                    });

                    return updatedMsg;
                }
                return msg;
            })
        );
    };

    // Создаем стили с темой
    const styles = createStyles(theme);


    // Отслеживание состояния медиа сообщений
    useEffect(() => {
        const mediaMessages = messages.filter(msg => msg.mediaType);

        // Периодическая проверка целостности медиа сообщений
        const brokenMediaMessages = mediaMessages.filter(msg =>
            msg.mediaType &&
            msg.mediaHash &&
            !msg.mediaUri &&
            !msg.mediaBase64 &&
            !msg.isUploading &&
            !msg.needsReload
        );

        if (brokenMediaMessages.length > 0) {
            // Пытаемся восстановить сломанные медиа сообщения
            brokenMediaMessages.forEach(async (msg) => {
                try {
                    if (msg.mediaHash) {
                        const cachedUri = await getMediaFromCache(msg.mediaHash, msg.mediaType!);
                        if (cachedUri) {
                            updateMessageSafely(msg.id, { mediaUri: cachedUri });
                        }
                    }
                } catch (restoreError) {
                    // Тихо игнорируем ошибки восстановления
                }
            });
        }
    }, [messages]);

    // Автовосстановление только состояния, без переподключений
    useEffect(() => {
        if (!isConnected && wsIsConnected() && isDataLoaded && recipient && currentUserId) {
            console.log('🔄 [AUTO-RESTORE] Fixing connection state');
            setIsConnected(true);

            // Сбрасываем счетчик при восстановлении состояния
            setReconnectAttempts(0);
            setLastReconnectTime(0);
        }
    }, [isConnected, isDataLoaded, recipient, currentUserId]);

    // WebSocket хук
    const {connect, disconnect, sendMessage, isConnected: wsIsConnected, reconnect} = useWebSocket(
        `/${API_CONFIG.WS_PROTOCOL}/private/${roomId}/`,
        {
            onOpen: () => {
                setIsConnected(true);
                setReconnectAttempts(0);
                setLastReconnectTime(0);
            },
            onMessage: async (event: any) => {
                try {
                    const data = JSON.parse(event.data);

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
                    if (data.message && (!data.type || data.type === 'chat_message' || data.type === 'media_message')) {
                        const isMyMessage = (data.sender_id === currentUserId) || (data.sender__username === currentUsername);

                        const messageId = data.id || Date.now();

                        setMessages(prev => {
                            // Если это мое сообщение, ищем оптимистичное сообщение для обновления
                            if (isMyMessage) {
                                // Сначала проверяем, нет ли уже сообщения с серверным ID
                                const existingServerMessage = prev.find(msg => msg.id === messageId);
                                if (existingServerMessage) {
                                    console.log('📷 [MEDIA] ⚠️ Message with server ID already exists, skipping:', messageId);
                                    return prev;
                                }

                                // Ищем оптимистичное сообщение по хэшу медиа или контенту
                                let optimisticIndex = -1;
                                const currentTime = Date.now();

                                if (data.mediaHash) {
                                    // Для медиа-сообщений ищем по хэшу более тщательно
                                    optimisticIndex = prev.findIndex(msg => {
                                        const isMatchingHash = msg.mediaHash === data.mediaHash;
                                        const isMyMessage = msg.sender_id === currentUserId;
                                        const isOptimisticId = typeof msg.id === 'number' && msg.id > currentTime - 120000; // 2 минуты
                                        const isNotServerMessage = msg.id !== messageId;
                                        const hasUploadingState = msg.isUploading === true;

                                        return isMatchingHash && isMyMessage && isOptimisticId && isNotServerMessage && hasUploadingState;
                                    });

                                    console.log('📷 [MEDIA] Searching for optimistic message:', {
                                        mediaHash: data.mediaHash.substring(0, 16) + '...',
                                        currentUserId: currentUserId,
                                        serverMessageId: messageId,
                                        currentTime: currentTime,
                                        totalMessages: prev.length,
                                        candidateMessages: prev.filter(msg =>
                                            msg.mediaHash === data.mediaHash &&
                                            msg.sender_id === currentUserId
                                        ).map(msg => ({
                                            id: msg.id,
                                            isOptimistic: typeof msg.id === 'number' && msg.id > currentTime - 120000,
                                            hasMediaUri: !!msg.mediaUri,
                                            isUploading: msg.isUploading,
                                            timestamp: msg.timestamp
                                        }))
                                    });
                                } else {
                                    // Для текстовых сообщений ищем по содержимому и времени
                                    optimisticIndex = prev.findIndex(msg => {
                                        const isMatchingMessage = msg.message === data.message;
                                        const isMyMessage = msg.sender_id === currentUserId;
                                        const isRecentTimestamp = Math.abs(Number(msg.timestamp) - Number(data.timestamp)) < 60; // В пределах минуты
                                        const isOptimisticId = typeof msg.id === 'number' && msg.id > currentTime - 120000;
                                        const isNotServerMessage = msg.id !== messageId;

                                        return isMatchingMessage && isMyMessage && isRecentTimestamp && isOptimisticId && isNotServerMessage;
                                    });
                                }

                                if (optimisticIndex !== -1) {
                                    console.log('📷 [MEDIA] ✅ Found optimistic message to update:', {
                                        optimisticId: prev[optimisticIndex].id,
                                        serverMessageId: messageId,
                                        mediaHash: data.mediaHash?.substring(0, 16) + '...',
                                        optimisticHasUri: !!prev[optimisticIndex].mediaUri,
                                        optimisticIsUploading: prev[optimisticIndex].isUploading
                                    });

                                    // Обновляем оптимистичное сообщение данными с сервера
                                    const updatedMessages = [...prev];
                                    const originalMessage = updatedMessages[optimisticIndex];

                                        // КРИТИЧЕСКИ ВАЖНО: сохраняем локальный медиа URI
                                        const preservedMediaUri = originalMessage.mediaUri;
                                        const preservedMediaBase64 = originalMessage.mediaBase64;

                                        updatedMessages[optimisticIndex] = {
                                            ...originalMessage, // Сохраняем все исходные поля
                                            id: messageId, // Используем серверный ID
                                            message: data.message || originalMessage.message,
                                            timestamp: data.timestamp || originalMessage.timestamp,
                                            sender__username: data.sender__username || originalMessage.sender__username,
                                            sender_id: data.sender_id || originalMessage.sender_id,
                                            isUploading: false, // Загрузка завершена
                                            uploadProgress: 100,
                                            // Медиа поля - ПРИОРИТЕТ локальным данным
                                            mediaType: originalMessage.mediaType || data.mediaType,
                                            mediaBase64: preservedMediaBase64 || data.mediaBase64,
                                            mediaHash: originalMessage.mediaHash || data.mediaHash,
                                            mediaFileName: originalMessage.mediaFileName || data.mediaFileName,
                                            mediaSize: originalMessage.mediaSize || data.mediaSize,
                                            mediaUri: preservedMediaUri, // ВСЕГДА сохраняем локальный URI
                                            // Дополнительные поля для отладки
                                            _wasOptimistic: true,
                                            _serverConfirmed: true,
                                            _originalId: originalMessage.id
                                        };

                                        console.log('📷 [MEDIA] ✅ Updated optimistic message with preserved media:', {
                                            oldId: originalMessage.id,
                                            newId: messageId,
                                            mediaType: updatedMessages[optimisticIndex].mediaType,
                                            hasMediaUri: !!updatedMessages[optimisticIndex].mediaUri,
                                            hasMediaBase64: !!updatedMessages[optimisticIndex].mediaBase64,
                                            mediaHash: updatedMessages[optimisticIndex].mediaHash?.substring(0, 16) + '...',
                                            preservedUri: preservedMediaUri ? preservedMediaUri.substring(preservedMediaUri.lastIndexOf('/') + 1) : 'none',
                                        uploadingState: 'completed'
                                    });

                                    return updatedMessages;
                                } else {
                                    console.log('📷 [MEDIA] ⚠️ No optimistic message found, will create new message:', {
                                        mediaHash: data.mediaHash?.substring(0, 16) + '...',
                                        messageId: messageId,
                                        searchedFor: 'optimistic with matching hash and uploading state'
                                    });
                                }
                            }

                            // Проверяем, есть ли уже сообщение с таким серверным ID или хэшем
                            const existingById = prev.find(msg => msg.id === messageId);
                            const existingByHash = data.mediaHash ?
                                prev.find(msg => msg.mediaHash === data.mediaHash && msg.sender_id === data.sender_id && !msg.isUploading) :
                                null;

                            if (existingById || existingByHash) {
                                console.log('📷 [MEDIA] Message already exists, skipping:', {
                                    messageId: messageId,
                                    existsById: !!existingById,
                                    existsByHash: !!existingByHash,
                                    mediaHash: data.mediaHash?.substring(0, 16) + '...'
                                });
                                return prev;
                            } else {
                                console.log('📷 [MEDIA] Adding new message from other user:', {
                                    messageId: messageId,
                                    sender: data.sender__username,
                                    mediaType: data.mediaType,
                                    mediaHash: data.mediaHash?.substring(0, 16) + '...'
                                });

                                // Добавляем новое сообщение (от другого пользователя)
                                const isLargeFile = data.mediaSize ? (data.mediaSize / (1024 * 1024)) > 15 : false;

                                const newMessage: Message = {
                                    id: messageId,
                                    message: data.message,
                                    timestamp: data.timestamp || Math.floor(Date.now() / 1000),
                                    sender__username: data.sender__username,
                                    sender_id: data.sender_id,
                                    mediaType: data.mediaType,
                                    mediaUri: null,
                                    mediaBase64: data.mediaBase64,
                                    mediaHash: data.mediaHash,
                                    mediaFileName: data.mediaFileName,
                                    mediaSize: data.mediaSize,
                                    isUploading: false,
                                    uploadProgress: 100,
                                    // Для больших файлов без base64 помечаем как требующие загрузки
                                    needsReload: isLargeFile && !data.mediaBase64
                                };
                                return [newMessage, ...prev];
                            }
                        });

                        // Если есть медиафайл, работаем с кэшем
                        if (data.mediaType && data.mediaHash) {
                            const isLargeFile = data.mediaSize ? (data.mediaSize / (1024 * 1024)) > 15 : false;

                            console.log('📷 [MEDIA] Processing media for message:', {
                                messageId: messageId,
                                mediaHash: data.mediaHash,
                                mediaType: data.mediaType,
                                hasBase64: !!data.mediaBase64,
                                base64Length: data.mediaBase64 ? data.mediaBase64.length : 0,
                                serverHashPreview: data.mediaHash.substring(0, 20) + '...',
                                isLargeFile: isLargeFile,
                                mediaSize: data.mediaSize
                            });

                            // Если нет base64 данных (большой файл), пропускаем сохранение в кэш
                            if (!data.mediaBase64) {
                                console.log('📷 [MEDIA] Large file without base64 data, skipping cache save:', {
                                    messageId: messageId,
                                    sizeMB: data.mediaSize ? (data.mediaSize / (1024 * 1024)).toFixed(1) : 'unknown'
                                });
                                return;
                            }

                            // Всегда используем хэш от сервера для согласованности между клиентами
                            const hashToUse = data.mediaHash;

                            console.log('📥 Media message received from server:', {
                                id: messageId,
                                type: data.mediaType,
                                size: data.mediaSize,
                                isMyMessage: isMyMessage
                            });

                            // Сначала проверяем кэш
                            getMediaFromCache(hashToUse, data.mediaType)
                                .then(async (cachedUri) => {
                                    if (cachedUri) {
                                        console.log('📷 [MEDIA] ✅ Using cached media:', {
                                            uri: cachedUri,
                                            hash: hashToUse.substring(0, 20) + '...',
                                            messageId: messageId
                                        });
                                        setMessages(prev =>
                                            prev.map(msg => {
                                                // Обновляем сообщение по ID или по хэшу (для случаев когда ID поменялся)
                                                const shouldUpdate = msg.id === messageId ||
                                                    (msg.mediaHash === hashToUse && msg.sender_id === data.sender_id);

                                                if (shouldUpdate) {
                                                    console.log('📷 [MEDIA] Updating message with cached URI:', {
                                                        messageId: msg.id,
                                                        mediaHash: msg.mediaHash?.substring(0, 20) + '...',
                                                        cachedUri: cachedUri.substring(cachedUri.lastIndexOf('/') + 1),
                                                        preservingFields: {
                                                            mediaType: msg.mediaType,
                                                            mediaBase64: !!msg.mediaBase64
                                                        }
                                                    });

                                                    // БЕЗОПАСНОЕ ОБНОВЛЕНИЕ - сохраняем ВСЕ поля
                                                    return {
                                                        ...msg,
                                                        mediaUri: cachedUri,
                                                        // Принудительно сохраняем критические поля
                                                        mediaType: msg.mediaType || data.mediaType,
                                                        mediaHash: msg.mediaHash || hashToUse,
                                                        mediaFileName: msg.mediaFileName || data.mediaFileName,
                                                        mediaSize: msg.mediaSize || data.mediaSize
                                                    };
                                                }
                                                return msg;
                                            })
                                        );
                                    } else if (data.mediaBase64) {
                                        console.log('📷 [MEDIA] Saving new media to cache with hash:', hashToUse.substring(0, 20) + '...');
                                        try {
                                            const savedUri = await saveMediaToDevice(data.mediaBase64, data.mediaType, hashToUse);

                                            // Сохраняем метаданные
                                            await saveMediaMetadata(hashToUse, {
                                                fileName: data.mediaFileName,
                                                type: data.mediaType,
                                                size: data.mediaSize,
                                                timestamp: data.timestamp,
                                                savedAt: Date.now()
                                            });

                                            // Для видео дополнительно проверяем, что файл сохранился корректно
                                            if (data.mediaType === 'video') {
                                                try {
                                                    const videoFileInfo = await FileSystem.getInfoAsync(savedUri);
                                                    console.log('📷 [MEDIA] Video file saved and verified:', {
                                                        uri: savedUri.substring(savedUri.lastIndexOf('/') + 1),
                                                        size: videoFileInfo.size,
                                                        exists: videoFileInfo.exists,
                                                        originalDataSize: data.mediaBase64.length
                                                    });

                                                    if (!videoFileInfo.exists || videoFileInfo.size === 0) {
                                                        console.error('📷 [MEDIA] ❌ Video file save failed or corrupted');
                                                        throw new Error('Video file save verification failed');
                                                    }
                                                } catch (verificationError) {
                                                    console.error('📷 [MEDIA] ❌ Video save verification failed:', verificationError);
                                                    // Не падаем, но логируем ошибку
                                                }
                                            }

                                            console.log('📷 [MEDIA] ✅ Media saved, updating message with URI:', {
                                                savedUri: savedUri.substring(savedUri.lastIndexOf('/') + 1),
                                                hash: hashToUse.substring(0, 20) + '...',
                                                messageId: messageId
                                            });
                                            setMessages(prev =>
                                                prev.map(msg => {
                                                    if (msg.id === messageId ||
                                                        (msg.mediaHash === hashToUse && msg.sender_id === data.sender_id)) {
                                                        console.log('📷 [MEDIA] Updating message with saved URI:', {
                                                            messageId: msg.id,
                                                            oldMediaUri: msg.mediaUri ? msg.mediaUri.substring(msg.mediaUri.lastIndexOf('/') + 1) : 'none',
                                                            newMediaUri: savedUri.substring(savedUri.lastIndexOf('/') + 1),
                                                            mediaType: msg.mediaType
                                                        });
                                                        return {
                                                            ...msg,
                                                            mediaUri: savedUri,
                                                            // Убеждаемся, что медиа-поля сохранены
                                                            mediaType: msg.mediaType || data.mediaType,
                                                            mediaHash: msg.mediaHash || hashToUse,
                                                            mediaFileName: msg.mediaFileName || data.mediaFileName,
                                                            mediaSize: msg.mediaSize || data.mediaSize
                                                        };
                                                    }
                                                    return msg;
                                                })
                                            );
                                        } catch (error) {
                                            console.error('📷 [MEDIA] ❌ Error saving media:', error);
                                        }
                                    } else {
                                        console.log('📷 [MEDIA] ⚠️ Media not in cache and no base64 data');
                                    }
                                });
                        }

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
                console.log('🌐 [WEBSOCKET] Connection closed');
                setIsConnected(false);

                const now = Date.now();
                const timeSinceLastReconnect = now - lastReconnectTime;

                // Предотвращаем слишком частые переподключения
                if (timeSinceLastReconnect < 5000) { // Менее 5 секунд с последней попытки
                    setReconnectAttempts(prev => prev + 1);

                    // Прекращаем попытки после 3 неудачных попыток подряд
                    if (reconnectAttempts >= 3) {
                        console.warn('🚫 [WEBSOCKET] Too many reconnection attempts, stopping auto-reconnect');
                        return;
                    }
                }

                // Переподключение с экспоненциальной задержкой
                if (isDataLoaded && recipient && currentUserId) {
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000); // От 1 до 10 секунд

                    setTimeout(() => {
                        if (!wsIsConnected()) {
                            console.log(`🔄 [WEBSOCKET] Reconnecting (attempt ${reconnectAttempts + 1}) after ${delay}ms...`);
                            setLastReconnectTime(Date.now());
                            reconnect();
                        }
                    }, delay);
                }
            },
            onError: (error: any) => {
                console.error('🌐 [WEBSOCKET] Connection error:', error);
                setIsConnected(false);

                // Более быстрое переподключение после ошибки
                setTimeout(() => {
                    if (!wsIsConnected() && isDataLoaded && recipient && currentUserId) {
                        console.log('🔄 [WEBSOCKET] Reconnecting after error...');
                        reconnect();
                    }
                }, 2000);
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

    // Запрос разрешений для доступа к медиабиблиотеке
    const requestPermissions = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Ошибка', 'Необходимо разрешение для доступа к медиафайлам');
            return false;
        }
        return true;
    };

    // Конвертация URI в base64 с проверкой размера файла
    const convertToBase64 = async (uri: string): Promise<string> => {
        try {
            // Сначала проверяем размер файла
            const fileInfo = await FileSystem.getInfoAsync(uri);
            if (!fileInfo.exists) {
                throw new Error('Файл не существует');
            }

            const fileSizeInMB = fileInfo.size / (1024 * 1024);

            // Ограничиваем размер файла для base64 конвертации (30MB для предотвращения OOM)
            const maxSizeForBase64 = 30 * 1024 * 1024; // 30MB
            if (fileInfo.size > maxSizeForBase64) {
                throw new Error(`Файл слишком большой для base64 конвертации: ${fileSizeInMB.toFixed(1)}MB > 30MB. Используйте прямую загрузку.`);
            }

            // Дополнительная проверка доступной памяти для Android
            if (Platform.OS === 'android' && fileInfo.size > 20 * 1024 * 1024) {
                console.warn('📱 [CONVERT] Large file for Android, checking memory...');
                // Для Android файлов больше 20MB используем более осторожный подход
                if (fileSizeInMB > 25) {
                    throw new Error(`Файл ${fileSizeInMB.toFixed(1)}MB слишком большой для base64 на Android. Используйте прямую загрузку.`);
                }
            }

            const base64 = await FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.Base64,
            });

            return base64;
        } catch (error) {
            console.error('📱 [CONVERT] ❌ Base64 conversion error:', error);
            throw error;
        }
    };


    // Загрузка файла через HTTP multipart/form-data в Yandex Storage
    const uploadFileMultipart = async (
        fileUri: string,
        mediaType: 'image' | 'video',
        messageId: number,
        onProgress?: (progress: number) => void
    ): Promise<string> => {
        try {
            const token = await getToken();
            if (!token) {
                throw new Error('Нет токена авторизации');
            }

            // Создаем FormData для multipart загрузки
            const formData = new FormData();

            // Добавляем файл
            formData.append('file', {
                uri: fileUri,
                type: mediaType === 'image' ? 'image/jpeg' : 'video/mp4',
                name: `media_${messageId}.${mediaType === 'image' ? 'jpg' : 'mp4'}`
            } as any);

            // Добавляем публичный доступ для чатов
            formData.append('is_public', 'true');

            if (onProgress) {
                onProgress(10);
            }

            const endpoint = mediaType === 'image'
                ? `${API_CONFIG.BASE_URL}/media-api/upload/image/`
                : `${API_CONFIG.BASE_URL}/media-api/upload/video/`;

            const response = await axios.post(
                endpoint,
                formData,
                {
                    headers: {
                        'Authorization': `Token ${token}`,
                        'Content-Type': 'multipart/form-data',
                    },
                    timeout: 600000, // 10 минут
                    onUploadProgress: (progressEvent) => {
                        if (progressEvent.total) {
                            const progress = Math.round((progressEvent.loaded / progressEvent.total) * 90) + 10;
                            if (onProgress) {
                                onProgress(progress);
                            }
                        }
                    }
                }
            );

            if (onProgress) {
                onProgress(100);
            }

            if (!response.data.success) {
                throw new Error(response.data.message || 'Загрузка не удалась');
            }

            return response.data.file.file_url;

        } catch (error) {
            console.error('Ошибка загрузки файла:', error);
            throw error;
        }
    };


    // Простая, но эффективная реализация хэширования для React Native
    const simpleHash = (data: string): string => {
        let hash = 0;
        let hash2 = 0;

        if (data.length === 0) return '0';

        // Используем два разных алгоритма для большей уникальности
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            // Первый хэш
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Конвертируем в 32-битное число

            // Второй хэш с другим алгоритмом
            hash2 = hash2 ^ ((hash2 << 5) + (hash2 >> 2) + char);
        }

        // Комбинируем оба хэша и конвертируем в hex
        const combined = Math.abs(hash) + Math.abs(hash2);
        return combined.toString(16).padStart(16, '0');
    };

    // Генерация уникального хэша для медиафайла
    const generateMediaHash = (base64Data: string, additionalData?: any): string => {
        const timestamp = additionalData?.timestamp || Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 15);
        const userId = additionalData?.senderId || currentUserId || 0;
        const messageId = additionalData?.messageId || Date.now();
        const fromServer = additionalData?.fromServer || false;
        const fileSize = base64Data.length;

        const chunkSize = Math.max(50, Math.min(200, Math.floor(fileSize / 20)));
        const chunks = [];

        for (let i = 0; i < 10; i++) {
            const position = Math.floor((fileSize * i) / 10);
            const chunk = base64Data.substring(position, position + chunkSize);
            chunks.push(chunk);
        }

        const start = base64Data.substring(0, Math.min(100, fileSize));
        const end = base64Data.substring(Math.max(0, fileSize - 100));
        chunks.push(start, end);

        let hashInput;
        if (fromServer) {
            hashInput = `${chunks.join('|')}|${userId}|${fileSize}|${messageId}|${timestamp}`;
        } else {
            hashInput = `${chunks.join('|')}|${timestamp}|${randomSuffix}|${userId}|${fileSize}|${messageId}`;
        }

        const hash = simpleHash(hashInput);
        const contentHash = simpleHash(base64Data.substring(0, Math.min(1000, fileSize)));
        const finalHash = simpleHash(hash + contentHash + timestamp.toString());
        const uniqueHash = btoa(finalHash + randomSuffix + fileSize).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);

        return uniqueHash;
    };

    // Проверка существования файла с данным хэшем
    const checkHashExists = async (hash: string, mediaType: 'image' | 'video'): Promise<boolean> => {
        try {
            const documentsDir = FileSystem.documentDirectory;
            const fileName = `${hash}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;
            const fileUri = `${documentsDir}chat_media/${fileName}`;

            const fileInfo = await FileSystem.getInfoAsync(fileUri);
            const exists = fileInfo.exists && fileInfo.size > 0;

            if (mediaType === 'video' && exists) {
                // Для видео дополнительно проверяем минимальный размер (видео не может быть слишком маленьким)
                const minVideoSize = 1000; // Минимум 1KB для видеофайла
                if (fileInfo.size < minVideoSize) {
                    console.log('📷 [CACHE] Video file too small, considering as corrupted:', {
                        fileName: fileName,
                        size: fileInfo.size,
                        minRequired: minVideoSize
                    });
                    return false;
                }
            }

            return exists;
        } catch (error) {
            console.error('📷 [CACHE] Error checking file existence:', error);
            return false;
        }
    };

    // Сохранение медиафайла на устройстве с хэшем
    const saveMediaToDevice = async (base64Data: string, mediaType: 'image' | 'video', mediaHash?: string): Promise<string> => {
        try {
            const documentsDir = FileSystem.documentDirectory;
            let hash = mediaHash;

            if (!hash) {
                hash = generateMediaHash(base64Data);
            }

            const fileSizeInMB = (base64Data.length * 0.75) / (1024 * 1024);

            const dirUri = `${documentsDir}chat_media/`;
            const dirInfo = await FileSystem.getInfoAsync(dirUri);
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
            }

            let fileName = `${hash}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;
            let fileUri = `${documentsDir}chat_media/${fileName}`;

            // Проверяем коллизии хэшей
            let attempt = 0;
            while (await checkHashExists(hash, mediaType) && attempt < 10) {
                try {
                    const existingData = await FileSystem.readAsStringAsync(fileUri, {
                        encoding: FileSystem.EncodingType.Base64,
                    });

                    if (existingData === base64Data) {
                        return fileUri; // Файл уже существует
                    }

                    // Коллизия хэша, генерируем новый
                    hash = generateMediaHash(base64Data, {
                        collision: attempt,
                        timestamp: Date.now(),
                        additionalEntropy: Math.random().toString(36)
                    });
                    fileName = `${hash}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;
                    fileUri = `${documentsDir}chat_media/${fileName}`;
                    attempt++;
                } catch (readError) {
                    console.error('Error reading existing file:', readError);
                    break;
                }
            }

            // Проверяем место на диске для больших файлов
            if (fileSizeInMB > 100) {
                try {
                    const diskInfo = await FileSystem.getFreeDiskStorageAsync();
                    const requiredSpace = base64Data.length * 1.5;

                    if (diskInfo < requiredSpace) {
                        throw new Error(`Недостаточно места на диске. Требуется: ${(requiredSpace / (1024 * 1024)).toFixed(1)}MB`);
                    }
                } catch (diskError) {
                    console.warn('Could not check disk space:', diskError);
                }
            }

            await FileSystem.writeAsStringAsync(fileUri, base64Data, {
                encoding: FileSystem.EncodingType.Base64,
            });

            // Проверяем сохранение больших файлов
            if (fileSizeInMB > 50) {
                const savedFileInfo = await FileSystem.getInfoAsync(fileUri);
                if (!savedFileInfo.exists || savedFileInfo.size === 0) {
                    throw new Error('Файл не был сохранен корректно');
                }
            }

            return fileUri;
        } catch (error) {
            console.error('Error saving file:', error);
            throw error;
        }
    };

    // Получение медиафайла из кэша по хэшу
    const getMediaFromCache = async (mediaHash: string, mediaType: 'image' | 'video'): Promise<string | null> => {
        try {
            const documentsDir = FileSystem.documentDirectory;
            const fileName = `${mediaHash}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;
            const fileUri = `${documentsDir}chat_media/${fileName}`;

            const fileInfo = await FileSystem.getInfoAsync(fileUri);

            // Проверяем основной файл
            if (fileInfo.exists && fileInfo.size > 0) {
                // Для видео файлов дополнительная проверка минимального размера
                const minSize = mediaType === 'video' ? 1000 : 100; // 1KB для видео, 100B для изображений

                if (fileInfo.size >= minSize) {
                    console.log('📱 [CACHE] Found valid cached media:', {
                        fileName: fileName,
                        size: (fileInfo.size / (1024 * 1024)).toFixed(2) + 'MB',
                        hash: mediaHash.substring(0, 16) + '...'
                    });
                    return fileUri;
                } else {
                    console.log('📱 [CACHE] File too small, considering corrupted:', {
                        fileName: fileName,
                        size: fileInfo.size,
                        minSize: minSize
                    });
                }
            }

            // Если основной файл не найден или поврежден, ищем альтернативные варианты
            if (fileInfo.exists && fileInfo.size === 0) {
                console.log('📱 [CACHE] Found empty cached file, removing:', fileName);
                try {
                    await FileSystem.deleteAsync(fileUri);
                } catch (deleteError) {
                    console.error('📱 [CACHE] Error deleting empty file:', deleteError);
                }
            }

            // УЛУЧШЕННЫЙ поиск альтернативных файлов
            try {
                const mediaDir = `${documentsDir}chat_media/`;
                const dirInfo = await FileSystem.getInfoAsync(mediaDir);

                if (dirInfo.exists) {
                    const files = await FileSystem.readDirectoryAsync(mediaDir);
                    const extension = mediaType === 'image' ? '.jpg' : '.mp4';

                    console.log('📱 [CACHE] Starting comprehensive search:', {
                        searchHash: mediaHash.substring(0, 16) + '...',
                        totalFiles: files.length,
                        targetType: mediaType
                    });

                    // Метод 1: Поиск по префиксу хэша (разной длины)
                    const prefixLengths = [32, 24, 16, 12, 8]; // Разные длины префиксов

                    for (const prefixLength of prefixLengths) {
                        const hashPrefix = mediaHash.substring(0, Math.min(prefixLength, mediaHash.length));
                        const matchingFiles = files.filter(file =>
                            file.startsWith(hashPrefix) && file.endsWith(extension)
                        );

                        for (const matchingFile of matchingFiles) {
                            const matchingFileUri = `${mediaDir}${matchingFile}`;
                            const matchingFileInfo = await FileSystem.getInfoAsync(matchingFileUri);

                            if (matchingFileInfo.exists && matchingFileInfo.size > 0) {
                                const minSize = mediaType === 'video' ? 1000 : 100;

                                if (matchingFileInfo.size >= minSize) {
                                    console.log('📱 [CACHE] ✅ Found by prefix match:', {
                                        originalHash: mediaHash.substring(0, 16) + '...',
                                        foundFile: matchingFile,
                                        prefixLength: prefixLength,
                                        size: (matchingFileInfo.size / (1024 * 1024)).toFixed(2) + 'MB'
                                    });
                                    return matchingFileUri;
                                }
                            }
                        }
                    }

                    // Метод 2: Поиск по части хэша в любом месте имени файла
                    const coreHash = mediaHash.substring(8, 24); // Берем среднюю часть хэша
                    const containsHashFiles = files.filter(file =>
                        file.includes(coreHash) && file.endsWith(extension)
                    );

                    for (const matchingFile of containsHashFiles) {
                        const matchingFileUri = `${mediaDir}${matchingFile}`;
                        const matchingFileInfo = await FileSystem.getInfoAsync(matchingFileUri);

                        if (matchingFileInfo.exists && matchingFileInfo.size > 0) {
                            const minSize = mediaType === 'video' ? 1000 : 100;

                            if (matchingFileInfo.size >= minSize) {
                                console.log('📱 [CACHE] ✅ Found by core hash match:', {
                                    originalHash: mediaHash.substring(0, 16) + '...',
                                    foundFile: matchingFile,
                                    coreHash: coreHash,
                                    size: (matchingFileInfo.size / (1024 * 1024)).toFixed(2) + 'MB'
                                });
                                return matchingFileUri;
                            }
                        }
                    }

                    // Метод 3: Поиск по типу и размеру файла (для недавних файлов)
                    const typeFiles = files.filter(file => file.endsWith(extension));
                    const now = Date.now();

                    for (const typeFile of typeFiles) {
                        const typeFileUri = `${mediaDir}${typeFile}`;
                        const typeFileInfo = await FileSystem.getInfoAsync(typeFileUri);

                        if (typeFileInfo.exists && typeFileInfo.size > 0) {
                            const minSize = mediaType === 'video' ? 1000 : 100;
                            const fileAge = now - typeFileInfo.modificationTime;
                            const isRecent = fileAge < 2 * 60 * 60 * 1000; // Менее 2 часов

                            if (typeFileInfo.size >= minSize && isRecent) {
                                // Дополнительная проверка: файл должен быть достаточно большим для видео
                                const isLikelyMatch = mediaType === 'image' ||
                                    (mediaType === 'video' && typeFileInfo.size > 100000); // >100KB для видео

                                if (isLikelyMatch) {
                                    console.log('📱 [CACHE] ✅ Found by type and recency:', {
                                        originalHash: mediaHash.substring(0, 16) + '...',
                                        foundFile: typeFile,
                                        size: (typeFileInfo.size / (1024 * 1024)).toFixed(2) + 'MB',
                                        ageMinutes: Math.round(fileAge / (1000 * 60))
                                    });
                                    return typeFileUri;
                                }
                            }
                        }
                    }
                }
            } catch (dirError) {
                console.error('📱 [CACHE] Error in comprehensive search:', dirError);
            }

            console.log('📱 [CACHE] Media not found in cache (tried all methods):', {
                fileName: fileName,
                hash: mediaHash.substring(0, 16) + '...',
                type: mediaType
            });
            return null;
        } catch (error) {
            console.error('📱 [CACHE] Error getting file from cache:', error);
            return null;
        }
    };

    // Сохранение метаданных медиафайла
    const saveMediaMetadata = async (mediaHash: string, metadata: any) => {
        try {
            const metadataKey = `media_${mediaHash}`;
            await AsyncStorage.setItem(metadataKey, JSON.stringify(metadata));
        } catch (error) {
            console.error('Ошибка сохранения метаданных:', error);
        }
    };

    // Получение метаданных медиафайла
    const getMediaMetadata = async (mediaHash: string) => {
        try {
            const metadataKey = `media_${mediaHash}`;
            const metadata = await AsyncStorage.getItem(metadataKey);
            return metadata ? JSON.parse(metadata) : null;
        } catch (error) {
            console.error('Ошибка получения метаданных:', error);
            return null;
        }
    };

    // Диагностическая функция для анализа состояния кэша больших файлов
    const diagnoseLargeFilesCache = async () => {
        try {
            console.log('🔍 [DIAGNOSIS] === DIAGNOSING LARGE FILES CACHE ===');

            // Проверяем список больших файлов
            const largeFilesList = await AsyncStorage.getItem('large_files_list');
            if (largeFilesList) {
                const files = JSON.parse(largeFilesList);
                console.log('🔍 [DIAGNOSIS] Large files in tracking list:', files.length);

                for (let i = 0; i < Math.min(files.length, 5); i++) {
                    const file = files[i];
                    console.log(`🔍 [DIAGNOSIS] File ${i+1}:`, {
                        messageId: file.messageId,
                        sizeMB: file.fileSizeMB,
                        savedAt: new Date(file.savedAt).toLocaleString(),
                        hash: file.mediaHash?.substring(0, 16) + '...'
                    });

                    // Проверяем, существует ли файл
                    if (file.savedUri) {
                        try {
                            const fileInfo = await FileSystem.getInfoAsync(file.savedUri);
                            console.log(`🔍 [DIAGNOSIS] File ${i+1} status:`, {
                                exists: fileInfo.exists,
                                size: fileInfo.exists ? (fileInfo.size / (1024*1024)).toFixed(1) + 'MB' : 'N/A'
                            });
                        } catch (checkError) {
                            console.log(`🔍 [DIAGNOSIS] File ${i+1} check failed:`, checkError.message);
                        }
                    }

                    // Проверяем backup метаданные
                    const backupKey = `large_media_${file.messageId}`;
                    const backupData = await AsyncStorage.getItem(backupKey);
                    console.log(`🔍 [DIAGNOSIS] File ${i+1} backup metadata:`, !!backupData);
                }
            } else {
                console.log('🔍 [DIAGNOSIS] No large files tracking list found');
            }

            // Проверяем директорию медиафайлов
            const documentsDir = FileSystem.documentDirectory;
            const mediaDir = `${documentsDir}chat_media/`;

            try {
                const files = await FileSystem.readDirectoryAsync(mediaDir);
                console.log('🔍 [DIAGNOSIS] Files in media directory:', files.length);

                let largeFilesCount = 0;
                for (const fileName of files) {
                    const filePath = `${mediaDir}${fileName}`;
                    const fileInfo = await FileSystem.getInfoAsync(filePath);
                    if (fileInfo.size > 15 * 1024 * 1024) { // >15MB
                        largeFilesCount++;
                    }
                }
                console.log('🔍 [DIAGNOSIS] Large files (>15MB) in directory:', largeFilesCount);

            } catch (dirError) {
                console.log('🔍 [DIAGNOSIS] Media directory check failed:', dirError.message);
            }

        } catch (error) {
            console.error('🔍 [DIAGNOSIS] Diagnosis failed:', error);
        }
    };

    // Функция очистки старых медиафайлов (вызывается при запуске)
    const cleanupOldMediaFiles = async () => {
        try {
            console.log('🧹 [CLEANUP] Starting media files cleanup');
            const documentsDir = FileSystem.documentDirectory;
            const mediaDir = `${documentsDir}chat_media/`;

            // Проверяем, существует ли директория
            const dirInfo = await FileSystem.getInfoAsync(mediaDir);
            if (!dirInfo.exists) {
                console.log('🧹 [CLEANUP] Media directory does not exist, nothing to cleanup');
                return;
            }

            // Получаем список всех файлов в директории медиа
            const files = await FileSystem.readDirectoryAsync(mediaDir);
            console.log('🧹 [CLEANUP] Found media files:', files.length);

            let cleanedCount = 0;
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 дней в миллисекундах
            const now = Date.now();

            for (const fileName of files) {
                try {
                    const filePath = `${mediaDir}${fileName}`;
                    const fileInfo = await FileSystem.getInfoAsync(filePath);

                    // Файлы старше 7 дней удаляем (кроме последних отправленных)
                    const fileAge = now - fileInfo.modificationTime;
                    if (fileAge > maxAge) {
                        // Извлекаем хэш из имени файла
                        const hash = fileName.split('.')[0];
                        const metadata = await getMediaMetadata(hash);

                        // Удаляем только если это не файл из недавних сообщений
                        if (!metadata || (now - metadata.savedAt) > maxAge) {
                            await FileSystem.deleteAsync(filePath);
                            if (metadata) {
                                await AsyncStorage.removeItem(`media_${hash}`);
                            }
                            cleanedCount++;
                            console.log('🧹 [CLEANUP] Deleted old file:', fileName);
                        }
                    }
                } catch (fileError) {
                    console.error('🧹 [CLEANUP] Error processing file:', fileName, fileError);
                }
            }

            console.log('🧹 [CLEANUP] Cleanup completed:', {
                totalFiles: files.length,
                deletedFiles: cleanedCount
            });

        } catch (error) {
            console.error('🧹 [CLEANUP] Error during cleanup:', error);
        }
    };

    // Выбор изображения
    const pickImage = async () => {
        console.log('📷 [PICKER] Starting image picker...');
        try {
            const hasPermission = await requestPermissions();
            if (!hasPermission) {
                console.log('📷 [PICKER] ❌ No permission for media library');
                return;
            }

            console.log('📷 [PICKER] Launching image library...');
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: false,
                quality: 0.8,
                base64: true,
            });

            console.log('📷 [PICKER] Image picker result:', {
                canceled: result.canceled,
                assetsCount: result.assets?.length || 0
            });

            if (!result.canceled && result.assets[0]) {
                const asset = result.assets[0];
                console.log('📷 [PICKER] Asset details:', {
                    hasBase64: !!asset.base64,
                    base64Length: asset.base64?.length || 0,
                    uri: asset.uri,
                    width: asset.width,
                    height: asset.height,
                    fileSize: asset.fileSize,
                    fileName: asset.fileName
                });

                if (asset.base64) {
                    console.log('📷 [PICKER] Sending unique image with timestamp:', Date.now());
                    await sendMediaMessage(asset.base64, 'image');
                } else {
                    console.log('📷 [PICKER] ❌ No base64 data in asset, trying to convert from URI');

                    // Проверяем размер файла перед конвертацией
                    if (asset.fileSize) {
                        const fileSizeMB = asset.fileSize / (1024 * 1024);
                        console.log('📷 [PICKER] File size before conversion:', fileSizeMB.toFixed(1) + 'MB');

                        // Для очень больших изображений уведомляем об ограничениях P2P
                        if (fileSizeMB > 100) {
                            console.log('📷 [PICKER] Large image detected - P2P size limit');
                            Alert.alert(
                                'Изображение слишком большое',
                                `Размер: ${fileSizeMB.toFixed(1)}MB\nМаксимум для P2P передачи: 100MB\n\nДля передачи больших файлов используйте облачные хранилища.`,
                                [{ text: 'Понятно' }]
                            );
                            return;
                        }
                    }

                    try {
                        console.log('📷 [PICKER] Starting URI to base64 conversion...');
                        const base64 = await convertToBase64(asset.uri);
                        console.log('📷 [PICKER] Successfully converted URI to base64, length:', base64.length);
                        await sendMediaMessage(base64, 'image');
                    } catch (convertError) {
                        console.error('📷 [PICKER] ❌ Failed to convert URI to base64:', convertError);

                        const errorMessage = convertError.toString();

                        if (errorMessage.includes('OutOfMemoryError') || errorMessage.includes('allocation') || errorMessage.includes('memory')) {
                            Alert.alert(
                                'Недостаточно памяти',
                                `Изображение слишком большое для обработки в памяти.\n\nРазмер: ${asset.fileSize ? Math.round(asset.fileSize / (1024 * 1024)) + 'MB' : 'неизвестно'}\n\nПопробуйте:\n• Выбрать изображение меньшего размера\n• Сжать изображение в другом приложении\n• Перезапустить приложение`,
                                [
                                    { text: 'Понятно', style: 'default' },
                                    {
                                        text: 'Попробовать прямую загрузку',
                                        style: 'default',
                                        onPress: async () => {
                                            try {
                                                console.log('📷 [PICKER] Trying direct upload after memory error...');
                                                await sendMediaMessageDirect(asset.uri, 'image', asset.fileSize);
                                            } catch (directError) {
                                                console.error('📷 [PICKER] Direct upload also failed:', directError);
                                                Alert.alert('Ошибка', 'Не удалось загрузить изображение. Попробуйте выбрать файл меньшего размера.');
                                            }
                                        }
                                    }
                                ]
                            );
                        } else if (errorMessage.includes('слишком большой') || errorMessage.includes('30MB')) {
                            Alert.alert(
                                'Файл слишком большой',
                                `Размер изображения превышает лимит для обычной загрузки.\n\nРазмер: ${asset.fileSize ? Math.round(asset.fileSize / (1024 * 1024)) + 'MB' : 'неизвестно'}\nЛимит: 30MB\n\nИспользовать прямую загрузку?`,
                                [
                                    { text: 'Отмена', style: 'cancel' },
                                    {
                                        text: 'Загрузить напрямую',
                                        style: 'default',
                                        onPress: async () => {
                                            try {
                                                await sendMediaMessageDirect(asset.uri, 'image', asset.fileSize);
                                            } catch (directError) {
                                                console.error('📷 [PICKER] Direct upload failed:', directError);
                                                Alert.alert('Ошибка', 'Не удалось загрузить изображение прямым способом.');
                                            }
                                        }
                                    }
                                ]
                            );
                        } else {
                            // Обычная ошибка конвертации
                            Alert.alert(
                                'Ошибка обработки изображения',
                                `Не удалось получить данные изображения.\n\nОшибка: ${convertError.message || 'Неизвестная ошибка'}\n\nПопробуйте:\n• Выбрать другое изображение\n• Перезапустить приложение\n• Проверить свободное место на устройстве`
                            );
                        }
                    }
                }

            }
        } catch (error) {
            console.error('📷 [PICKER] ❌ Error picking image:', error);
            Alert.alert('Ошибка', 'Не удалось выбрать изображение');
        }
    };

    // Выбор документов
    const pickDocument = async () => {
        console.log('📄 [PICKER] Starting document picker...');
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: '*/*',
                copyToCacheDirectory: true,
                multiple: false,
            });

            console.log('📄 [PICKER] Document picker result:', {
                canceled: result.canceled,
                type: result.type
            });

            if (!result.canceled && result.assets && result.assets[0]) {
                const asset = result.assets[0];
                console.log('📄 [PICKER] Document details:', {
                    name: asset.name,
                    size: asset.size,
                    mimeType: asset.mimeType,
                    uri: asset.uri
                });

                // Проверяем размер файла (максимум 100MB для документов)
                const maxSize = 100 * 1024 * 1024; // 100MB
                if (asset.size && asset.size > maxSize) {
                    Alert.alert(
                        'Файл слишком большой',
                        `Размер: ${Math.round(asset.size / 1024 / 1024)}MB. Максимальный размер для документов: 100MB.`
                    );
                    return;
                }

                const fileSizeMB = asset.size ? asset.size / (1024 * 1024) : 0;

                try {
                    if (fileSizeMB > 10) {
                        // Для больших документов используем прямую загрузку
                        console.log('📄 [PICKER] Using direct upload for large document');
                        await sendDocumentDirect(asset.uri, asset.name || 'document', asset.mimeType || 'application/octet-stream', asset.size);
                    } else {
                        // Для небольших документов используем base64
                        console.log('📄 [PICKER] Converting document to base64...');
                        const base64 = await convertToBase64(asset.uri);
                        await sendDocumentMessage(base64, asset.name || 'document', asset.mimeType || 'application/octet-stream', asset.size);
                    }
                } catch (error) {
                    console.error('📄 [PICKER] ❌ Document processing failed:', error);
                    Alert.alert('Ошибка', 'Не удалось обработать документ. Попробуйте выбрать другой файл.');
                }
            }
        } catch (error) {
            console.error('📄 [PICKER] ❌ Error picking document:', error);
            Alert.alert('Ошибка', 'Не удалось выбрать документ');
        }
    };

    // Выбор видео
    const pickVideo = async () => {
        console.log('🎥 [PICKER] Starting video picker...');
        try {
            const hasPermission = await requestPermissions();
            if (!hasPermission) {
                console.log('🎥 [PICKER] ❌ No permission for media library');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['videos'],
                allowsEditing: true,
                quality: 0.3, // Снижаем качество для уменьшения размера
                videoMaxDuration: 60, // Ограничиваем длительность видео до 60 секунд
            });

            console.log('🎥 [PICKER] Video picker result:', {
                canceled: result.canceled,
                assetsCount: result.assets?.length || 0
            });

            if (!result.canceled && result.assets[0]) {
                const asset = result.assets[0];
                console.log('🎥 [PICKER] Video asset details:', {
                    uri: asset.uri,
                    duration: asset.duration,
                    width: asset.width,
                    height: asset.height,
                    fileSize: asset.fileSize,
                    fileName: asset.fileName,
                    uniqueId: Date.now() + Math.random()
                });

                // Проверяем размер файла (ограничиваем до 300MB согласно настройкам сервера)
                const maxVideoSize = 300 * 1024 * 1024; // 300MB
                if (asset.fileSize && asset.fileSize > maxVideoSize) {
                    Alert.alert(
                        'Файл слишком большой',
                        `Размер видео: ${Math.round(asset.fileSize / 1024 / 1024)}MB. Максимальный размер: 300MB. Попробуйте выбрать более короткое видео или уменьшить качество.`
                    );
                    return;
                }

                // Проверяем длительность видео (ограничиваем до 10 минут)
                const maxDuration = 600000; // 10 минут в миллисекундах
                if (asset.duration && asset.duration > maxDuration) {
                    Alert.alert(
                        'Видео слишком длинное',
                        `Длительность: ${Math.round(asset.duration / 1000)}сек. Максимальная длительность: 10 минут.`
                    );
                    return;
                }

                try {
                    const fileSizeMB = asset.fileSize ? asset.fileSize / (1024 * 1024) : 0;

                    // Проверяем формат видео
                    const videoInfo = {
                        uri: asset.uri,
                        fileName: asset.fileName,
                        mimeType: asset.mimeType,
                        duration: asset.duration,
                        width: asset.width,
                        height: asset.height
                    };

                    console.log('🎥 [PICKER] Processing video file:', {
                        sizeMB: fileSizeMB.toFixed(1),
                        uri: asset.uri,
                        fileName: asset.fileName,
                        mimeType: asset.mimeType,
                        duration: asset.duration ? Math.round(asset.duration / 1000) + 's' : 'unknown',
                        resolution: `${asset.width}x${asset.height}`,
                        strategy: fileSizeMB > 30 ? 'direct_upload' : 'base64_conversion'
                    });

                    // Проверяем совместимость формата
                    const supportedFormats = ['video/mp4', 'video/mov', 'video/avi', 'video/quicktime'];
                    const isUnsupportedFormat = asset.mimeType && !supportedFormats.some(format =>
                        asset.mimeType?.includes(format.split('/')[1])
                    );

                    if (isUnsupportedFormat) {
                        const shouldContinue = await new Promise<boolean>((resolve) => {
                            Alert.alert(
                                'Неподдерживаемый формат',
                                `Формат видео "${asset.mimeType}" может не воспроизводиться корректно.\n\nРекомендуемые форматы: MP4, MOV\n\nПродолжить загрузку?`,
                                [
                                    { text: 'Отмена', style: 'cancel', onPress: () => resolve(false) },
                                    { text: 'Продолжить', style: 'default', onPress: () => resolve(true) }
                                ]
                            );
                        });

                        if (!shouldContinue) return;
                    }

                    // Для файлов больше 30MB используем прямую загрузку без base64
                    if (fileSizeMB > 30) {
                        console.log('🎥 [PICKER] Using direct file upload for large video');
                        await sendMediaMessageDirect(asset.uri, 'video', asset.fileSize);
                    } else {
                        console.log('🎥 [PICKER] Converting smaller video to base64...');

                        // Для небольших файлов используем base64
                        const base64 = await convertToBase64(asset.uri);

                        console.log('🎥 [PICKER] Video converted successfully:', {
                            originalFileSize: asset.fileSize,
                            base64Length: base64.length,
                            compressionRatio: asset.fileSize ? (base64.length / asset.fileSize * 100).toFixed(1) + '%' : 'unknown',
                            timestamp: Date.now()
                        });

                        await sendMediaMessage(base64, 'video');
                    }

                } catch (conversionError) {
                    console.error('🎥 [PICKER] ❌ Video processing failed:', conversionError);

                    // Проверяем, является ли это ошибкой памяти
                    const errorMessage = conversionError.toString();
                    if (errorMessage.includes('OutOfMemoryError') || errorMessage.includes('allocation')) {
                        Alert.alert(
                            'Не хватает памяти',
                            `Видео размером ${Math.round(asset.fileSize / (1024 * 1024))}MB слишком большое для обработки в памяти.\n\nПопробуйте:\n• Выбрать более короткое видео\n• Сжать видео в другом приложении\n• Перезапустить приложение для очистки памяти`,
                            [
                                { text: 'Понятно', style: 'default' },
                                {
                                    text: 'Попробовать прямую загрузку',
                                    style: 'default',
                                    onPress: async () => {
                                        try {
                                            console.log('🎥 [PICKER] Trying direct upload after memory error...');
                                            await sendMediaMessageDirect(asset.uri, 'video', asset.fileSize);
                                        } catch (directError) {
                                            console.error('🎥 [PICKER] Direct upload also failed:', directError);
                                            Alert.alert('Ошибка', 'Не удалось загрузить файл прямым способом. Попробуйте выбрать файл меньшего размера.');
                                        }
                                    }
                                }
                            ]
                        );
                    } else {
                        Alert.alert('Ошибка', 'Не удалось обработать видео. Попробуйте выбрать другой файл.');
                    }
                }
            }
        } catch (error) {
            console.error('🎥 [PICKER] ❌ Error picking video:', error);
            Alert.alert('Ошибка', 'Не удалось выбрать видео');
        }
    };

    // Отправка документа через base64
    const sendDocumentMessage = async (base64Data: string, fileName: string, mimeType: string, fileSize?: number) => {
        if (!isConnected || !isDataLoaded || !recipient?.id || !currentUserId) {
            Alert.alert('Ошибка', 'Не удается отправить документ');
            return;
        }

        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const messageId = Date.now();
            const mediaHash = generateMediaHash(base64Data, { timestamp, messageId, senderId: currentUserId });

            // Создаем оптимистичное сообщение
            const optimisticMessage: Message = {
                id: messageId,
                message: `📄 Загрузка документа "${fileName}"...`,
                timestamp: timestamp,
                sender__username: currentUsername,
                sender_id: currentUserId,
                mediaType: 'file',
                mediaUri: null,
                mediaBase64: base64Data,
                mediaHash: mediaHash,
                mediaFileName: fileName,
                mediaSize: fileSize || base64Data.length,
                mimeType: mimeType,
                isUploading: true,
                uploadProgress: 0
            };

            setMessages(prev => [optimisticMessage, ...prev]);

            // Создаем временный файл для загрузки
            const fileExtension = fileName.split('.').pop() || 'bin';
            const tempUri = `${FileSystem.cacheDirectory}temp_${messageId}.${fileExtension}`;
            await FileSystem.writeAsStringAsync(tempUri, base64Data, {
                encoding: FileSystem.EncodingType.Base64
            });

            // Загружаем на сервер
            const fileUrl = await uploadFileGeneric(
                tempUri,
                fileName,
                mimeType,
                messageId,
                (progress) => {
                    setMessages(prev =>
                        prev.map(msg => {
                            if (msg.id === messageId) {
                                return {
                                    ...msg,
                                    uploadProgress: progress,
                                    message: `📄 Загрузка "${fileName}"... ${progress}%`
                                };
                            }
                            return msg;
                        })
                    );
                }
            );

            // Удаляем временный файл
            await FileSystem.deleteAsync(tempUri, { idempotent: true });

            // Обновляем сообщение с URL сервера
            setMessages(prev =>
                prev.map(msg => {
                    if (msg.id === messageId) {
                        return {
                            ...msg,
                            isUploading: false,
                            uploadProgress: 100,
                            message: `📄 ${fileName}`,
                            serverFileUrl: fileUrl
                        };
                    }
                    return msg;
                })
            );

            // Отправляем уведомление через WebSocket
            const messageData = {
                type: 'media_message',
                message: `📄 ${fileName}`,
                mediaType: 'file',
                mediaHash: mediaHash,
                fileUrl: fileUrl,
                fileName: fileName,
                mimeType: mimeType,
                timestamp: timestamp,
                user1: currentUserId,
                user2: recipient.id,
                id: messageId
            };

            sendMessage(messageData);

        } catch (error) {
            console.error('Ошибка отправки документа:', error);
            Alert.alert('Ошибка', 'Не удалось отправить документ');
        }
    };

    // Отправка документа напрямую (без base64)
    const sendDocumentDirect = async (fileUri: string, fileName: string, mimeType: string, fileSize?: number) => {
        console.log('📤 [DIRECT-DOC] ========== SENDING DOCUMENT DIRECT ==========');

        if (!isConnected || !isDataLoaded || !recipient?.id || !currentUserId) {
            Alert.alert('Ошибка', 'Не удается отправить документ');
            return;
        }

        const fileInfo = await FileSystem.getInfoAsync(fileUri);
        if (!fileInfo.exists) {
            Alert.alert('Ошибка', 'Файл не найден');
            return;
        }

        const actualFileSize = fileInfo.size;
        const fileSizeMB = actualFileSize / (1024 * 1024);

        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const messageId = Date.now();
            const mediaHash = `doc_${messageId}_${actualFileSize}_${timestamp}`;

            // Создаем оптимистичное сообщение
            const optimisticMessage: Message = {
                id: messageId,
                message: `📄 Загрузка документа "${fileName}"...`,
                timestamp: timestamp,
                sender__username: currentUsername,
                sender_id: currentUserId,
                mediaType: 'file',
                mediaUri: fileUri,
                mediaBase64: undefined,
                mediaHash: mediaHash,
                mediaFileName: fileName,
                mediaSize: actualFileSize,
                mimeType: mimeType,
                isUploading: true,
                uploadProgress: 0,
                uploadMethod: fileSizeMB > 50 ? 'chunk' : 'http'
            };

            setMessages(prev => [optimisticMessage, ...prev]);

            // Загружаем файл
            const fileUrl = await uploadFileGeneric(
                fileUri,
                fileName,
                mimeType,
                messageId,
                (progress) => {
                    setMessages(prev =>
                        prev.map(msg => {
                            if (msg.id === messageId) {
                                return {
                                    ...msg,
                                    uploadProgress: progress,
                                    message: `📄 Загрузка "${fileName}"... ${progress}%`
                                };
                            }
                            return msg;
                        })
                    );
                }
            );

            // Обновляем сообщение после успешной загрузки
            setMessages(prev =>
                prev.map(msg => {
                    if (msg.id === messageId) {
                        return {
                            ...msg,
                            isUploading: false,
                            uploadProgress: 100,
                            message: `📄 ${fileName}`,
                            serverFileUrl: fileUrl
                        };
                    }
                    return msg;
                })
            );

            // Отправляем уведомление через WebSocket
            const messageData = {
                type: 'media_message',
                message: `📄 ${fileName}`,
                mediaType: 'file',
                mediaHash: mediaHash,
                fileUrl: fileUrl,
                fileName: fileName,
                mimeType: mimeType,
                timestamp: timestamp,
                user1: currentUserId,
                user2: recipient.id,
                id: messageId
            };

            sendMessage(messageData);

        } catch (error) {
            console.error('📤 [DIRECT-DOC] ❌ Error uploading document:', error);

            setMessages(prev =>
                prev.map(msg => {
                    if (msg.id === messageId) {
                        return {
                            ...msg,
                            isUploading: false,
                            message: `❌ Ошибка загрузки документа "${fileName}"`,
                            uploadProgress: 0
                        };
                    }
                    return msg;
                })
            );

            Alert.alert('Ошибка', 'Не удалось отправить документ');
        }
    };

    // Универсальная функция загрузки файлов
    const uploadFileGeneric = async (
        fileUri: string,
        fileName: string,
        mimeType: string,
        messageId: number,
        onProgress?: (progress: number) => void
    ): Promise<string> => {
        try {
            const token = await getToken();
            if (!token) {
                throw new Error('Нет токена авторизации');
            }
            const formData = new FormData();

            // Определяем тип файла для правильного endpoint
            let endpoint = `${API_CONFIG.BASE_URL}/media-api/upload/file/`;

            if (mimeType.startsWith('image/')) {
                endpoint = `${API_CONFIG.BASE_URL}/media-api/upload/image/`;
            } else if (mimeType.startsWith('video/')) {
                endpoint = `${API_CONFIG.BASE_URL}/media-api/upload/video/`;
            }

            // Для видео файлов убеждаемся в правильном MIME типе
            let finalMimeType = mimeType;
            if (mimeType.startsWith('video/') && !mimeType.includes('mp4') && !mimeType.includes('mov') && !mimeType.includes('avi')) {
                // Если неизвестный видео формат, принудительно устанавливаем mp4
                finalMimeType = 'video/mp4';
                console.log('🎥 [UPLOAD] Corrected MIME type from', mimeType, 'to', finalMimeType);
            }

            formData.append('file', {
                uri: fileUri,
                type: finalMimeType,
                name: fileName
            } as any);

            console.log('📤 [UPLOAD] Upload details:', {
                fileName: fileName,
                originalMimeType: mimeType,
                finalMimeType: finalMimeType,
                endpoint: endpoint,
                fileUri: fileUri.substring(fileUri.lastIndexOf('/') + 1)
            });

            // Добавляем публичный доступ для чатов
            formData.append('is_public', 'true');

            if (onProgress) {
                onProgress(10);
            }

            const response = await axios.post(
                endpoint,
                formData,
                {
                    headers: {
                        'Authorization': `Token ${token}`,
                        'Content-Type': 'multipart/form-data',
                    },
                    timeout: 600000, // 10 минут
                    onUploadProgress: (progressEvent) => {
                        if (progressEvent.total) {
                            const progress = Math.round((progressEvent.loaded / progressEvent.total) * 90) + 10;
                            if (onProgress) {
                                onProgress(progress);
                            }
                        }
                    }
                }
            );

            if (onProgress) {
                onProgress(100);
            }

            if (!response.data.success) {
                throw new Error(response.data.message || 'Загрузка не удалась');
            }

            return response.data.file.file_url;

        } catch (error) {
            console.error('Ошибка загрузки файла:', error);
            throw error;
        }
    };

    // Отправка медиа сообщения напрямую через файл (без base64)
    const sendMediaMessageDirect = async (fileUri: string, mediaType: 'image' | 'video', fileSize?: number) => {
        console.log('📤 [DIRECT] ========== SENDING MEDIA FILE DIRECT ==========');
        console.log('📤 [DIRECT] File URI:', fileUri);
        console.log('📤 [DIRECT] Media type:', mediaType);
        console.log('📤 [DIRECT] File size:', fileSize);

        if (!isConnected || !isDataLoaded || !recipient?.id || !currentUserId) {
            console.log('📤 [DIRECT] ❌ Cannot send - missing requirements');
            Alert.alert('Ошибка', 'Не удается отправить медиафайл');
            return;
        }

        // Проверяем файл
        const fileInfo = await FileSystem.getInfoAsync(fileUri);
        if (!fileInfo.exists) {
            Alert.alert('Ошибка', 'Файл не найден');
            return;
        }

        const actualFileSize = fileInfo.size;
        const fileSizeMB = actualFileSize / (1024 * 1024);

        console.log('📤 [DIRECT] File info:', {
            exists: fileInfo.exists,
            size: actualFileSize,
            sizeMB: fileSizeMB.toFixed(1)
        });

        // Проверяем размер
        if (fileSizeMB > 2048) { // 2GB лимит
            Alert.alert('Файл слишком большой', `Размер: ${fileSizeMB.toFixed(1)}MB. Максимум: 2048MB`);
            return;
        }

        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const messageId = Date.now();

            // Генерируем хэш на основе метаданных файла (без чтения содержимого)
            const mediaHash = `file_${messageId}_${actualFileSize}_${timestamp}`;
            const mediaFileName = `${mediaHash}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;

            console.log('📤 [DIRECT] Generated metadata:', {
                messageId: messageId,
                mediaHash: mediaHash,
                mediaFileName: mediaFileName
            });

            // Создаем оптимистичное сообщение
            const optimisticMessage: Message = {
                id: messageId,
                message: mediaType === 'image' ? '📷 Загрузка изображения...' : '🎥 Загрузка видео...',
                timestamp: timestamp,
                sender__username: currentUsername,
                sender_id: currentUserId,
                mediaType: mediaType,
                mediaUri: fileUri, // Используем исходный URI
                mediaBase64: undefined, // Нет base64 данных
                mediaHash: mediaHash,
                mediaFileName: mediaFileName,
                mediaSize: actualFileSize,
                isUploading: true,
                uploadProgress: 0,
                uploadMethod: fileSizeMB > 100 ? 'chunk' : 'http'
            };

            // Добавляем сообщение в UI
            setMessages(prev => [optimisticMessage, ...prev]);

            // Прокручиваем к новому сообщению
            setTimeout(() => {
                if (flatListRef.current) {
                    flatListRef.current.scrollToIndex({ index: 0, animated: true });
                }
            }, 100);

            // Выбираем метод загрузки
            let uploadSuccess = false;
            let serverFileUrl = '';

            if (fileSizeMB > 100) {
                // Chunk upload для больших файлов
                console.log('📤 [DIRECT] Using chunk upload for large file');

                try {
                    serverFileUrl = await uploadLargeFileChunkedDirect(
                        fileUri,
                        mediaType,
                        messageId,
                        (progress) => {
                            setMessages(prev =>
                                prev.map(msg => {
                                    if (msg.id === messageId) {
                                        return {
                                            ...msg,
                                            uploadProgress: progress,
                                            message: `🚀 Загрузка ${mediaType === 'image' ? 'изображения' : 'видео'}... ${progress}%`
                                        };
                                    }
                                    return msg;
                                })
                            );
                        }
                    );
                    uploadSuccess = true;
                    console.log('📤 [DIRECT] Chunk upload successful');
                } catch (chunkError) {
                    console.error('📤 [DIRECT] Chunk upload failed:', chunkError);

                    // Если chunk upload не поддерживается, пробуем multipart
                    const errorMessage = chunkError.message || chunkError.toString();
                    if (errorMessage.includes('CHUNK_NOT_SUPPORTED') ||
                        (axios.isAxiosError(chunkError) && chunkError.response?.status === 404)) {

                        console.log('📤 [DIRECT] Chunk upload not supported, trying multipart...');

                        try {
                            const fileName = `media_${messageId}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;
                            const mimeType = mediaType === 'image' ? 'image/jpeg' : 'video/mp4';

                            serverFileUrl = await uploadFileGeneric(
                                fileUri,
                                fileName,
                                mimeType,
                                messageId,
                                (progress) => {
                                    setMessages(prev =>
                                        prev.map(msg => {
                                            if (msg.id === messageId) {
                                                return {
                                                    ...msg,
                                                    uploadProgress: progress,
                                                    message: `📤 Загрузка ${mediaType === 'image' ? 'изображения' : 'видео'}... ${progress}%`
                                                };
                                            }
                                            return msg;
                                        })
                                    );
                                }
                            );
                            uploadSuccess = true;
                            console.log('📤 [DIRECT] Fallback generic upload successful');
                        } catch (genericError) {
                            console.error('📤 [DIRECT] Fallback generic also failed:', genericError);
                        }
                    }
                }
            } else {
                // HTTP multipart upload для средних файлов
                console.log('📤 [DIRECT] Using HTTP multipart upload');

                try {
                    const fileName = `media_${messageId}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;
                    const mimeType = mediaType === 'image' ? 'image/jpeg' : 'video/mp4';

                    serverFileUrl = await uploadFileGeneric(
                        fileUri,
                        fileName,
                        mimeType,
                        messageId,
                        (progress) => {
                            setMessages(prev =>
                                prev.map(msg => {
                                    if (msg.id === messageId) {
                                        return {
                                            ...msg,
                                            uploadProgress: progress,
                                            message: `📤 Загрузка ${mediaType === 'image' ? 'изображения' : 'видео'}... ${progress}%`
                                        };
                                    }
                                    return msg;
                                })
                            );
                        }
                    );
                    uploadSuccess = true;
                    console.log('📤 [DIRECT] HTTP upload successful');
                } catch (httpError) {
                    console.error('📤 [DIRECT] HTTP upload failed:', httpError);

                    // Если multipart не поддерживается, пробуем конвертировать в base64
                    const errorMessage = httpError.message || httpError.toString();
                    if (errorMessage.includes('MULTIPART_NOT_SUPPORTED') ||
                        (axios.isAxiosError(httpError) && httpError.response?.status === 404)) {

                        console.log('📤 [DIRECT] Multipart not supported, trying base64 conversion...');

                        if (fileSizeMB <= 30) { // Только для файлов <= 30MB
                            try {
                                setMessages(prev =>
                                    prev.map(msg => {
                                        if (msg.id === messageId) {
                                            return {
                                                ...msg,
                                                message: `🔄 Конвертация в base64...`,
                                                uploadProgress: 20
                                            };
                                        }
                                        return msg;
                                    })
                                );

                                const base64 = await convertToBase64(fileUri);
                                await sendMediaMessage(base64, mediaType);

                                // Удаляем оригинальное сообщение, так как sendMediaMessage создает новое
                                setMessages(prev => prev.filter(msg => msg.id !== messageId));

                                console.log('📤 [DIRECT] ✅ Base64 fallback successful');
                                return; // Выходим из функции
                            } catch (base64Error) {
                                console.error('📤 [DIRECT] Base64 fallback failed:', base64Error);
                            }
                        } else {
                            console.log('📤 [DIRECT] File too large for base64 fallback:', fileSizeMB + 'MB');
                        }
                    }
                }
            }

            if (uploadSuccess && serverFileUrl) {
                // Обновляем сообщение после успешной загрузки
                setMessages(prev =>
                    prev.map(msg => {
                        if (msg.id === messageId) {
                            return {
                                ...msg,
                                isUploading: false,
                                uploadProgress: 100,
                                message: mediaType === 'image' ? '📷 Изображение' : '🎥 Видео',
                                serverFileUrl: serverFileUrl
                            };
                        }
                        return msg;
                    })
                );

                // Отправляем уведомление через WebSocket
                const messageData = {
                    type: 'media_message',
                    message: mediaType === 'image' ? '📷 Изображение' : '🎥 Видео',
                    mediaType: mediaType,
                    mediaHash: mediaHash,
                    fileUrl: serverFileUrl,
                    timestamp: timestamp,
                    user1: currentUserId,
                    user2: recipient.id,
                    id: messageId
                };

                sendMessage(messageData);

            } else {
                // Ошибка загрузки
                setMessages(prev =>
                    prev.map(msg => {
                        if (msg.id === messageId) {
                            return {
                                ...msg,
                                isUploading: false,
                                message: `❌ Ошибка загрузки ${mediaType === 'image' ? 'изображения' : 'видео'}`,
                                uploadProgress: 0
                            };
                        }
                        return msg;
                    })
                );

                Alert.alert('Ошибка', 'Не удалось отправить медиафайл');
            }

        } catch (error) {
            console.error('📤 [DIRECT] ❌ Error uploading file:', error);

            setMessages(prev =>
                prev.map(msg => {
                    if (msg.id === messageId) {
                        return {
                            ...msg,
                            isUploading: false,
                            message: `❌ Ошибка загрузки ${mediaType === 'image' ? 'изображения' : 'видео'}`,
                            uploadProgress: 0
                        };
                    }
                    return msg;
                })
            );

            Alert.alert('Ошибка', 'Не удалось отправить медиафайл');
        }
    };

    // Отправка медиа сообщения через HTTP multipart загрузку
    const sendMediaMessage = async (base64Data: string, mediaType: 'image' | 'video') => {
        if (!isConnected || !isDataLoaded || !recipient?.id || !currentUserId) {
            Alert.alert('Ошибка', 'Не удается отправить медиафайл');
            return;
        }

        const dataSizeInMB = (base64Data.length * 0.75) / (1024 * 1024);

        if (dataSizeInMB > 800) { // Лимит 800MB
            Alert.alert('Файл слишком большой', `Размер: ${dataSizeInMB.toFixed(1)}MB. Максимум: 800MB`);
            return;
        }

        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const messageId = Date.now();
            const mediaHash = generateMediaHash(base64Data, { timestamp, messageId, senderId: currentUserId });

            // Создаем оптимистичное сообщение
            const optimisticMessage: Message = {
                id: messageId,
                message: mediaType === 'image' ? '📷 Загрузка изображения...' : '🎥 Загрузка видео...',
                timestamp: timestamp,
                sender__username: currentUsername,
                sender_id: currentUserId,
                mediaType: mediaType,
                mediaUri: null,
                mediaBase64: base64Data,
                mediaHash: mediaHash,
                mediaFileName: `${mediaHash}.${mediaType === 'image' ? 'jpg' : 'mp4'}`,
                mediaSize: base64Data.length,
                isUploading: true,
                uploadProgress: 0
            };

            setMessages(prev => [optimisticMessage, ...prev]);

            // Сохраняем локально
            const savedUri = await saveMediaToDevice(base64Data, mediaType, mediaHash);

            // Обновляем с локальным URI
            setMessages(prev =>
                prev.map(msg => {
                    if (msg.id === messageId) {
                        return { ...msg, mediaUri: savedUri };
                    }
                    return msg;
                })
            );

            // Создаем временный файл для загрузки
            const tempUri = `${FileSystem.cacheDirectory}temp_${messageId}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;
            await FileSystem.writeAsStringAsync(tempUri, base64Data, {
                encoding: FileSystem.EncodingType.Base64
            });

            // Загружаем на сервер
            const fileName = `media_${messageId}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;
            const mimeType = mediaType === 'image' ? 'image/jpeg' : 'video/mp4';

            const fileUrl = await uploadFileGeneric(
                tempUri,
                fileName,
                mimeType,
                messageId,
                (progress) => {
                    setMessages(prev =>
                        prev.map(msg => {
                            if (msg.id === messageId) {
                                return {
                                    ...msg,
                                    uploadProgress: progress,
                                    message: `${mediaType === 'image' ? '📷' : '🎥'} Загрузка... ${progress}%`
                                };
                            }
                            return msg;
                        })
                    );
                }
            );

            // Удаляем временный файл
            await FileSystem.deleteAsync(tempUri, { idempotent: true });

            // Обновляем сообщение с URL сервера
            setMessages(prev =>
                prev.map(msg => {
                    if (msg.id === messageId) {
                        return {
                            ...msg,
                            isUploading: false,
                            uploadProgress: 100,
                            message: mediaType === 'image' ? '📷 Изображение' : '🎥 Видео',
                            serverFileUrl: fileUrl
                        };
                    }
                    return msg;
                })
            );

            // Отправляем уведомление через WebSocket
            const messageData = {
                type: 'media_message',
                message: mediaType === 'image' ? '📷 Изображение' : '🎥 Видео',
                mediaType: mediaType,
                mediaHash: mediaHash,
                fileUrl: fileUrl,
                timestamp: timestamp,
                user1: currentUserId,
                user2: recipient.id,
                id: messageId
            };

            sendMessage(messageData);

        } catch (error) {
            console.error('Ошибка отправки медиа:', error);

            setMessages(prev =>
                prev.map(msg => {
                    if (msg.id === messageId) {
                        return {
                            ...msg,
                            isUploading: false,
                            message: `❌ Ошибка загрузки ${mediaType === 'image' ? 'изображения' : 'видео'}`,
                            uploadProgress: 0
                        };
                    }
                    return msg;
                })
            );

            Alert.alert('Ошибка', 'Не удалось отправить медиафайл');
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

            console.log('📜 [HISTORY] Loading chat history...', { pageNum, limit, roomId });

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

            console.log('📜 [HISTORY] Server response:', {
                hasData: !!response.data,
                hasMessages: !!(response.data && response.data.messages),
                messagesCount: response.data?.messages?.length || 0
            });

            if (response.data?.messages?.length > 0) {
                console.log('📜 [HISTORY] Sample message from server:', response.data.messages[0]);

                // Проверяем медиа-сообщения
                const mediaMessages = response.data.messages.filter(msg =>
                    msg.mediaType || msg.media_type ||
                    msg.mediaHash || msg.media_hash
                );

                if (mediaMessages.length > 0) {
                    console.log('📜 [HISTORY] Media messages in history:', {
                        count: mediaMessages.length,
                        sample: mediaMessages[0]
                    });
                }
            }

            if (response.data && response.data.messages) {
                const processedMessages = await Promise.all(
                    response.data.messages.map(async (msg: any, index: number) => {
                        console.log(`📜 [HISTORY] Processing message ${index + 1}:`, {
                            id: msg.id,
                            sender: msg.sender__username,
                            hasMediaType: !!(msg.mediaType || msg.media_type),
                            hasMediaHash: !!(msg.mediaHash || msg.media_hash),
                            hasMediaBase64: !!(msg.mediaBase64 || msg.media_base64),
                            mediaSize: msg.mediaSize || msg.media_size,
                            message: msg.message?.substring(0, 50)
                        });

                        const processedMsg = {
                            ...msg,
                            timestamp: msg.timestamp,
                            // Правильный маппинг всех возможных полей с сервера
                            mediaType: msg.mediaType || msg.media_type || null,
                            mediaHash: msg.mediaHash || msg.media_hash || null,
                            mediaFileName: msg.mediaFileName || msg.media_filename || null,
                            mediaSize: msg.mediaSize || msg.media_size || null,
                            mediaBase64: null, // В истории base64 не передается
                            mediaUri: null // Будет установлен из кэша
                        };

                        // Если сообщение содержит медиа, пытаемся восстановить из кэша
                        if (processedMsg.mediaType && processedMsg.mediaHash) {
                            const fileSizeInMB = processedMsg.mediaSize ? processedMsg.mediaSize / (1024 * 1024) : 0;
                            const isLargeFile = fileSizeInMB > 15;

                            console.log('📷 [HISTORY] ==> RESTORING MEDIA FROM CACHE <==');
                            console.log('📷 [HISTORY] Media details:', {
                                hash: processedMsg.mediaHash.substring(0, 16) + '...',
                                type: processedMsg.mediaType,
                                messageId: processedMsg.id,
                                sizeMB: fileSizeInMB.toFixed(1),
                                isLargeFile: isLargeFile,
                                fileName: `${processedMsg.mediaHash}.${processedMsg.mediaType === 'image' ? 'jpg' : 'mp4'}`
                            });

                            try {
                                let cachedUri = await getMediaFromCache(processedMsg.mediaHash, processedMsg.mediaType);

                                // Если не найден в стандартном кэше, ищем через все возможные источники
                                if (!cachedUri) {
                                    console.log('📷 [HISTORY] Not found in standard cache, trying alternative methods...');

                                    // Метод 1: Поиск по backup записям (для всех файлов, не только больших)
                                    try {
                                        const backupKey = `large_media_${processedMsg.id}`;
                                        const backupData = await AsyncStorage.getItem(backupKey);

                                        if (backupData) {
                                            const backup = JSON.parse(backupData);
                                            console.log('📷 [HISTORY] Found backup record:', {
                                                messageId: processedMsg.id,
                                                backupUri: backup.mediaUri,
                                                backupHash: backup.mediaHash?.substring(0, 16) + '...'
                                            });

                                            if (backup.mediaUri && backup.mediaHash === processedMsg.mediaHash) {
                                                const backupFileInfo = await FileSystem.getInfoAsync(backup.mediaUri);
                                                if (backupFileInfo.exists && backupFileInfo.size > 0) {
                                                    cachedUri = backup.mediaUri;
                                                    console.log('📷 [HISTORY] ✅ Restored from backup record!');
                                                }
                                            }
                                        }
                                    } catch (backupError) {
                                        console.error('📷 [HISTORY] Backup search error:', backupError);
                                    }

                                    // Метод 2: Поиск в списке больших файлов (улучшенный)
                                    if (!cachedUri) {
                                        try {
                                            const largeFilesList = await AsyncStorage.getItem('large_files_list');
                                            if (largeFilesList) {
                                                const files = JSON.parse(largeFilesList);

                                                // Ищем по разным критериям
                                                let matchingFile = files.find(f => f.mediaHash === processedMsg.mediaHash);

                                                if (!matchingFile) {
                                                    matchingFile = files.find(f => f.messageId === processedMsg.id);
                                                }

                                                // Поиск по типу и размеру файла
                                                if (!matchingFile && processedMsg.mediaSize) {
                                                    const targetSizeMB = processedMsg.mediaSize / (1024 * 1024);
                                                    matchingFile = files.find(f =>
                                                        f.mediaType === processedMsg.mediaType &&
                                                        Math.abs(f.fileSizeMB - targetSizeMB) < 0.5 // Разница менее 0.5MB
                                                    );
                                                }

                                                // Поиск по частичному совпадению хэша
                                                if (!matchingFile && processedMsg.mediaHash) {
                                                    const hashPrefix = processedMsg.mediaHash.substring(0, 16);
                                                    matchingFile = files.find(f =>
                                                        f.mediaHash &&
                                                        f.mediaHash.startsWith(hashPrefix) &&
                                                        f.mediaType === processedMsg.mediaType
                                                    );
                                                }

                                                if (matchingFile && matchingFile.savedUri) {
                                                    const fileInfo = await FileSystem.getInfoAsync(matchingFile.savedUri);
                                                    if (fileInfo.exists && fileInfo.size > 0) {
                                                        cachedUri = matchingFile.savedUri;
                                                        console.log('📷 [HISTORY] ✅ Found in large files list:', {
                                                            method: matchingFile.mediaHash === processedMsg.mediaHash ? 'exact_hash' :
                                                                   matchingFile.messageId === processedMsg.id ? 'message_id' :
                                                                   'fuzzy_match',
                                                            file: matchingFile.fileName || 'unknown',
                                                            size: (fileInfo.size / (1024 * 1024)).toFixed(1) + 'MB'
                                                        });
                                                    }
                                                }
                                            }
                                        } catch (listError) {
                                            console.error('📷 [HISTORY] Large files list search error:', listError);
                                        }
                                    }

                                    // Метод 3: Умный поиск по директории (последний шанс)
                                    if (!cachedUri) {
                                        try {
                                            const documentsDir = FileSystem.documentDirectory;
                                            const mediaDir = `${documentsDir}chat_media/`;
                                            const dirInfo = await FileSystem.getInfoAsync(mediaDir);

                                            if (dirInfo.exists) {
                                                const files = await FileSystem.readDirectoryAsync(mediaDir);
                                                const extension = processedMsg.mediaType === 'image' ? '.jpg' : '.mp4';
                                                const relevantFiles = files.filter(fileName => fileName.endsWith(extension));

                                                console.log('📷 [HISTORY] Smart directory search:', {
                                                    totalFiles: files.length,
                                                    relevantFiles: relevantFiles.length,
                                                    targetType: processedMsg.mediaType,
                                                    targetSize: processedMsg.mediaSize,
                                                    searchHash: processedMsg.mediaHash?.substring(0, 16) + '...'
                                                });

                                                // Поиск по частичному хэшу (разные стратегии)
                                                if (processedMsg.mediaHash) {
                                                    const hashParts = [
                                                        processedMsg.mediaHash.substring(0, 16),
                                                        processedMsg.mediaHash.substring(8, 24),
                                                        processedMsg.mediaHash.substring(16, 32)
                                                    ];

                                                    for (const hashPart of hashParts) {
                                                        const matchingFiles = relevantFiles.filter(fileName =>
                                                            fileName.includes(hashPart)
                                                        );

                                                        for (const fileName of matchingFiles) {
                                                            const filePath = `${mediaDir}${fileName}`;
                                                            const fileInfo = await FileSystem.getInfoAsync(filePath);

                                                            if (fileInfo.exists && fileInfo.size > 0) {
                                                                // Дополнительная проверка размера
                                                                let sizeMatch = true;
                                                                if (processedMsg.mediaSize) {
                                                                    const sizeDiff = Math.abs(fileInfo.size - processedMsg.mediaSize);
                                                                    const sizeRatio = sizeDiff / processedMsg.mediaSize;
                                                                    sizeMatch = sizeRatio < 0.1; // Разница менее 10%
                                                                }

                                                                if (sizeMatch) {
                                                                    cachedUri = filePath;
                                                                    console.log('📷 [HISTORY] ✅ Found by smart search:', {
                                                                        fileName: fileName,
                                                                        matchedHashPart: hashPart,
                                                                        size: (fileInfo.size / (1024 * 1024)).toFixed(1) + 'MB',
                                                                        sizeMatch: sizeMatch
                                                                    });
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                        if (cachedUri) break;
                                                    }
                                                }

                                                // Последняя попытка: поиск по размеру и типу (для недавних файлов)
                                                if (!cachedUri && processedMsg.mediaSize) {
                                                    const now = Date.now();
                                                    const targetSize = processedMsg.mediaSize;

                                                    for (const fileName of relevantFiles) {
                                                        const filePath = `${mediaDir}${fileName}`;
                                                        const fileInfo = await FileSystem.getInfoAsync(filePath);

                                                        if (fileInfo.exists && fileInfo.size > 0) {
                                                            const sizeDiff = Math.abs(fileInfo.size - targetSize);
                                                            const sizeRatio = sizeDiff / targetSize;
                                                            const fileAge = now - fileInfo.modificationTime;
                                                            const isRecent = fileAge < 24 * 60 * 60 * 1000; // Менее 24 часов

                                                            if (sizeRatio < 0.05 && isRecent) { // Очень близкий размер и недавний
                                                                cachedUri = filePath;
                                                                console.log('📷 [HISTORY] ✅ Found by size+time heuristic:', {
                                                                    fileName: fileName,
                                                                    sizeMatch: (sizeRatio * 100).toFixed(1) + '%',
                                                                    ageHours: Math.round(fileAge / (1000 * 60 * 60))
                                                                });
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        } catch (dirError) {
                                            console.error('📷 [HISTORY] Smart directory search error:', dirError);
                                        }
                                    }
                                }

                                if (cachedUri) {
                                    // Дополнительная валидация найденного файла
                                    const fileInfo = await FileSystem.getInfoAsync(cachedUri);
                                    const isValidFile = fileInfo.exists && fileInfo.size > 0;

                                    // Для видео файлов проверяем минимальный размер
                                    const isValidVideo = processedMsg.mediaType !== 'video' || fileInfo.size > 1000;

                                    if (isValidFile && isValidVideo) {
                                        processedMsg.mediaUri = cachedUri;

                                        // Дополнительно сохраняем backup информации
                                        processedMsg._cacheRestored = true;
                                        processedMsg._cacheTimestamp = Date.now();

                                        console.log('📷 [HISTORY] ✅ Successfully restored media from cache:', {
                                            type: processedMsg.mediaType,
                                            fileName: cachedUri.substring(cachedUri.lastIndexOf('/') + 1),
                                            messageId: processedMsg.id,
                                            fileSize: (fileInfo.size / (1024 * 1024)).toFixed(1) + 'MB',
                                            method: 'comprehensive_search'
                                        });

                                        // Создаем дополнительную backup запись для надежности
                                        try {
                                            const backupKey = `history_media_${processedMsg.id}`;
                                            const backupData = {
                                                messageId: processedMsg.id,
                                                mediaType: processedMsg.mediaType,
                                                mediaHash: processedMsg.mediaHash,
                                                mediaUri: cachedUri,
                                                restoredAt: Date.now(),
                                                fileSize: fileInfo.size,
                                                isHistory: true
                                            };
                                            await AsyncStorage.setItem(backupKey, JSON.stringify(backupData));
                                            console.log('📷 [HISTORY] Created history backup record');
                                        } catch (backupError) {
                                            console.error('📷 [HISTORY] Failed to create backup record:', backupError);
                                        }
                                    } else {
                                        console.log('📷 [HISTORY] ❌ Found file is invalid:', {
                                            exists: fileInfo.exists,
                                            size: fileInfo.size,
                                            isVideo: processedMsg.mediaType === 'video',
                                            minSizeOk: isValidVideo
                                        });
                                        cachedUri = null;
                                    }
                                }

                                // Если файл все еще не найден
                                if (!cachedUri) {
                                    console.log('📷 [HISTORY] ❌ Media NOT found in any cache location:', {
                                        hash: processedMsg.mediaHash.substring(0, 16) + '...',
                                        type: processedMsg.mediaType,
                                        sizeMB: fileSizeInMB.toFixed(1),
                                        messageId: processedMsg.id
                                    });

                                    // Только для больших файлов (>15MB) показываем опцию перезагрузки
                                    if (fileSizeInMB > 15) {
                                        processedMsg.needsReload = true;
                                        processedMsg.message = processedMsg.mediaType === 'image'
                                            ? `📷 Изображение ${fileSizeInMB.toFixed(1)}MB (не найдено в кэше)`
                                            : `🎥 Видео ${fileSizeInMB.toFixed(1)}MB (не найдено в кэше)`;
                                        console.log('📷 [HISTORY] ❌ Large file marked for reload:', {
                                            size: fileSizeInMB.toFixed(1) + 'MB',
                                            type: processedMsg.mediaType,
                                            messageId: processedMsg.id
                                        });
                                    } else {
                                        // Для файлов меньше 15MB просто показываем как обычное сообщение без медиа
                                        processedMsg.message = processedMsg.mediaType === 'image'
                                            ? `📷 Изображение ${fileSizeInMB.toFixed(1)}MB`
                                            : `🎥 Видео ${fileSizeInMB.toFixed(1)}MB`;
                                        console.log('📷 [HISTORY] Small file will show as text message:', {
                                            size: fileSizeInMB.toFixed(1) + 'MB',
                                            type: processedMsg.mediaType,
                                            messageId: processedMsg.id
                                        });
                                    }
                                }
                            } catch (error) {
                                console.error('📷 [HISTORY] ❌ Error restoring media:', error);
                                // В случае ошибки показываем сообщение без медиа
                                processedMsg.message = processedMsg.mediaType === 'image'
                                    ? `📷 Изображение (ошибка загрузки)`
                                    : `🎥 Видео (ошибка загрузки)`;
                            }
                        } else {
                            console.log('📜 [HISTORY] Text message (no media):', processedMsg.id);
                        }

                        console.log('📜 [HISTORY] Final processed message:', {
                            id: processedMsg.id,
                            mediaType: processedMsg.mediaType,
                            mediaHash: processedMsg.mediaHash,
                            hasMediaUri: !!processedMsg.mediaUri,
                            hasMediaBase64: !!processedMsg.mediaBase64,
                            mediaSize: processedMsg.mediaSize,
                            needsReload: processedMsg.needsReload,
                            mediaUri: processedMsg.mediaUri ? processedMsg.mediaUri.substring(processedMsg.mediaUri.lastIndexOf('/') + 1) : 'none'
                        });

                        return processedMsg;
                    })
                );

                if (pageNum === 1) {
                    // Первая загрузка - НЕ заменяем все сообщения, а мержим с существующими
                    setMessages(prev => {
                        // Не реверсируем - сообщения уже отсортированы от новых к старым
                        const historyMessages = processedMessages;

                        // Сохраняем существующие сообщения, которых нет в истории
                        const existingNewMessages = prev.filter(existingMsg => {
                            return !historyMessages.some(historyMsg => historyMsg.id === existingMsg.id);
                        });

                        console.log('📜 [HISTORY] Merging messages:', {
                            historyCount: historyMessages.length,
                            existingNewCount: existingNewMessages.length,
                            historyMediaCount: historyMessages.filter(msg => msg.mediaType).length,
                            existingMediaCount: existingNewMessages.filter(msg => msg.mediaType).length
                        });

                        // Объединяем новые сообщения с историей - новые сначала
                        const mergedMessages = [...existingNewMessages, ...historyMessages];

                        console.log('📜 [HISTORY] Final merged messages media count:',
                            mergedMessages.filter(msg => msg.mediaType).length
                        );

                        return mergedMessages;
                    });
                    setPage(1);

                    // После установки состояния пытаемся обновить медиа для сообщений без URI
                    setTimeout(async () => {
                        console.log('📜 [HISTORY] Post-load media recovery started');

                        // Логируем текущее состояние сообщений перед восстановлением
                        setTimeout(() => {
                            console.log('📜 [HISTORY] Current messages state before recovery:');
                            const currentMessages = messages;
                            const mediaMessages = currentMessages.filter(msg => msg.mediaType);
                            console.log('📜 [HISTORY] Total media messages:', mediaMessages.length);

                            mediaMessages.forEach((msg, idx) => {
                                const sizeMB = msg.mediaSize ? (msg.mediaSize / (1024 * 1024)).toFixed(1) : '?';
                                console.log(`📜 [HISTORY] Media msg ${idx + 1}:`, {
                                    id: msg.id,
                                    type: msg.mediaType,
                                    sizeMB: sizeMB + 'MB',
                                    hasUri: !!msg.mediaUri,
                                    hasBase64: !!msg.mediaBase64,
                                    hasHash: !!msg.mediaHash,
                                    hash: msg.mediaHash?.substring(0, 16) + '...',
                                    needsReload: msg.needsReload
                                });
                            });
                        }, 100);

                        await retryMediaRecovery();
                    }, 500);
                } else {
                    // Загрузка дополнительных сообщений - добавляем в конец (старые сообщения)
                    setMessages(prev => [...prev, ...processedMessages]);
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

    // Настройка аудио сессии при загрузке компонента
    useEffect(() => {
        const setupAudioSession = async () => {
            try {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    staysActiveInBackground: true, // Изменено: позволяем работать в фоне
                    interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
                    playsInSilentModeIOS: true,
                    shouldDuckAndroid: true,
                    interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
                    playThroughEarpieceAndroid: false
                });
                setAudioSessionReady(true);
                console.log('🎥 [AUDIO] Audio session configured successfully on component mount');
            } catch (audioError) {
                console.warn('🎥 [AUDIO] Failed to configure audio session:', audioError);
                setAudioSessionReady(false);
            }
        };

        setupAudioSession();
    }, []);

    // Инициализация чата
    // Отслеживание состояния приложения
    useEffect(() => {
        const subscription = AppState.addEventListener('change', nextAppState => {
            console.log('🎥 [APP-STATE] App state changed:', appState, '->', nextAppState);
            setAppState(nextAppState);
        });

        return () => {
            subscription?.remove();
        };
    }, [appState]);

    // Автозапуск видео после открытия модального окна
    useEffect(() => {
        if (isVideoViewerVisible && selectedVideo && !isVideoPlaying && appState === 'active') {
            const timer = setTimeout(() => {
                forcePlayVideo();
            }, 1000); // Задержка в 1 секунду для стабилизации модального окна

            return () => clearTimeout(timer);
        }
    }, [isVideoViewerVisible, selectedVideo, appState]);

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

                    // Запускаем диагностику кэша больших файлов
                    diagnoseLargeFilesCache().catch(error => {
                        console.error('🔍 [DIAGNOSIS] Background diagnosis failed:', error);
                    });

                    // Запускаем очистку старых медиафайлов в фоне
                    cleanupOldMediaFiles().catch(error => {
                        console.error('🧹 [CLEANUP] Background cleanup failed:', error);
                    });

                    // Подключаемся к WebSocket
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

    // Функция для повторного восстановления медиафайлов из кэша с проверкой backup записей
    const retryMediaRecovery = async () => {
        console.log('🔄 [RECOVERY] Starting enhanced media recovery for history messages');

        const messagesToUpdate: {id: any, mediaUri: string}[] = [];

        // Получаем актуальное состояние сообщений
        setMessages(currentMessages => {
            console.log('🔄 [RECOVERY] Current messages count:', currentMessages.length);

            // Находим сообщения с медиа, но без URI
            const mediaMessagesWithoutUri = currentMessages.filter(msg =>
                msg.mediaType &&
                msg.mediaHash &&
                !msg.mediaUri
            );

            console.log('🔄 [RECOVERY] Messages needing recovery:', {
                total: mediaMessagesWithoutUri.length,
                details: mediaMessagesWithoutUri.map(msg => ({
                    id: msg.id,
                    type: msg.mediaType,
                    sizeMB: msg.mediaSize ? (msg.mediaSize / (1024 * 1024)).toFixed(1) : '?',
                    hash: msg.mediaHash?.substring(0, 16) + '...',
                    hasUri: !!msg.mediaUri,
                    hasBase64: !!msg.mediaBase64
                }))
            });

            // Выполняем восстановление асинхронно
            (async () => {
                for (const msg of mediaMessagesWithoutUri) {
                    let cachedUri: string | null = null;

                    try {
                        // Сначала пытаемся стандартный способ восстановления
                        cachedUri = await getMediaFromCache(msg.mediaHash!, msg.mediaType!);

                        // Если не нашли, проверяем backup записи для больших файлов
                        if (!cachedUri) {
                            try {
                                const backupKey = `large_media_${msg.id}`;
                                const backupData = await AsyncStorage.getItem(backupKey);
                                if (backupData) {
                                    const backup = JSON.parse(backupData);
                                    console.log('🔄 [RECOVERY] Found backup data for message:', {
                                        messageId: msg.id,
                                        hash: backup.mediaHash?.substring(0, 16) + '...',
                                        savedUri: backup.mediaUri
                                    });

                                    // Проверяем, существует ли файл по backup URI
                                    if (backup.mediaUri) {
                                        const fileInfo = await FileSystem.getInfoAsync(backup.mediaUri);
                                        if (fileInfo.exists && fileInfo.size > 0) {
                                            cachedUri = backup.mediaUri;
                                            console.log('🔄 [RECOVERY] ✅ Restored from backup:', backup.mediaUri);
                                        } else {
                                            console.log('🔄 [RECOVERY] ❌ Backup file missing or corrupted');
                                        }
                                    }
                                }
                            } catch (backupError) {
                                console.error('🔄 [RECOVERY] Error checking backup:', backupError);
                            }
                        }

                        if (cachedUri) {
                            // Для видео дополнительно проверяем целостность
                            if (msg.mediaType === 'video') {
                                try {
                                    const fileInfo = await FileSystem.getInfoAsync(cachedUri);
                                    if (fileInfo.exists && fileInfo.size > 1000) { // Минимум 1KB для видео
                                        messagesToUpdate.push({ id: msg.id, mediaUri: cachedUri });
                                        console.log('🔄 [RECOVERY] ✅ Found and verified cached video:', {
                                            messageId: msg.id,
                                            hash: msg.mediaHash?.substring(0, 16) + '...',
                                            uri: cachedUri.substring(cachedUri.lastIndexOf('/') + 1),
                                            size: fileInfo.size
                                        });
                                    } else {
                                        console.log('🔄 [RECOVERY] ❌ Video file corrupted or too small:', {
                                            messageId: msg.id,
                                            size: fileInfo.size,
                                            exists: fileInfo.exists
                                        });
                                    }
                                } catch (fileCheckError) {
                                    console.error('🔄 [RECOVERY] Error checking video file:', fileCheckError);
                                }
                            } else {
                                // Для изображений просто добавляем
                                messagesToUpdate.push({ id: msg.id, mediaUri: cachedUri });
                                console.log('🔄 [RECOVERY] ✅ Found cached image:', {
                                    messageId: msg.id,
                                    hash: msg.mediaHash?.substring(0, 16) + '...',
                                    uri: cachedUri.substring(cachedUri.lastIndexOf('/') + 1)
                                });
                            }
                        } else {
                            console.log('🔄 [RECOVERY] ❌ No cached media found (tried both cache and backup):', {
                                messageId: msg.id,
                                hash: msg.mediaHash?.substring(0, 16) + '...',
                                type: msg.mediaType
                            });
                        }
                    } catch (error) {
                        console.error('🔄 [RECOVERY] Error recovering media for message:', {
                            messageId: msg.id,
                            error: error
                        });
                    }
                }

                // Обновляем все найденные сообщения одним batch-ом
                if (messagesToUpdate.length > 0) {
                    console.log('🔄 [RECOVERY] Updating messages with recovered media:', {
                        count: messagesToUpdate.length,
                        updates: messagesToUpdate.map(u => ({
                            id: u.id,
                            fileName: u.mediaUri.substring(u.mediaUri.lastIndexOf('/') + 1)
                        }))
                    });

                    setMessages(prevMessages =>
                        prevMessages.map(msg => {
                            const update = messagesToUpdate.find(u => u.id === msg.id);
                            if (update) {
                                return { ...msg, mediaUri: update.mediaUri };
                            }
                            return msg;
                        })
                    );
                } else {
                    console.log('🔄 [RECOVERY] No media files were recovered from cache or backup');
                }
            })();

            return currentMessages; // Возвращаем текущее состояние без изменений
        });

        console.log('🔄 [RECOVERY] Found messages needing recovery:', {
            total: mediaMessagesWithoutUri.length,
            hashes: mediaMessagesWithoutUri.map(msg => ({
                id: msg.id,
                hash: msg.mediaHash?.substring(0, 16) + '...'
            }))
        });

        for (const msg of mediaMessagesWithoutUri) {
            let cachedUri: string | null = null;

            try {
                // Сначала пытаемся стандартный способ восстановления
                cachedUri = await getMediaFromCache(msg.mediaHash!, msg.mediaType!);

                // Если не нашли, проверяем backup записи для больших файлов
                if (!cachedUri) {
                    try {
                        const backupKey = `large_media_${msg.id}`;
                        const backupData = await AsyncStorage.getItem(backupKey);
                        if (backupData) {
                            const backup = JSON.parse(backupData);
                            console.log('🔄 [RECOVERY] Found backup data for message:', {
                                messageId: msg.id,
                                hash: backup.mediaHash?.substring(0, 16) + '...',
                                savedUri: backup.mediaUri
                            });

                            // Проверяем, существует ли файл по backup URI
                            if (backup.mediaUri) {
                                const fileInfo = await FileSystem.getInfoAsync(backup.mediaUri);
                                if (fileInfo.exists && fileInfo.size > 0) {
                                    cachedUri = backup.mediaUri;
                                    console.log('🔄 [RECOVERY] ✅ Restored from backup:', backup.mediaUri);
                                } else {
                                    console.log('🔄 [RECOVERY] ❌ Backup file missing or corrupted');
                                }
                            }
                        }
                    } catch (backupError) {
                        console.error('🔄 [RECOVERY] Error checking backup:', backupError);
                    }
                }

                if (cachedUri) {
                    // Для видео дополнительно проверяем целостность
                    if (msg.mediaType === 'video') {
                        try {
                            const fileInfo = await FileSystem.getInfoAsync(cachedUri);
                            if (fileInfo.exists && fileInfo.size > 1000) { // Минимум 1KB для видео
                                messagesToUpdate.push({ id: msg.id, mediaUri: cachedUri });
                                console.log('🔄 [RECOVERY] ✅ Found and verified cached video:', {
                                    messageId: msg.id,
                                    hash: msg.mediaHash?.substring(0, 16) + '...',
                                    uri: cachedUri.substring(cachedUri.lastIndexOf('/') + 1),
                                    size: fileInfo.size
                                });
                            } else {
                                console.log('🔄 [RECOVERY] ❌ Video file corrupted or too small:', {
                                    messageId: msg.id,
                                    size: fileInfo.size,
                                    exists: fileInfo.exists
                                });
                            }
                        } catch (fileCheckError) {
                            console.error('🔄 [RECOVERY] Error checking video file:', fileCheckError);
                        }
                    } else {
                        // Для изображений просто добавляем
                        messagesToUpdate.push({ id: msg.id, mediaUri: cachedUri });
                        console.log('🔄 [RECOVERY] ✅ Found cached image:', {
                            messageId: msg.id,
                            hash: msg.mediaHash?.substring(0, 16) + '...',
                            uri: cachedUri.substring(cachedUri.lastIndexOf('/') + 1)
                        });
                    }
                } else {
                    console.log('🔄 [RECOVERY] ❌ No cached media found (tried both cache and backup):', {
                        messageId: msg.id,
                        hash: msg.mediaHash?.substring(0, 16) + '...',
                        type: msg.mediaType
                    });
                }
            } catch (error) {
                console.error('🔄 [RECOVERY] Error recovering media for message:', {
                    messageId: msg.id,
                    error: error
                });
            }
        }

        // Обновляем все найденные сообщения одним batch-ом
        if (messagesToUpdate.length > 0) {
            console.log('🔄 [RECOVERY] Updating messages with recovered media:', {
                count: messagesToUpdate.length,
                updates: messagesToUpdate.map(u => ({
                    id: u.id,
                    fileName: u.mediaUri.substring(u.mediaUri.lastIndexOf('/') + 1)
                }))
            });

            setMessages(prev =>
                prev.map(msg => {
                    const update = messagesToUpdate.find(u => u.id === msg.id);
                    if (update) {
                        return { ...msg, mediaUri: update.mediaUri };
                    }
                    return msg;
                })
            );
        } else {
            console.log('🔄 [RECOVERY] No media files were recovered from cache or backup');
        }
    };

    // Открытие просмотрщика изображений
    const openImageViewer = (imageUri: string) => {
        setSelectedImage(imageUri);
        setIsImageViewerVisible(true);
    };

    // Функция для открытия в системном плеере
    const openInSystemPlayer = async (videoUri: string) => {
        try {
            if (videoUri.startsWith('http')) {
                await Linking.openURL(videoUri);
            } else {
                Alert.alert('Ошибка', 'Системный плеер поддерживает только URL-адреса');
            }
        } catch (error) {
            console.error('🎥 [SYSTEM] Failed to open in system player:', error);
            Alert.alert('Ошибка', 'Не удалось открыть в системном плеере');
        }
    };

    // Открытие полноэкранного видеоплеера
    const openVideoViewer = async (videoUri: string) => {
        // Очищаем предыдущее состояние
        setVideoError(null);
        setIsVideoPlaying(false);
        setAudioSessionReady(false);

        console.log('🎥 [VIEWER] Opening video viewer');

        setSelectedVideo(videoUri);
        setIsVideoViewerVisible(true);

        // Настраиваем аудио сессию после отображения модального окна
        setTimeout(async () => {
            try {
                if (appState === 'active') {
                    await Audio.setAudioModeAsync({
                        allowsRecordingIOS: false,
                        staysActiveInBackground: true,
                        interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
                        playsInSilentModeIOS: true,
                        shouldDuckAndroid: true,
                        interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
                        playThroughEarpieceAndroid: false
                    });
                    setAudioSessionReady(true);
                    console.log('🎥 [AUDIO] Audio session configured successfully');
                }
            } catch (audioError) {
                console.warn('🎥 [AUDIO] Failed to configure audio session:', audioError);
                setAudioSessionReady(false);
            }
        }, 1500); // Даем время модальному окну полностью отобразиться
    };

    // Функция принудительного воспроизведения с беззвучным режимом
    const forcePlayVideo = async () => {
        try {
            if (videoRef.current) {
                console.log('🎥 [FORCE-PLAY] Attempting to play muted video...');

                // Сначала убеждаемся что видео отключено
                await videoRef.current.setIsMutedAsync(true);

                // Затем запускаем воспроизведение
                await videoRef.current.playAsync();
                setIsVideoPlaying(true);
                setVideoError(null);

                console.log('🎥 [FORCE-PLAY] ✅ Muted video started successfully');
            }
        } catch (playError: any) {
            console.error('🎥 [FORCE-PLAY] ❌ Failed to play muted video:', playError);
            setVideoError(playError.message || 'Не удалось воспроизвести видео');
        }
    };

    // Функции управления встроенным видео
    const toggleInlineVideo = async (messageId: string | number, videoUri: string) => {
        const currentState = inlineVideoStates[messageId] || {
            isPlaying: false, isMuted: false, isExpanded: false, duration: 0, position: 0, isLoaded: false
        };
        const newPlayingState = !currentState.isPlaying;

        try {
            const videoRef = inlineVideoRefs.current[messageId];
            if (videoRef) {
                if (newPlayingState) {
                    await videoRef.playAsync();
                } else {
                    await videoRef.pauseAsync();
                }

                setInlineVideoStates(prev => ({
                    ...prev,
                    [messageId]: { ...currentState, isPlaying: newPlayingState }
                }));
            }
        } catch (error) {
            console.error('🎥 [INLINE] Error toggling video:', error);
        }
    };

    const toggleInlineVideoSound = async (messageId: string | number) => {
        const currentState = inlineVideoStates[messageId] || {
            isPlaying: false, isMuted: false, isExpanded: false, duration: 0, position: 0, isLoaded: false
        };
        const newMutedState = !currentState.isMuted;

        try {
            const videoRef = inlineVideoRefs.current[messageId];
            if (videoRef) {
                await videoRef.setIsMutedAsync(newMutedState);
                setInlineVideoStates(prev => ({
                    ...prev,
                    [messageId]: { ...currentState, isMuted: newMutedState }
                }));
            }
        } catch (error) {
            console.error('🎥 [INLINE] Error toggling sound:', error);
        }
    };

    const expandInlineVideo = (messageId: string | number, videoUri: string) => {
        const currentState = inlineVideoStates[messageId] || {
            isPlaying: false, isMuted: false, isExpanded: false, duration: 0, position: 0, isLoaded: false
        };

        // Переключаем полноэкранный режим
        const newExpandedState = !currentState.isExpanded;

        setInlineVideoStates(prev => ({
            ...prev,
            [messageId]: { ...currentState, isExpanded: newExpandedState }
        }));

        if (newExpandedState) {
            setFullscreenVideoId(String(messageId));
        } else {
            setFullscreenVideoId(null);
        }
    };

    const seekInlineVideo = async (messageId: string | number, position: number) => {
        try {
            const videoRef = inlineVideoRefs.current[messageId];
            if (videoRef) {
                await videoRef.setPositionAsync(position);
            }
        } catch (error) {
            console.error('🎥 [INLINE] Error seeking video:', error);
        }
    };

    const resetVideoToBeginning = async (messageId: string | number) => {
        try {
            const videoRef = inlineVideoRefs.current[messageId];
            if (videoRef) {
                await videoRef.setPositionAsync(0);
                const currentState = inlineVideoStates[messageId];
                if (currentState) {
                    setInlineVideoStates(prev => ({
                        ...prev,
                        [messageId]: { ...currentState, position: 0, isPlaying: false }
                    }));
                }
            }
        } catch (error) {
            console.error('🎥 [INLINE] Error resetting video:', error);
        }
    };

    // Функция переключения звука
    const toggleVideoSound = async () => {
        try {
            if (videoRef.current && appState === 'active') {
                const newMutedState = !isVideoMuted;

                if (!newMutedState && !audioSessionReady) {
                    // Если пытаемся включить звук, но аудио сессия не готова
                    Alert.alert(
                        'Проблема со звуком',
                        'Не удается получить доступ к аудио. Открыть видео в системном плеере?',
                        [
                            { text: 'Отмена', style: 'cancel' },
                            {
                                text: 'Системный плеер',
                                onPress: () => {
                                    if (selectedVideo) {
                                        openInSystemPlayer(selectedVideo);
                                    }
                                }
                            }
                        ]
                    );
                    return;
                }

                await videoRef.current.setIsMutedAsync(newMutedState);
                setIsVideoMuted(newMutedState);
                console.log('🎥 [SOUND] Video sound toggled:', newMutedState ? 'muted' : 'unmuted');
            }
        } catch (soundError: any) {
            console.error('🎥 [SOUND] Failed to toggle sound:', soundError);

            // Предлагаем альтернативу
            Alert.alert(
                'Ошибка звука',
                'Не удается управлять звуком видео. Открыть в системном плеере?',
                [
                    { text: 'Отмена', style: 'cancel' },
                    {
                        text: 'Системный плеер',
                        onPress: () => {
                            if (selectedVideo) {
                                openInSystemPlayer(selectedVideo);
                            }
                        }
                    }
                ]
            );
        }
    };

    // Рендер сообщения
    const renderMessage = ({item}: { item: Message }) => {
        let isMyMessage = false;

        if (item.sender_id !== undefined && currentUserId !== null) {
            isMyMessage = item.sender_id === currentUserId;
        } else if (item.sender__username && currentUsername) {
            isMyMessage = item.sender__username === currentUsername;
        }

        const renderMediaContent = () => {
            // Показываем индикатор загрузки если файл загружается
            if (item.isUploading) {
                return (
                    <View style={styles.uploadingContainer}>
                        <View style={styles.uploadingContent}>
                            <ActivityIndicator size="small" color={theme.primary} />
                            <Text style={[styles.uploadingText, { color: theme.textSecondary }]}>
                                {item.mediaType === 'image' ? 'Загрузка изображения...' : 'Загрузка видео...'}
                            </Text>
                            {item.uploadProgress !== undefined && item.uploadProgress > 0 && (
                                <View style={styles.progressContainer}>
                                    <View style={[styles.progressBar, { backgroundColor: theme.border }]}>
                                        <View
                                            style={[
                                                styles.progressFill,
                                                {
                                                    backgroundColor: theme.primary,
                                                    width: `${item.uploadProgress}%`
                                                }
                                            ]}
                                        />
                                    </View>
                                    <Text style={[styles.progressText, { color: theme.textSecondary }]}>
                                        {item.uploadProgress}%
                                    </Text>
                                </View>
                            )}
                        </View>
                    </View>
                );
            }

            // Показываем индикатор необходимости перезагрузки для больших файлов
            if (item.needsReload) {
                const fileSizeMB = item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) : 0;

                return (
                    <TouchableOpacity
                        style={styles.reloadContainer}
                        onPress={() => {
                            Alert.alert(
                                'Большой файл не найден в кэше',
                                `Файл размером ${fileSizeMB}MB был удален из кэша для экономии места. Файлы больше 15MB не сохраняются в истории чата постоянно.\n\nВы можете:\n• Попросить отправителя переслать файл\n• Сохранять важные файлы в галерею сразу после получения`,
                                [
                                    { text: 'Понятно', style: 'default' },
                                    {
                                        text: 'Попросить переслать',
                                        style: 'default',
                                        onPress: () => {
                                            // Можно добавить функцию для автоматической отправки запроса
                                            console.log('User wants to request file resend');
                                        }
                                    }
                                ]
                            );
                        }}
                    >
                        <View style={styles.reloadContent}>
                            <MaterialIcons
                                name="cloud-off"
                                size={24}
                                color={theme.textSecondary}
                            />
                            <Text style={[styles.reloadText, { color: theme.textSecondary }]}>
                                {item.mediaType === 'image'
                                    ? `📷 Изображение ${fileSizeMB}MB`
                                    : `🎥 Видео ${fileSizeMB}MB`
                                }
                            </Text>
                            <Text style={[styles.reloadSubtext, { color: theme.placeholder }]}>
                                Большой файл удален из кэша
                            </Text>
                            <Text style={[styles.reloadHint, { color: theme.primary }]}>
                                Нажмите для подробностей
                            </Text>
                        </View>
                    </TouchableOpacity>
                );
            }

            if (item.mediaType === 'image') {
                // Проверяем, есть ли данные для отображения
                const hasImageData = item.mediaUri || item.mediaBase64;

                if (!hasImageData && !item.serverFileUrl) {
                    return (
                        <View style={styles.missingMediaContainer}>
                            <MaterialIcons name="image" size={48} color={theme.textSecondary} />
                            <Text style={[styles.missingMediaText, { color: theme.textSecondary }]}>
                                Изображение {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + 'MB' : ''}
                            </Text>
                            <Text style={[styles.missingMediaSubtext, { color: theme.placeholder }]}>
                                Слишком большой файл
                            </Text>
                        </View>
                    );
                }

                const imageUri = item.serverFileUrl || item.mediaUri || `data:image/jpeg;base64,${item.mediaBase64}`;
                return (
                    <TouchableOpacity
                        onPress={() => openImageViewer(imageUri)}
                        style={styles.mediaContainer}
                    >
                        <Image
                            source={{ uri: imageUri }}
                            style={styles.messageImage}
                            resizeMode="cover"
                            onError={(error) => {
                                console.error('❌ Image load error:', error);
                            }}
                        />
                    </TouchableOpacity>
                );
            } else if (item.mediaType === 'video') {
                // Проверяем, есть ли данные для отображения
                const hasVideoData = item.mediaUri || item.mediaBase64;

                if (!hasVideoData && !item.serverFileUrl) {
                    return (
                        <View style={styles.missingMediaContainer}>
                            <MaterialIcons name="videocam" size={48} color={theme.textSecondary} />
                            <Text style={[styles.missingMediaText, { color: theme.textSecondary }]}>
                                Видео {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + 'MB' : ''}
                            </Text>
                            <Text style={[styles.missingMediaSubtext, { color: theme.placeholder }]}>
                                Слишком большой файл
                            </Text>
                        </View>
                    );
                }

                const videoUri = item.serverFileUrl || item.mediaUri || `data:video/mp4;base64,${item.mediaBase64}`;
                const messageId = String(item.id);
                const videoState = inlineVideoStates[messageId] || {
                    isPlaying: false, isMuted: false, isExpanded: false, duration: 0, position: 0, isLoaded: false
                };

                console.log('🎥 [VIDEO-RENDER] Video details:', {
                    messageId: item.id,
                    hasServerUrl: !!item.serverFileUrl,
                    hasMediaUri: !!item.mediaUri,
                    hasBase64: !!item.mediaBase64,
                    videoUri: videoUri?.substring(0, 100) + '...',
                    mediaSize: item.mediaSize,
                    fileName: item.mediaFileName
                });

                // Определяем стиль контейнера в зависимости от полноэкранного режима
                const containerStyle = videoState.isExpanded
                    ? styles.fullscreenVideoContainer
                    : styles.inlineVideoContainer;
                const videoStyle = videoState.isExpanded
                    ? styles.fullscreenVideo
                    : styles.inlineVideo;

                return (
                    <View style={containerStyle}>
                        <Video
                            ref={(ref) => {
                                if (ref) {
                                    inlineVideoRefs.current[messageId] = ref;
                                }
                            }}
                            source={{ uri: videoUri }}
                            style={videoStyle}
                            resizeMode={videoState.isExpanded ? ResizeMode.CONTAIN : ResizeMode.COVER}
                            useNativeControls={false}
                            shouldPlay={videoState.isPlaying}
                            isMuted={videoState.isMuted}
                            isLooping={false}
                            onLoad={(data) => {
                                console.log('🎥 [INLINE-VIDEO] Video loaded successfully:', {
                                    messageId: item.id,
                                    duration: data.durationMillis,
                                    naturalSize: data.naturalSize,
                                    uri: videoUri?.substring(videoUri.lastIndexOf('/') + 1)
                                });

                                // Обновляем состояние с длительностью видео
                                setInlineVideoStates(prev => ({
                                    ...prev,
                                    [messageId]: {
                                        ...videoState,
                                        duration: data.durationMillis || 0,
                                        isLoaded: true
                                    }
                                }));
                            }}
                            onError={(error) => {
                                console.error('🎥 [INLINE-VIDEO] ❌ Video load error:', {
                                    messageId: item.id,
                                    error: error,
                                    uri: videoUri?.substring(videoUri.lastIndexOf('/') + 1),
                                    uriType: videoUri?.startsWith('data:') ? 'base64' :
                                             videoUri?.startsWith('http') ? 'url' : 'file'
                                });
                            }}
                            onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                                if ('error' in status) {
                                    console.error('🎥 [INLINE-VIDEO] Playback error:', status.error);
                                } else if ('durationMillis' in status && status.isLoaded) {
                                    const currentState = inlineVideoStates[messageId] || {
                                        isPlaying: false, isMuted: false, isExpanded: false, duration: 0, position: 0, isLoaded: false
                                    };

                                    // Проверяем, закончилось ли видео
                                    const isFinished = status.positionMillis >= status.durationMillis - 100; // 100ms погрешность

                                    if (isFinished && currentState.isPlaying) {
                                        // Перематываем в начало и останавливаем
                                        resetVideoToBeginning(messageId);
                                        return;
                                    }

                                    // Обновляем состояние воспроизведения
                                    const needsUpdate =
                                        status.isPlaying !== currentState.isPlaying ||
                                        Math.abs(status.positionMillis - currentState.position) > 1000 || // обновляем каждую секунду
                                        status.durationMillis !== currentState.duration;

                                    if (needsUpdate) {
                                        setInlineVideoStates(prev => ({
                                            ...prev,
                                            [messageId]: {
                                                ...currentState,
                                                isPlaying: status.isPlaying,
                                                position: status.positionMillis,
                                                duration: status.durationMillis,
                                                isLoaded: true
                                            }
                                        }));
                                    }
                                }
                            }}
                        />

                        {/* Прогресс-бар */}
                        {videoState.isLoaded && videoState.duration > 0 && (
                            <View style={styles.videoProgressContainer}>
                                <View style={styles.videoProgressBar}>
                                    <View
                                        style={[
                                            styles.videoProgressFill,
                                            { width: `${(videoState.position / videoState.duration) * 100}%` }
                                        ]}
                                    />
                                </View>
                                <TouchableOpacity
                                    style={styles.videoProgressTouch}
                                    onPress={(event) => {
                                        if (videoState.duration > 0) {
                                            const { locationX } = event.nativeEvent;
                                            const progressWidth = 180; // ширина прогресс-бара
                                            const percentage = Math.min(Math.max(locationX / progressWidth, 0), 1);
                                            const newPosition = percentage * videoState.duration;
                                            seekInlineVideo(messageId, newPosition);
                                        }
                                    }}
                                />
                            </View>
                        )}

                        {/* Время воспроизведения */}
                        {videoState.isLoaded && videoState.duration > 0 && (
                            <View style={styles.videoTimeContainer}>
                                <Text style={styles.videoTimeText}>
                                    {Math.floor(videoState.position / 1000)}s / {Math.floor(videoState.duration / 1000)}s
                                </Text>
                            </View>
                        )}

                        {/* Контролы видео */}
                        <View style={videoState.isExpanded ? styles.fullscreenVideoControls : styles.inlineVideoControls}>
                            {/* Кнопка воспроизведения/паузы */}
                            <TouchableOpacity
                                style={styles.inlineVideoButton}
                                onPress={() => toggleInlineVideo(messageId, videoUri)}
                            >
                                <MaterialIcons
                                    name={videoState.isPlaying ? "pause" : "play-arrow"}
                                    size={videoState.isExpanded ? 32 : 24}
                                    color="white"
                                />
                            </TouchableOpacity>

                            {/* Кнопка звука */}
                            <TouchableOpacity
                                style={styles.inlineVideoButton}
                                onPress={() => toggleInlineVideoSound(messageId)}
                            >
                                <MaterialIcons
                                    name={videoState.isMuted ? "volume-off" : "volume-up"}
                                    size={videoState.isExpanded ? 28 : 20}
                                    color={audioSessionReady ? "white" : "rgba(255, 255, 255, 0.5)"}
                                />
                            </TouchableOpacity>

                            {/* Кнопка расширения/сжатия */}

                        </View>

                        {/* Показываем overlay только если видео не играет */}
                        {!videoState.isPlaying && !videoState.isExpanded && (
                            <TouchableOpacity
                                style={styles.videoPlayOverlay}
                                onPress={() => toggleInlineVideo(messageId, videoUri)}
                            >
                                <MaterialIcons
                                    name="play-circle-filled"
                                    size={48}
                                    color="rgba(255, 255, 255, 0.8)"
                                />
                            </TouchableOpacity>
                        )}

                        {/* Центрированная кнопка воспроизведения для полноэкранного режима */}
                        {!videoState.isPlaying && videoState.isExpanded && (
                            <TouchableOpacity
                                style={styles.fullscreenPlayOverlay}
                                onPress={() => toggleInlineVideo(messageId, videoUri)}
                            >
                                <MaterialIcons
                                    name="play-circle-filled"
                                    size={80}
                                    color="rgba(255, 255, 255, 0.8)"
                                />
                            </TouchableOpacity>
                        )}
                    </View>
                );
            } else if (item.mediaType === 'file') {
                // Проверяем, есть ли данные для отображения документа
                const hasFileData = item.mediaUri || item.serverFileUrl;

                if (!hasFileData) {
                    return (
                        <View style={styles.missingMediaContainer}>
                            <MaterialIcons name="description" size={48} color={theme.textSecondary} />
                            <Text style={[styles.missingMediaText, { color: theme.textSecondary }]}>
                                {item.mediaFileName || 'Документ'} {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + 'MB' : ''}
                            </Text>
                            <Text style={[styles.missingMediaSubtext, { color: theme.placeholder }]}>
                                Файл недоступен
                            </Text>
                        </View>
                    );
                }

                // Определяем иконку по типу файла
                const getFileIcon = (fileName?: string, mimeType?: string) => {
                    if (mimeType?.includes('pdf') || fileName?.toLowerCase().endsWith('.pdf')) {
                        return 'picture-as-pdf';
                    } else if (mimeType?.includes('word') || fileName?.toLowerCase().match(/\.(doc|docx)$/)) {
                        return 'description';
                    } else if (mimeType?.includes('excel') || fileName?.toLowerCase().match(/\.(xls|xlsx)$/)) {
                        return 'grid-on';
                    } else if (mimeType?.includes('powerpoint') || fileName?.toLowerCase().match(/\.(ppt|pptx)$/)) {
                        return 'slideshow';
                    } else if (mimeType?.includes('text') || fileName?.toLowerCase().endsWith('.txt')) {
                        return 'text-snippet';
                    } else if (mimeType?.includes('zip') || fileName?.toLowerCase().match(/\.(zip|rar|7z)$/)) {
                        return 'archive';
                    }
                    return 'description';
                };

                const fileIcon = getFileIcon(item.mediaFileName, item.mimeType);
                const fileUrl = item.serverFileUrl || item.mediaUri;

                return (
                    <TouchableOpacity
                        style={styles.fileContainer}
                        onPress={() => {
                            if (fileUrl) {
                                // Открываем файл в браузере или внешнем приложении
                                Alert.alert(
                                    'Открыть файл',
                                    `Открыть "${item.mediaFileName || 'файл'}" во внешнем приложении?`,
                                    [
                                        { text: 'Отмена', style: 'cancel' },
                                        {
                                            text: 'Открыть',
                                            onPress: async () => {
                                                try {
                                                    const { WebBrowser } = await import('expo-web-browser');
                                                    await WebBrowser.openBrowserAsync(fileUrl);
                                                } catch (error) {
                                                    console.error('Error opening file:', error);
                                                    Alert.alert('Ошибка', 'Не удалось открыть файл');
                                                }
                                            }
                                        }
                                    ]
                                );
                            }
                        }}
                        activeOpacity={0.7}
                    >
                        <View style={styles.fileIconContainer}>
                            <MaterialIcons
                                name={fileIcon as any}
                                size={32}
                                color={theme.primary}
                            />
                        </View>
                        <View style={styles.fileInfo}>
                            <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={2}>
                                {item.mediaFileName || 'Документ'}
                            </Text>
                            <Text style={[styles.fileSize, { color: theme.textSecondary }]}>
                                {item.mediaSize ? `${Math.round(item.mediaSize / 1024)} КБ` : 'Размер неизвестен'}
                            </Text>
                            {item.mimeType && (
                                <Text style={[styles.fileMimeType, { color: theme.placeholder }]}>
                                    {item.mimeType}
                                </Text>
                            )}
                        </View>
                        <MaterialIcons
                            name="download"
                            size={20}
                            color={theme.textSecondary}
                        />
                    </TouchableOpacity>
                );
            }

            return null;
        };

        return (
            <View style={[
                styles.messageContainer,
                isMyMessage ? styles.myMessage : styles.otherMessage,
                item.mediaType ? styles.mediaMessage : null
            ]}>
                {!isMyMessage && (
                    <Text style={[styles.senderName, { color: theme.textSecondary }]}>{item.sender__username}</Text>
                )}

                {renderMediaContent()}

                <Text style={[
                    styles.messageText,
                    isMyMessage ? styles.myMessageText : styles.otherMessageText,
                    item.mediaType ? styles.mediaMessageText : null
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
                    <View style={styles.mediaButtonsContainer}>
                        <TouchableOpacity
                            style={[styles.mediaButton, { backgroundColor: theme.surface }]}
                            onPress={pickImage}
                            disabled={!isConnected || !isDataLoaded || !recipient || !currentUserId}
                        >
                            <MaterialIcons
                                name="photo"
                                size={24}
                                color={(isConnected && isDataLoaded && recipient && currentUserId) ? theme.primary : theme.placeholder}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.mediaButton, { backgroundColor: theme.surface }]}
                            onPress={pickVideo}
                            disabled={!isConnected || !isDataLoaded || !recipient || !currentUserId}
                        >
                            <MaterialIcons
                                name="videocam"
                                size={24}
                                color={(isConnected && isDataLoaded && recipient && currentUserId) ? theme.primary : theme.placeholder}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.mediaButton, { backgroundColor: theme.surface }]}
                            onPress={pickDocument}
                            disabled={!isConnected || !isDataLoaded || !recipient || !currentUserId}
                        >
                            <MaterialIcons
                                name="attach-file"
                                size={24}
                                color={(isConnected && isDataLoaded && recipient && currentUserId) ? theme.primary : theme.placeholder}
                            />
                        </TouchableOpacity>

                        {/* Кнопка для ручного переподключения */}
                        {(!isConnected || reconnectAttempts >= 3) && (
                            <TouchableOpacity
                                style={[styles.mediaButton, { backgroundColor: '#ff9800' }]}
                                onPress={() => {
                                    setReconnectAttempts(0);
                                    setLastReconnectTime(0);
                                    reconnect();
                                }}
                            >
                                <MaterialIcons
                                    name="wifi"
                                    size={24}
                                    color="white"
                                />
                            </TouchableOpacity>
                        )}
                    </View>
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

                {/* Просмотрщик изображений */}
                <Modal
                    visible={isImageViewerVisible}
                    transparent={true}
                    animationType="fade"
                    onRequestClose={() => setIsImageViewerVisible(false)}
                >
                    <View style={styles.imageViewerContainer}>
                        <TouchableOpacity
                            style={styles.imageViewerCloseButton}
                            onPress={() => setIsImageViewerVisible(false)}
                        >
                            <MaterialIcons name="close" size={30} color="white" />
                        </TouchableOpacity>
                        {selectedImage && (
                            <Image
                                source={{ uri: selectedImage }}
                                style={styles.fullScreenImage}
                                resizeMode="contain"
                            />
                        )}
                    </View>
                </Modal>

                {/* Полноэкранный видеоплеер */}
                <Modal
                    visible={isVideoViewerVisible}
                    transparent={false}
                    animationType="slide"
                    onRequestClose={() => setIsVideoViewerVisible(false)}
                >
                    <View style={styles.videoViewerContainer}>
                        {/* Кнопка принудительного воспроизведения */}
                        {!isVideoPlaying && !videoError && (
                            <TouchableOpacity
                                style={styles.forcePlayButton}
                                onPress={forcePlayVideo}
                            >
                                <MaterialIcons name="play-circle-filled" size={64} color="rgba(255, 255, 255, 0.9)" />
                                <Text style={styles.forcePlayText}>Нажмите для воспроизведения</Text>
                                <Text style={styles.forcePlaySubtext}>(без звука)</Text>
                            </TouchableOpacity>
                        )}

                        {/* Кнопка управления звуком */}
                        {isVideoPlaying && (
                            <TouchableOpacity
                                style={styles.soundButton}
                                onPress={toggleVideoSound}
                            >
                                <MaterialIcons
                                    name={isVideoMuted ? "volume-off" : "volume-up"}
                                    size={24}
                                    color={audioSessionReady ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 255, 255, 0.5)"}
                                />
                                {!audioSessionReady && (
                                    <View style={styles.audioWarningDot} />
                                )}
                            </TouchableOpacity>
                        )}

                        {/* Кнопка системного плеера */}
                        {selectedVideo?.startsWith('http') && (
                            <TouchableOpacity
                                style={styles.systemPlayerButton}
                                onPress={() => openInSystemPlayer(selectedVideo)}
                            >
                                <MaterialIcons name="open-in-new" size={24} color="rgba(255, 255, 255, 0.9)" />
                            </TouchableOpacity>
                        )}

                        {/* Отображение ошибки */}
                        {videoError && (
                            <View style={styles.videoErrorContainer}>
                                <MaterialIcons name="error" size={48} color="red" />
                                <Text style={styles.videoErrorText}>Ошибка воспроизведения:</Text>
                                <Text style={styles.videoErrorDetails}>{videoError}</Text>
                                <TouchableOpacity
                                    style={styles.retryButton}
                                    onPress={forcePlayVideo}
                                >
                                    <Text style={styles.retryButtonText}>Попробовать снова</Text>
                                </TouchableOpacity>
                                {selectedVideo?.startsWith('http') && (
                                    <TouchableOpacity
                                        style={[styles.retryButton, { backgroundColor: 'rgba(0, 123, 255, 0.3)' }]}
                                        onPress={() => openInSystemPlayer(selectedVideo)}
                                    >
                                        <Text style={styles.retryButtonText}>Открыть в системном плеере</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

                        <TouchableOpacity
                            style={styles.videoViewerCloseButton}
                            onPress={async () => {
                                try {
                                    // Останавливаем видео перед закрытием
                                    if (videoRef.current) {
                                        await videoRef.current.pauseAsync();
                                        await videoRef.current.unloadAsync();
                                    }

                                    console.log('🎥 [CLEANUP] Video stopped and unloaded');
                                } catch (cleanupError) {
                                    console.warn('🎥 [CLEANUP] Error during video cleanup:', cleanupError);
                                }

                                setIsVideoViewerVisible(false);
                                setSelectedVideo(null);
                                setIsVideoPlaying(false);
                                setIsVideoMuted(true);
                                setVideoError(null);
                            }}
                        >
                            <MaterialIcons name="close" size={30} color="white" />
                        </TouchableOpacity>
                        {selectedVideo && (
                            <Video
                                ref={videoRef}
                                source={{ uri: selectedVideo }}
                                style={styles.fullScreenVideo}
                                resizeMode={ResizeMode.CONTAIN}
                                useNativeControls={false}
                                shouldPlay={false}
                                isLooping={false}
                                isMuted={isVideoMuted}
                                onLoad={(data) => {
                                    console.log('🎥 [FULLSCREEN] Video loaded:', {
                                        duration: data.durationMillis,
                                        naturalSize: data.naturalSize,
                                        uri: selectedVideo?.substring(selectedVideo.lastIndexOf('/') + 1)
                                    });

                                    // Не запускаем автоматически - пользователь сам нажмет play
                                    console.log('🎥 [FULLSCREEN] Video ready for manual playback');
                                }}
                                onError={(error) => {
                                    console.error('🎥 [FULLSCREEN] ❌ Video error:', {
                                        error: error,
                                        uri: selectedVideo?.substring(selectedVideo.lastIndexOf('/') + 1),
                                        uriType: selectedVideo?.startsWith('data:') ? 'base64' :
                                                 selectedVideo?.startsWith('http') ? 'url' : 'file',
                                        fullUri: selectedVideo
                                    });

                                    Alert.alert(
                                        'Ошибка воспроизведения',
                                        `Не удалось воспроизвести видео.\n\nТип: ${selectedVideo?.startsWith('data:') ? 'Base64' : selectedVideo?.startsWith('http') ? 'URL' : 'Файл'}\n\nОшибка: ${JSON.stringify(error)}`,
                                        [
                                            { text: 'Закрыть', onPress: () => setIsVideoViewerVisible(false) },
                                            {
                                                text: 'Открыть в браузере',
                                                onPress: async () => {
                                                    try {
                                                        if (selectedVideo?.startsWith('http')) {
                                                            const { WebBrowser } = await import('expo-web-browser');
                                                            await WebBrowser.openBrowserAsync(selectedVideo);
                                                        } else {
                                                            Alert.alert('Ошибка', 'Невозможно открыть в браузере - это не URL');
                                                        }
                                                    } catch (browserError) {
                                                        console.error('Browser open error:', browserError);
                                                        Alert.alert('Ошибка', 'Не удалось открыть в браузере');
                                                    }
                                                    setIsVideoViewerVisible(false);
                                                }
                                            }
                                        ]
                                    );
                                }}
                                onPlaybackStatusUpdate={(status) => {
                                    if ('error' in status) {
                                        console.error('🎥 [FULLSCREEN] Playback error:', status.error);
                                        setVideoError(status.error || 'Ошибка воспроизведения');
                                        setIsVideoPlaying(false);
                                    } else if ('durationMillis' in status && status.isLoaded) {
                                        // Отслеживаем изменения состояния воспроизведения
                                        if (status.isPlaying !== isVideoPlaying) {
                                            setIsVideoPlaying(status.isPlaying);
                                        }

                                        // Логируем важные изменения
                                        if (status.isPlaying || status.positionMillis > 0) {
                                            console.log('🎥 [FULLSCREEN] Playback status:', {
                                                duration: Math.round(status.durationMillis / 1000) + 's',
                                                position: Math.round(status.positionMillis / 1000) + 's',
                                                isPlaying: status.isPlaying,
                                                rate: status.rate
                                            });
                                        }
                                    }
                                }}
                                onReadyForDisplay={(data) => {
                                    console.log('🎥 [FULLSCREEN] Ready for display:', {
                                        naturalSize: data.naturalSize
                                    });
                                }}
                            />
                        )}
                    </View>
                </Modal>
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
    mediaButtonsContainer: {
        flexDirection: 'row',
        marginRight: 8,
    },
    mediaButton: {
        justifyContent: 'center',
        alignItems: 'center',
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: 4,
        borderWidth: 1,
        borderColor: theme.border,
    },
    mediaContainer: {
        marginBottom: 8,
        borderRadius: 12,
        overflow: 'hidden',
    },
    messageImage: {
        width: 200,
        minHeight: 100,
        maxHeight: 300,
        borderRadius: 12,
    },
    messageVideo: {
        width: 200,
        height: 150,
        borderRadius: 12,
    },
    mediaMessage: {
        maxWidth: '85%',
    },
    mediaMessageText: {
        fontSize: 14,
        fontStyle: 'italic',
    },
    imageViewerContainer: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    imageViewerCloseButton: {
        position: 'absolute',
        top: 50,
        right: 20,
        zIndex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        borderRadius: 20,
        padding: 5,
    },
    fullScreenImage: {
        width: '90%',
        height: '80%',
    },
    videoPlayOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        borderRadius: 12,
    },
    videoViewerContainer: {
        flex: 1,
        backgroundColor: 'black',
        justifyContent: 'center',
        alignItems: 'center',
    },
    videoViewerCloseButton: {
        position: 'absolute',
        top: 50,
        right: 20,
        zIndex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        borderRadius: 20,
        padding: 8,
    },
    fullScreenVideo: {
        width: '100%',
        height: '100%',
    },
    uploadingContainer: {
        marginBottom: 8,
        padding: 12,
        borderRadius: 12,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        minHeight: 80,
        justifyContent: 'center',
    },
    uploadingContent: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    uploadingText: {
        marginTop: 8,
        fontSize: 14,
        fontStyle: 'italic',
    },
    progressContainer: {
        marginTop: 8,
        width: '100%',
        alignItems: 'center',
    },
    progressBar: {
        width: '80%',
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 2,
    },
    progressText: {
        marginTop: 4,
        fontSize: 12,
    },
    reloadContainer: {
        marginBottom: 8,
        padding: 16,
        borderRadius: 12,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderStyle: 'dashed',
        minHeight: 80,
        justifyContent: 'center',
        alignItems: 'center',
    },
    reloadContent: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    reloadText: {
        marginTop: 8,
        fontSize: 14,
        fontStyle: 'italic',
        textAlign: 'center',
    },
    reloadSubtext: {
        marginTop: 4,
        fontSize: 12,
        textAlign: 'center',
    },
    reloadHint: {
        marginTop: 6,
        fontSize: 11,
        textAlign: 'center',
        fontStyle: 'italic',
    },
    missingMediaContainer: {
        marginBottom: 8,
        padding: 20,
        borderRadius: 12,
        backgroundColor: 'rgba(128, 128, 128, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(128, 128, 128, 0.3)',
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 100,
    },
    missingMediaText: {
        marginTop: 8,
        fontSize: 14,
        fontWeight: '500',
        textAlign: 'center',
    },
    missingMediaSubtext: {
        marginTop: 4,
        fontSize: 12,
        textAlign: 'center',
        fontStyle: 'italic',
    },
    fileContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        padding: 12,
        borderRadius: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.1)',
        minHeight: 60,
    },
    fileIconContainer: {
        marginRight: 12,
        alignItems: 'center',
        justifyContent: 'center',
        width: 40,
        height: 40,
        borderRadius: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
    },
    fileInfo: {
        flex: 1,
        marginRight: 8,
    },
    fileName: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 2,
    },
    fileSize: {
        fontSize: 12,
        marginBottom: 1,
    },
    fileMimeType: {
        fontSize: 10,
        fontStyle: 'italic',
    },
    forcePlayButton: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: [{ translateX: -32 }, { translateY: -50 }],
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
    },
    forcePlayText: {
        color: 'white',
        fontSize: 16,
        marginTop: 8,
        textAlign: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 8,
    },
    forcePlaySubtext: {
        color: 'rgba(255, 255, 255, 0.7)',
        fontSize: 12,
        marginTop: 4,
        textAlign: 'center',
        fontStyle: 'italic',
    },
    soundButton: {
        position: 'absolute',
        bottom: 100,
        right: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        padding: 12,
        borderRadius: 25,
        zIndex: 2,
    },
    videoErrorContainer: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: [{ translateX: -100 }, { translateY: -100 }],
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 20,
        borderRadius: 12,
        width: 200,
        zIndex: 2,
    },
    videoErrorText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
        marginTop: 8,
        textAlign: 'center',
    },
    videoErrorDetails: {
        color: 'white',
        fontSize: 12,
        marginTop: 8,
        textAlign: 'center',
        opacity: 0.8,
    },
    retryButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
        marginTop: 12,
    },
    retryButtonText: {
        color: 'white',
        fontSize: 14,
        fontWeight: 'bold',
    },
    audioWarningDot: {
        position: 'absolute',
        top: 2,
        right: 2,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: 'orange',
    },
    systemPlayerButton: {
        position: 'absolute',
        bottom: 100,
        left: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        padding: 12,
        borderRadius: 25,
        zIndex: 2,
    },
    // Стили для встроенного видеоплеера
    inlineVideoContainer: {
        position: 'relative',
        marginBottom: 8,
        borderRadius: 12,
        overflow: 'hidden',
        width: 280,
        height: 200,
    },
    inlineVideo: {
        width: '100%',
        height: '100%',
        borderRadius: 12,
    },
    fullscreenVideoContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        backgroundColor: 'black',
        marginBottom: 0,
        borderRadius: 0,
    },
    fullscreenVideo: {
        width: '100%',
        height: '100%',
        borderRadius: 0,
    },
    inlineVideoControls: {
        position: 'absolute',
        bottom: 8,
        right: 8,
        flexDirection: 'row',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 20,
        padding: 4,
        zIndex: 1,
    },
    fullscreenVideoControls: {
        position: 'absolute',
        bottom: 60,
        right: 20,
        flexDirection: 'row',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderRadius: 25,
        padding: 8,
        zIndex: 1,
    },
    inlineVideoButton: {
        padding: 6,
        marginHorizontal: 2,
        borderRadius: 15,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 30,
        minHeight: 30,
    },
    videoProgressContainer: {
        position: 'absolute',
        bottom: 40,
        left: 8,
        right: 8,
        zIndex: 1,
    },
    videoProgressBar: {
        height: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
        borderRadius: 2,
        overflow: 'hidden',
    },
    videoProgressFill: {
        height: '100%',
        backgroundColor: '#007AFF',
        borderRadius: 2,
    },
    videoProgressTouch: {
        position: 'absolute',
        top: -10,
        bottom: -10,
        left: 0,
        right: 0,
    },
    videoTimeContainer: {
        position: 'absolute',
        bottom: 50,
        left: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        zIndex: 1,
    },
    videoTimeText: {
        color: 'white',
        fontSize: 12,
        fontFamily: 'monospace',
    },
    fullscreenPlayOverlay: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: [{ translateX: -40 }, { translateY: -40 }],
        zIndex: 2,
    },
});