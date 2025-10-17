import React, {useState, useEffect, useRef, useCallback} from 'react';

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
    Image,
    Modal,
    AppState,
    Linking,
    Dimensions,
} from 'react-native';
import {GestureDetector, Gesture, GestureHandlerRootView} from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    runOnJS
} from 'react-native-reanimated';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useWebSocket} from '../../hooks/useWebSocket';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {MaterialIcons} from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useNotifications } from '../../contexts/NotificationContext';
import DirectImage from '../../components/DirectImage';
import LazyMedia from '../../components/LazyMedia';
import {API_CONFIG} from '../../config';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Video, ResizeMode, Audio, AVPlaybackStatus } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import * as IntentLauncher from 'expo-intent-launcher';
import {useSafeAreaInsets} from "react-native-safe-area-context";

interface Message {
    id: number;
    message: string;
    timestamp: number | string;
    sender__username: string;
    sender_id?: number;
    mediaType?: 'image' | 'video' | 'audio' | 'file';
    mediaBase64?: string;
    mediaHash?: string;
    mediaFileName?: string;
    mediaSize?: number;
    mimeType?: string;
    isUploading?: boolean;
    uploadProgress?: number;
    needsReload?: boolean;
    serverFileUrl?: string;
    isLoadingServerUrl?: boolean;
    mediaUri?: string | null;
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
    const [isInitialLoading, setIsInitialLoading] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [isImageViewerVisible, setIsImageViewerVisible] = useState(false);
    const [lastImageTap, setLastImageTap] = useState(0);

    // Анимационные значения для масштабирования (как в альбоме)
    const scale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const lastScale = useSharedValue(1);
    const lastTranslateX = useSharedValue(0);
    const lastTranslateY = useSharedValue(0);
    const [zoomLevel, setZoomLevel] = useState(0); // 0 - обычный, 1 - 1.5x, 2 - 2.5x
    const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
    const [isVideoViewerVisible, setIsVideoViewerVisible] = useState(false);
    // Id сообщения, откуда открывается видео (нужен для скачивания)
    const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
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
        isLoaded: boolean,
        isFullscreen: boolean
    }}>({});
    const [fullscreenModalVideoUri, setFullscreenModalVideoUri] = useState<string | null>(null);
    const [isFullscreenModalVisible, setIsFullscreenModalVisible] = useState(false);
    const [downloadingDocuments, setDownloadingDocuments] = useState<{[key: number]: boolean}>({});
    const [documentDownloadProgress, setDocumentDownloadProgress] = useState<{[key: number]: number}>({});

    // Состояния для записи аудио
    const [isRecordingAudio, setIsRecordingAudio] = useState(false);

    // Флаг для отслеживания активности компонента чата
    const [isChatActive, setIsChatActive] = useState(true);

    // Кеш для отслеживания уже помеченных сообщений (предотвращение дублирования)
    const markedAsReadCache = useRef<Set<number>>(new Set());
    // Состояние для отслеживания непрочитанных сообщений с анимацией
    const [unreadMessages, setUnreadMessages] = useState<Set<number>>(new Set());
    const unreadAnimations = useRef<{[key: number]: Animated.Value}>({});
    // Очередь для сообщений, полученных до инициализации
    const pendingMessagesQueue = useRef<Array<{messageId: number, senderId: number}>>([]);
    // Ref'ы для актуальных значений состояний (для использования в WebSocket колбэках)
    const currentUserIdRef = useRef<number | null>(null);
    const isDataLoadedRef = useRef<boolean>(false);
    const isConnectedRef = useRef<boolean>(false);
    const isChatActiveRef = useRef<boolean>(false);
    const [audioRecording, setAudioRecording] = useState<Audio.Recording | null>(null);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [audioPermissionGranted, setAudioPermissionGranted] = useState(false);
    const [playingAudioId, setPlayingAudioId] = useState<number | null>(null);
    const [audioPlaybackStates, setAudioPlaybackStates] = useState<{[key: number]: {
        isPlaying: boolean;
        position: number;
        duration: number;
        sound: Audio.Sound | null;
    }}>({});

    const flatListRef = useRef<FlatList>(null);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const videoRef = useRef<any>(null);
    const inlineVideoRefs = useRef<{[key: string]: any}>({});
    const prevPendingCount = useRef(0);
    const router = useRouter();

    const updateMessageSafely = (messageId: number | string, updates: Partial<Message>) => {
        setMessages(prev =>
            prev.map(msg => msg.id === messageId ? { ...msg, ...updates } : msg)
        );
    };

    // Функция для анимированного перехода сообщения в состояние "прочитано"
    const animateMessageAsRead = useCallback((messageId: number) => {
        console.log('✨ [ANIMATION] Starting read animation for message:', messageId);
        console.log('✨ [ANIMATION] Current unread messages:', Array.from(unreadMessages));
        console.log('✨ [ANIMATION] Animation exists:', !!unreadAnimations.current[messageId]);

        // Создаем анимацию затухания фона, если еще не создана
        if (!unreadAnimations.current[messageId]) {
            const AnimatedNative = require('react-native').Animated;
            unreadAnimations.current[messageId] = new AnimatedNative.Value(1);
            console.log('✨ [ANIMATION] Created new animation value for message:', messageId);
        }

        // Плавно убираем фоновую подсветку за 1.5 секунды
        const AnimatedNative = require('react-native').Animated;
        AnimatedNative.timing(unreadAnimations.current[messageId], {
            toValue: 0,
            duration: 1500, // 1.5 секунды для плавного перехода
            useNativeDriver: false, // backgroundColor не поддерживает native driver
        }).start(() => {
            // После завершения анимации удаляем сообщение из непрочитанных
            console.log('✨ [ANIMATION] Animation finished, removing from unread:', messageId);

            // Используем setTimeout чтобы избежать обновления состояния во время рендера
            setTimeout(() => {
                setUnreadMessages(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(messageId);
                    console.log('✨ [ANIMATION] Updated unread messages:', Array.from(newSet));
                    return newSet;
                });
                // Очищаем анимацию
                delete unreadAnimations.current[messageId];
                console.log('✨ [ANIMATION] Read animation completed for message:', messageId);
            }, 0);
        });
    }, []);

    // Функция для массовой отметки сообщений как прочитанных (для истории)
    const markMultipleMessagesAsRead = useCallback((messageIds: number[]) => {
        // ИСПОЛЬЗУЕМ REF'Ы для актуальных значений
        const actualCurrentUserId = currentUserIdRef.current;
        const actualIsConnected = isConnectedRef.current;
        const actualIsChatActive = isChatActiveRef.current;
        const actualIsDataLoaded = isDataLoadedRef.current;

        console.log('📖 [BULK-READ] ========== MARKING MULTIPLE MESSAGES AS READ ==========');
        console.log('📖 [BULK-READ] Count:', messageIds.length);
        console.log('📖 [BULK-READ] Current state (from refs):', {
            actualIsChatActive,
            actualIsConnected,
            actualIsDataLoaded,
            actualCurrentUserId,
            roomId
        });

        if (!actualIsChatActive || !actualIsConnected || !actualIsDataLoaded || !actualCurrentUserId) {
            console.warn('📖 [BULK-READ] ⚠️ Cannot mark bulk messages - conditions not met');
            return;
        }

        // Фильтруем сообщения: убираем уже помеченные и свои собственные
        const messagesToMark = messageIds.filter(id => !markedAsReadCache.current.has(id));

        if (messagesToMark.length === 0) {
            console.log('📖 [BULK-READ] ℹ️ No messages to mark (all already marked or own messages)');
            return;
        }

        console.log('📖 [BULK-READ] Messages to mark:', messagesToMark.length);

        // Добавляем в кеш ВСЕ сообщения перед отправкой
        messagesToMark.forEach(id => markedAsReadCache.current.add(id));

        try {
            const bulkReadData = {
                type: 'mark_multiple_as_read',
                message_ids: messagesToMark,
                room_id: roomId,
                user_id: actualCurrentUserId
            };

            console.log('📖 [BULK-READ] Sending bulk read receipt for', messagesToMark.length, 'messages');
            sendMessage(bulkReadData);
            console.log('📖 [BULK-READ] ✅ Bulk read receipt sent successfully');
        } catch (error) {
            console.error('📖 [BULK-READ] ❌ Error sending bulk read receipt:', error);
            // Убираем из кеша при ошибке
            messagesToMark.forEach(id => markedAsReadCache.current.delete(id));
        }
    }, [roomId, sendMessage]);

    // Функция для отправки уведомления о прочитанности сообщения
    const markMessageAsRead = useCallback((messageId: number, senderId: number) => {
        // Проверяем, не было ли это сообщение уже помечено
        if (markedAsReadCache.current.has(messageId)) {
            console.log('📖 [READ-RECEIPT] ⚠️ Message', messageId, 'already marked as read (cached)');
            return;
        }

        // ИСПОЛЬЗУЕМ REF'Ы для актуальных значений
        const actualCurrentUserId = currentUserIdRef.current;
        const actualIsConnected = isConnectedRef.current;
        const actualIsChatActive = isChatActiveRef.current;
        const actualIsDataLoaded = isDataLoadedRef.current;

        console.log('📖 [READ-RECEIPT] ========== ATTEMPTING TO MARK MESSAGE AS READ ==========');
        console.log('📖 [READ-RECEIPT] Message ID:', messageId);
        console.log('📖 [READ-RECEIPT] Sender ID:', senderId);
        console.log('📖 [READ-RECEIPT] Current User ID (ref):', actualCurrentUserId);
        console.log('📖 [READ-RECEIPT] Room ID:', roomId);
        console.log('📖 [READ-RECEIPT] Conditions (from refs):', {
            actualIsChatActive,
            actualIsConnected,
            actualIsDataLoaded,
            senderId,
            actualCurrentUserId,
            isNotMyMessage: senderId !== actualCurrentUserId
        });

        // УЛУЧШЕННАЯ ПРОВЕРКА: более гибкие условия
        // Главное - не отправлять для своих сообщений
        if (senderId === actualCurrentUserId) {
            console.log('📖 [READ-RECEIPT] ⚠️ Skipping - this is my own message');
            return;
        }

        // Проверяем минимальные требования
        if (!actualCurrentUserId) {
            console.warn('📖 [READ-RECEIPT] ⚠️ Cannot send - currentUserId not initialized');
            return;
        }

        // ОТПРАВЛЯЕМ даже если чат неактивен (для фоновой обработки)
        // но ТОЛЬКО если WebSocket подключен
        // FALLBACK: используем wsIsConnected() если ref показывает false
        const wsConnectedNow = wsIsConnected();
        const isActuallyConnected = actualIsConnected || wsConnectedNow;

        if (!isActuallyConnected) {
            console.warn('📖 [READ-RECEIPT] ⚠️ Cannot send - WebSocket not connected');
            console.warn('📖 [READ-RECEIPT] Connection status:', {
                refValue: actualIsConnected,
                wsIsConnected: wsConnectedNow,
                actuallyConnected: isActuallyConnected
            });
            return;
        }

        console.log('📖 [READ-RECEIPT] ✅ Connection verified:', {
            refValue: actualIsConnected,
            wsIsConnected: wsConnectedNow,
            usingFallback: !actualIsConnected && wsConnectedNow
        });

        // Добавляем в кеш ПЕРЕД отправкой
        markedAsReadCache.current.add(messageId);
        console.log('📖 [READ-RECEIPT] ✅ Conditions met, sending read receipt...');

        try {
            const readReceiptData = {
                type: 'mark_as_read',
                message_id: messageId,
                room_id: roomId,
                user_id: actualCurrentUserId
            };

            console.log('📖 [READ-RECEIPT] Sending data:', JSON.stringify(readReceiptData, null, 2));

            sendMessage(readReceiptData);

            console.log('📖 [READ-RECEIPT] ✅✅✅ Read receipt sent successfully for message:', messageId);
        } catch (error) {
            console.error('📖 [READ-RECEIPT] ❌ Error sending read receipt:', error);
            // Убираем из кеша при ошибке
            markedAsReadCache.current.delete(messageId);
        }
    }, [roomId, sendMessage, wsIsConnected]);

    // Создаем стили с темой
    const styles = createStyles(theme);

    useEffect(() => {
        if (!isConnected && wsIsConnected() && isDataLoaded && recipient && currentUserId) {
            setIsConnected(true);
            setReconnectAttempts(0);
            setLastReconnectTime(0);
        }
    }, [isConnected, isDataLoaded, recipient, currentUserId, wsIsConnected]);

    // Дополнительная синхронизация isConnected с wsIsConnected
    useEffect(() => {
        const checkConnection = () => {
            const wsConnected = wsIsConnected();
            const refValue = isConnectedRef.current;

            if (wsConnected !== refValue) {
                console.log('🔄 [CONNECTION-SYNC] WebSocket connection state mismatch detected:', {
                    refValue: refValue,
                    wsConnected: wsConnected,
                    stateValue: isConnected
                });

                // Синхронизируем в обе стороны
                if (wsConnected && !isConnected) {
                    console.log('🔄 [CONNECTION-SYNC] ✅ Updating state: connected');
                    setIsConnected(true);
                } else if (!wsConnected && isConnected) {
                    console.log('🔄 [CONNECTION-SYNC] ⚠️ Updating state: disconnected');
                    setIsConnected(false);
                }
            }
        };

        // Немедленная проверка при монтировании
        checkConnection();

        // Проверяем подключение каждые 200мс (сокращено для более быстрой синхронизации)
        const intervalId = setInterval(checkConnection, 200);

        return () => {
            clearInterval(intervalId);
        };
    }, [isConnected, wsIsConnected]);

    const {connect, disconnect, sendMessage, isConnected: wsIsConnected, reconnect} = useWebSocket(
        `/${API_CONFIG.WS_PROTOCOL}/private/${roomId}/`,
        {
            onOpen: () => {
                console.log('🌐 [WEBSOCKET] ========== CONNECTION OPENED ==========');
                console.log('🌐 [WEBSOCKET] Setting isConnected to true');
                console.log('🌐 [WEBSOCKET] Current refs:', {
                    currentUserIdRef: currentUserIdRef.current,
                    isDataLoadedRef: isDataLoadedRef.current,
                    isConnectedRef: isConnectedRef.current
                });
                setIsConnected(true);
                setReconnectAttempts(0);
                setLastReconnectTime(0);
            },
            onMessage: async (event: any) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'messages_by_sender_update') {
                        return;
                    }

                    if (data.error) {
                        Alert.alert('Ошибка', data.error);
                        return;
                    }

                    if (data.type === 'media_url_response') {
                        if (data.success && data.file_url && data.message_id) {
                            updateMessageSafely(data.message_id, {
                                serverFileUrl: data.file_url,
                                isLoadingServerUrl: false,
                                needsReload: false
                            });
                        } else {
                            updateMessageSafely(data.message_id, {
                                isLoadingServerUrl: false,
                                needsReload: true
                            });
                        }
                        return;
                    }

                    // Обработка сообщений чата (включая сообщения без типа)
                    if (data.message && (!data.type || data.type === 'chat_message' || data.type === 'media_message')) {
                        console.log('💬 [NEW-MESSAGE] ========== NEW MESSAGE RECEIVED ==========');
                        console.log('💬 [NEW-MESSAGE] Data:', JSON.stringify(data, null, 2));

                        // КРИТИЧНО: Используем ref'ы для актуальных значений
                        const actualCurrentUserId = currentUserIdRef.current;
                        const actualIsDataLoaded = isDataLoadedRef.current;
                        const actualIsConnected = isConnectedRef.current;
                        const actualIsChatActive = isChatActiveRef.current;

                        // Дополнительная проверка через wsIsConnected()
                        const wsConnectedNow = wsIsConnected();

                        console.log('💬 [NEW-MESSAGE] Actual state from refs:', {
                            actualCurrentUserId,
                            actualIsDataLoaded,
                            actualIsConnected,
                            actualIsChatActive,
                            wsConnectedNow
                        });

                        // Если ref показывает отключен, но wsIsConnected() показывает подключен - обновляем
                        if (!actualIsConnected && wsConnectedNow) {
                            console.log('💬 [NEW-MESSAGE] ⚠️ Ref out of sync, updating isConnected...');
                            setIsConnected(true);
                        }

                        // Проверяем инициализацию с использованием актуальных значений
                        if (!actualCurrentUserId || !actualIsDataLoaded) {
                            console.warn('💬 [NEW-MESSAGE] ⚠️ Received message before initialization complete');
                            console.warn('💬 [NEW-MESSAGE] Current state:', {
                                actualCurrentUserId,
                                actualIsDataLoaded,
                                actualIsConnected
                            });
                            console.warn('💬 [NEW-MESSAGE] Message will be processed after initialization');

                            // Сообщение все равно добавится, но не будет помечено как прочитанное
                            // до завершения инициализации
                        }

                        const isMyMessage = (data.sender_id === actualCurrentUserId) || (data.sender__username === currentUsername);

                        const messageId = data.id || Date.now();

                        console.log('💬 [NEW-MESSAGE] Analysis:', {
                            messageId,
                            isMyMessage,
                            hasSenderId: !!data.sender_id,
                            actualCurrentUserId,
                            currentUsername,
                            actualIsDataLoaded,
                            senderUsername: data.sender__username,
                            senderId: data.sender_id
                        });

                        // Автоматически помечаем сообщение как прочитанное, если:
                        // 1. Это не мое сообщение
                        // 2. Пользователь находится в чате
                        // 3. Сообщение имеет валидный ID
                        // 4. Все необходимые данные инициализированы
                        if (!isMyMessage && messageId && data.sender_id) {
                            if (actualCurrentUserId && actualIsDataLoaded) {
                                console.log('💬 [NEW-MESSAGE] ✅ All conditions met, will mark as read with animation in 2000ms');
                                console.log('💬 [NEW-MESSAGE] Validated data:', {
                                    messageId,
                                    senderId: data.sender_id,
                                    actualCurrentUserId,
                                    actualIsDataLoaded,
                                    actualIsConnected,
                                    actualIsChatActive
                                });

                                // Добавляем сообщение в список непрочитанных для визуальной индикации
                                setUnreadMessages(prev => {
                                    const newSet = new Set(prev);
                                    newSet.add(messageId);
                                    console.log('💬 [NEW-MESSAGE] ✅ Added to unread messages:', messageId);
                                    console.log('💬 [NEW-MESSAGE] Total unread messages:', newSet.size);
                                    console.log('💬 [NEW-MESSAGE] Unread IDs:', Array.from(newSet));
                                    return newSet;
                                });

                                // Создаем анимацию для этого сообщения
                                if (!unreadAnimations.current[messageId]) {
                                    const AnimatedNative = require('react-native').Animated;
                                    unreadAnimations.current[messageId] = new AnimatedNative.Value(1);
                                    console.log('💬 [NEW-MESSAGE] ✅ Created animation for message:', messageId);
                                }

                                // Через 500мс начинаем анимацию прочтения (сокращено с 2000мс)
                                setTimeout(() => {
                                    // Повторная проверка перед отправкой (используем актуальные значения из ref'ов)
                                    const finalCurrentUserId = currentUserIdRef.current;
                                    const finalIsConnected = isConnectedRef.current;
                                    const finalIsChatActive = isChatActiveRef.current;
                                    const finalIsDataLoaded = isDataLoadedRef.current;

                                    // FALLBACK: проверяем wsIsConnected() если ref показывает false
                                    const actuallyConnected = finalIsConnected || wsIsConnected();

                                    console.log('💬 [NEW-MESSAGE] Final check before marking as read:', {
                                        finalIsConnected,
                                        wsIsConnectedResult: wsIsConnected(),
                                        actuallyConnected,
                                        finalCurrentUserId,
                                        finalIsChatActive,
                                        finalIsDataLoaded
                                    });

                                    if (actuallyConnected && finalCurrentUserId && finalIsChatActive && finalIsDataLoaded) {
                                        console.log('💬 [NEW-MESSAGE] ✅ Final check passed, calling markMessageAsRead...');
                                        markMessageAsRead(messageId, data.sender_id);
                                        // Запускаем анимацию прочтения
                                        animateMessageAsRead(messageId);
                                    } else {
                                        console.warn('💬 [NEW-MESSAGE] ⚠️ State changed, skipping read receipt:', {
                                            finalIsConnected,
                                            actuallyConnected,
                                            wsIsConnectedResult: wsIsConnected(),
                                            finalCurrentUserId,
                                            finalIsChatActive,
                                            finalIsDataLoaded
                                        });
                                    }
                                }, 500); // Сокращено до 500мс для более быстрой реакции
                            } else {
                                // Инициализация еще не завершена - добавляем в очередь
                                console.log('💬 [NEW-MESSAGE] ⚠️ Initialization not complete, adding to pending queue:', {
                                    messageId,
                                    senderId: data.sender_id,
                                    actualCurrentUserId,
                                    actualIsDataLoaded
                                });
                                pendingMessagesQueue.current.push({
                                    messageId: messageId,
                                    senderId: data.sender_id
                                });
                                console.log('💬 [NEW-MESSAGE] Pending queue size:', pendingMessagesQueue.current.length);
                            }
                        } else {
                            console.log('💬 [NEW-MESSAGE] ⚠️ Will NOT mark as read. Reasons:', {
                                isMyMessage,
                                missingMessageId: !messageId,
                                missingSenderId: !data.sender_id,
                                noCurrentUserId: !actualCurrentUserId,
                                dataNotLoaded: !actualIsDataLoaded
                            });
                        }

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

    // ЕДИНАЯ точка получения URL медиа через Redis API
    const getMediaServerUrl = async (messageId: number, retryCount: number = 0): Promise<string | null> => {
        try {
            const token = await getToken();
            if (!token) {
                console.log('📄 [API] ❌ No token available');
                return null;
            }

            console.log('📄 [API] Requesting media URL for message:', messageId);

            const response = await axios.get(
                `${API_CONFIG.BASE_URL}/media-api/message/${messageId}/url/`,
                {
                    headers: {
                        'Authorization': `Token ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            const url = response.data?.url || response.data?.file_url;
            if (url) {
                console.log()
            } else {
                console.log('📄 [API] ❌ No URL in response');
            }

            return url || null;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('📄 [API] ❌ Axios error:', {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    message: error.message
                });

                if (error.response?.status === 403 && retryCount === 0) {
                    console.log('📄 [API] Retrying after 403...');
                    return await getMediaServerUrl(messageId, 1);
                }
            } else {
                console.error('📄 [API] ❌ Unknown error:', error);
            }
            return null;
        }
    };

    // Убрали - теперь используется getMediaServerUrl для всех типов медиа

    // Ленивая загрузка заменяет необходимость в предзагрузке

    // Запрос разрешения на использование микрофона
    const requestAudioPermission = async (): Promise<boolean> => {
        try {
            console.log('🎤 [AUDIO-PERMISSION] Requesting audio recording permission...');

            const { status: existingStatus } = await Audio.getPermissionsAsync();
            console.log('🎤 [AUDIO-PERMISSION] Current status:', existingStatus);

            if (existingStatus === 'granted') {
                setAudioPermissionGranted(true);
                return true;
            }

            const { status } = await Audio.requestPermissionsAsync();
            console.log('🎤 [AUDIO-PERMISSION] Request result:', status);

            if (status === 'granted') {
                setAudioPermissionGranted(true);
                return true;
            }

            Alert.alert(
                'Разрешение требуется',
                'Для записи голосовых сообщений необходим доступ к микрофону. Пожалуйста, включите его в настройках.',
                [
                    { text: 'Отмена', style: 'cancel' },
                    {
                        text: 'Открыть настройки',
                        onPress: async () => {
                            if (Platform.OS === 'ios') {
                                await Linking.openURL('app-settings:');
                            } else {
                                await Linking.openSettings();
                            }
                        }
                    }
                ]
            );

            return false;
        } catch (error: any) {
            console.error('🎤 [AUDIO-PERMISSION] ❌ Error:', error);
            Alert.alert('Ошибка', 'Не удалось запросить разрешение на микрофон: ' + (error.message || 'Неизвестная ошибка'));
            return false;
        }
    };

    // Запрос разрешений для доступа к медиабиблиотеке
    const requestPermissions = async (): Promise<boolean> => {
        try {


            // Проверяем текущий статус разрешений
            const { status: currentStatus } = await ImagePicker.getMediaLibraryPermissionsAsync();
            console.log('📱 [PERMISSIONS] Current status:', currentStatus);

            if (currentStatus === 'granted') {

                return true;
            }

            // Запрашиваем разрешение
            const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            console.log('📱 [PERMISSIONS] Request result:', { status, canAskAgain });

            if (status === 'granted') {
                console.log('📱 [PERMISSIONS] ✅ Permission granted');
                return true;
            }

            // Разрешение не получено
            if (!canAskAgain) {
                Alert.alert(
                    'Разрешение требуется',
                    'Разрешение на доступ к медиабиблиотеке было отклонено. Пожалуйста, включите его в настройках приложения.',
                    [
                        { text: 'Отмена', style: 'cancel' },
                        {
                            text: 'Открыть настройки',
                            onPress: async () => {
                                if (Platform.OS === 'ios') {
                                    await Linking.openURL('app-settings:');
                                } else {
                                    await Linking.openSettings();
                                }
                            }
                        }
                    ]
                );
            } else {
                Alert.alert(
                    'Разрешение требуется',
                    'Для выбора медиафайлов необходимо разрешение доступа к медиабиблиотеке.',
                    [{ text: 'OK' }]
                );
            }

            return false;
        } catch (error: any) {
            console.error('📱 [PERMISSIONS] ❌ Error requesting permissions:', error);
            Alert.alert(
                'Ошибка',
                'Не удалось запросить разрешение: ' + (error.message || 'Неизвестная ошибка')
            );
            return false;
        }
    };

    // Сжатие медиа выполняется на сервере через Celery для оптимальной производительности

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


    // Суперэкспресс чанковая загрузка для больших файлов
    const uploadLargeFileChunkedOptimized = async (
        fileUri: string,
        mediaType: 'image' | 'video',
        messageId: number,
        onProgress?: (progress: number) => void
    ): Promise<string> => {
        try {
            console.log('🚀 [TURBO-UPLOAD] Starting turbo chunk upload...', {
                messageId,
                mediaType,
                fileUri: fileUri.substring(fileUri.lastIndexOf('/') + 1)
            });

            const token = await getToken();
            if (!token) {
                throw new Error('Нет токена авторизации');
            }

            const fileInfo = await FileSystem.getInfoAsync(fileUri);
            if (!fileInfo.exists) {
                throw new Error('Файл не найден');
            }

            const fileSize = fileInfo.size;
            const fileSizeMB = fileSize / (1024 * 1024);

            // ТУРБО РЕЖИМ: Максимальная скорость загрузки
            let chunkSize = 1 * 1024 * 1024; // 1MB базовый размер для скорости
            if (fileSizeMB > 20) chunkSize = 2 * 1024 * 1024; // 2MB для средних файлов
            if (fileSizeMB > 50) chunkSize = 5 * 1024 * 1024; // 5MB для больших файлов
            if (fileSizeMB > 100) chunkSize = 7 * 1024 * 1024; // 10MB для очень больших файлов

            const totalChunks = Math.ceil(fileSize / chunkSize);

            // МАКСИМАЛЬНЫЙ ПАРАЛЛЕЛИЗМ: До 6 одновременных загрузок
            const maxParallel = Math.min(3, totalChunks, Math.ceil(fileSizeMB / 15)); // До 6 параллельных загрузок

            console.log('🚀 [TURBO-UPLOAD] Turbo configuration:', {
                chunkSize: (chunkSize / (1024 * 1024)).toFixed(1) + 'MB',
                totalChunks,
                maxParallel: maxParallel,
                turboMode: true
            });

            if (onProgress) onProgress(5);

            const endpoint = `${API_CONFIG.BASE_URL}/media-api/upload/chunked/`;
            const uploadId = `turbo_${messageId}_${Date.now()}`;

            // ТУРБО функция загрузки чанка с минимальным таймаутом
            const uploadChunk = async (chunkIndex: number, start: number, end: number, retryCount = 0): Promise<void> => {
                try {
                    const actualLength = Math.min(chunkSize, end - start);
                    const chunkData = await FileSystem.readAsStringAsync(fileUri, {
                        encoding: FileSystem.EncodingType.Base64,
                        position: start,
                        length: actualLength
                    });

                    const formData = new FormData();
                    formData.append('upload_id', uploadId);
                    formData.append('chunk_index', chunkIndex.toString());
                    formData.append('total_chunks', totalChunks.toString());
                    formData.append('chunk_data', chunkData);
                    formData.append('file_name', `media_${messageId}.${mediaType === 'image' ? 'jpg' : 'mp4'}`);
                    formData.append('media_type', mediaType);

                    await axios.post(endpoint, formData, {
                        headers: {
                            'Authorization': `Token ${token}`,
                            'Content-Type': 'multipart/form-data',
                        },
                        timeout: 60000, // 60 секунд - больше для крупных чанков
                    });

                    console.log(`🚀 [TURBO-UPLOAD] ⚡ Chunk ${chunkIndex + 1}/${totalChunks} uploaded (${(actualLength / (1024 * 1024)).toFixed(1)}MB)`);
                } catch (error) {
                    if (retryCount < 1) { // Только одна повторная попытка в турбо режиме
                        console.log(`🚀 [TURBO-UPLOAD] ⚠️ Quick retry chunk ${chunkIndex + 1}`);
                        await new Promise(resolve => setTimeout(resolve, 500)); // Быстрая пауза
                        return uploadChunk(chunkIndex, start, end, retryCount + 1);
                    }
                    throw new Error(`Turbo chunk ${chunkIndex} failed: ${error.message}`);
                }
            };

            // ТУРБО загрузка: Максимальный параллелизм с батчами
            let uploadedChunks = 0;
            const batchSize = maxParallel;

            for (let i = 0; i < totalChunks; i += batchSize) {
                const chunkPromises = [];

                for (let j = 0; j < batchSize && (i + j) < totalChunks; j++) {
                    const chunkIndex = i + j;
                    const start = chunkIndex * chunkSize;
                    const end = Math.min(start + chunkSize, fileSize);

                    chunkPromises.push(uploadChunk(chunkIndex, start, end));
                }

                // Параллельная загрузка батча
                await Promise.all(chunkPromises);
                uploadedChunks += chunkPromises.length;

                // Исправляем расчет прогресса: 5% подготовка + 90% загрузка + 5% финализация
                const uploadProgress = Math.round((uploadedChunks / totalChunks) * 90);
                const totalProgress = Math.min(5 + uploadProgress, 95); // Максимум 95% до финализации
                if (onProgress) onProgress(totalProgress);

                console.log(`🚀 [TURBO-UPLOAD] ⚡ Batch completed: ${uploadedChunks}/${totalChunks} chunks`);
            }

            console.log('🚀 [TURBO-UPLOAD] ⚡ All chunks uploaded in turbo mode, finalizing...');
            if (onProgress) onProgress(95);

            // Финализация с коротким таймаутом
            const finalizeResponse = await axios.post(`${API_CONFIG.BASE_URL}/media-api/upload/finalize/`, {
                upload_id: uploadId,
                file_name: `media_${messageId}.${mediaType === 'image' ? 'jpg' : 'mp4'}`,
                media_type: mediaType,
                is_public: true,
                turbo_mode: true
            }, {
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json',
                },
                timeout: 30000 // 30 секунд для финализации
            });

            if (onProgress) onProgress(100);

            if (!finalizeResponse.data.success) {
                throw new Error(finalizeResponse.data.message || 'Турбо финализация не удалась');
            }

            console.log('🚀 [TURBO-UPLOAD] ⚡✅ Turbo upload completed successfully!');
            return finalizeResponse.data.file_url;

        } catch (error) {
            console.error('🚀 [TURBO-UPLOAD] ❌ Turbo chunk upload failed:', error);
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

    // Начало записи аудио
    const startAudioRecording = async () => {
        try {
            console.log('🎤 [RECORD] Starting audio recording...');

            // Проверяем разрешение
            const hasPermission = await requestAudioPermission();
            if (!hasPermission) {
                console.log('🎤 [RECORD] ❌ No audio permission');
                return;
            }

            // Настраиваем аудио режим для записи
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: false,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false
            });

            console.log('🎤 [RECORD] Creating new recording...');
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );

            setAudioRecording(recording);
            setIsRecordingAudio(true);
            setRecordingDuration(0);

            // Запускаем таймер
            recordingTimerRef.current = setInterval(() => {
                setRecordingDuration(prev => prev + 1);
            }, 1000);

            console.log('🎤 [RECORD] ✅ Recording started');

        } catch (error: any) {
            console.error('🎤 [RECORD] ❌ Failed to start recording:', error);
            Alert.alert('Ошибка', 'Не удалось начать запись: ' + (error.message || 'Неизвестная ошибка'));
        }
    };

    // Остановка и отправка аудио
    const stopAndSendAudio = async () => {
        try {
            if (!audioRecording) {
                console.log('🎤 [RECORD] No recording to stop');
                return;
            }

            console.log('🎤 [RECORD] Stopping recording...');

            // Останавливаем таймер
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
            }

            await audioRecording.stopAndUnloadAsync();
            const uri = audioRecording.getURI();

            console.log('🎤 [RECORD] Recording stopped, URI:', uri);

            if (uri) {
                // Получаем информацию о файле
                const fileInfo = await FileSystem.getInfoAsync(uri);
                console.log('🎤 [RECORD] File info:', {
                    size: fileInfo.exists ? fileInfo.size : 'unknown',
                    duration: recordingDuration
                });

                // Отправляем аудио
                await sendAudioMessage(uri, recordingDuration, fileInfo.exists ? fileInfo.size : undefined);
            } else {
                throw new Error('No recording URI available');
            }

            // Очищаем состояние
            setAudioRecording(null);
            setIsRecordingAudio(false);
            setRecordingDuration(0);

            // Восстанавливаем аудио режим
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
                staysActiveInBackground: false,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false
            });

        } catch (error: any) {
            console.error('🎤 [RECORD] ❌ Error stopping recording:', error);
            Alert.alert('Ошибка', 'Не удалось завершить запись');
            cancelAudioRecording();
        }
    };

    // Отмена записи аудио
    const cancelAudioRecording = async () => {
        try {
            console.log('🎤 [RECORD] Canceling recording...');

            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
            }

            if (audioRecording) {
                await audioRecording.stopAndUnloadAsync();
            }

            setAudioRecording(null);
            setIsRecordingAudio(false);
            setRecordingDuration(0);

            // Восстанавливаем аудио режим
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
                staysActiveInBackground: false,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false
            });

            console.log('🎤 [RECORD] ✅ Recording cancelled');

        } catch (error: any) {
            console.error('🎤 [RECORD] ❌ Error canceling recording:', error);
        }
    };

    // Отправка аудио сообщения
    const sendAudioMessage = async (audioUri: string, duration: number, fileSize?: number) => {
        if (!isConnected || !isDataLoaded || !recipient?.id || !currentUserId) {
            Alert.alert('Ошибка', 'Не удается отправить аудио');
            return;
        }

        try {
            console.log('🎤 [SEND] Sending audio message...');

            const timestamp = Math.floor(Date.now() / 1000);
            const messageId = Date.now();

            // Получаем информацию о файле
            const fileInfo = await FileSystem.getInfoAsync(audioUri);
            const actualFileSize = fileInfo.exists ? fileInfo.size : (fileSize || 0);
            const fileSizeMB = actualFileSize / (1024 * 1024);

            const mediaHash = `audio_${messageId}_${actualFileSize}_${timestamp}`;
            const mediaFileName = `audio_${messageId}.m4a`;

            console.log('🎤 [SEND] Audio details:', {
                duration: `${duration}s`,
                size: `${fileSizeMB.toFixed(2)}MB`,
                hash: mediaHash
            });

            // Создаем оптимистичное сообщение
            const optimisticMessage: Message = {
                id: messageId,
                message: `🎤 Голосовое сообщение (${duration}с)`,
                timestamp: timestamp,
                sender__username: currentUsername,
                sender_id: currentUserId,
                mediaType: 'audio',
                mediaUri: audioUri,
                mediaBase64: undefined,
                mediaHash: mediaHash,
                mediaFileName: mediaFileName,
                mediaSize: actualFileSize,
                mimeType: 'audio/m4a',
                isUploading: true,
                uploadProgress: 0
            };

            setMessages(prev => [optimisticMessage, ...prev]);

            // Прокручиваем к новому сообщению
            setTimeout(() => {
                if (flatListRef.current) {
                    flatListRef.current.scrollToIndex({ index: 0, animated: true });
                }
            }, 100);

            // Загружаем аудио на сервер
            const fileUrl = await uploadFileGeneric(
                audioUri,
                mediaFileName,
                'audio/m4a',
                messageId,
                (progress) => {
                    setMessages(prev =>
                        prev.map(msg => {
                            if (msg.id === messageId) {
                                return {
                                    ...msg,
                                    uploadProgress: progress,
                                    message: `🎤 Загрузка аудио... ${progress}%`
                                };
                            }
                            return msg;
                        })
                    );
                }
            );

            console.log('🎤 [SEND] ✅ Audio uploaded:', fileUrl);

            // Обновляем сообщение после успешной загрузки
            setMessages(prev =>
                prev.map(msg => {
                    if (msg.id === messageId) {
                        return {
                            ...msg,
                            isUploading: false,
                            uploadProgress: 100,
                            message: `🎤 Голосовое сообщение (${duration}с)`,
                            serverFileUrl: fileUrl
                        };
                    }
                    return msg;
                })
            );

            // Отправляем уведомление через WebSocket
            const messageData = {
                type: 'media_message',
                message: `🎤 Голосовое сообщение (${duration}с)`,
                mediaType: 'audio',
                mediaHash: mediaHash,
                fileUrl: fileUrl,
                fileName: mediaFileName,
                mimeType: 'audio/m4a',
                timestamp: timestamp,
                user1: currentUserId,
                user2: recipient.id,
                id: messageId
            };

            sendMessage(messageData);

        } catch (error) {
            console.error('🎤 [SEND] ❌ Error sending audio:', error);
            Alert.alert('Ошибка', 'Не удалось отправить аудио сообщение');
        }
    };

    // Воспроизведение аудио
    const playAudio = async (message: Message) => {
        try {
            const messageId = Number(message.id);
            console.log('🎤 [PLAY] Playing audio:', messageId);

            // Если уже воспроизводится - останавливаем
            if (playingAudioId === messageId) {
                const currentState = audioPlaybackStates[messageId];
                if (currentState?.sound) {
                    await currentState.sound.pauseAsync();
                    setPlayingAudioId(null);
                    setAudioPlaybackStates(prev => ({
                        ...prev,
                        [messageId]: { ...currentState, isPlaying: false }
                    }));
                }
                return;
            }

            // Останавливаем другое аудио если воспроизводится
            if (playingAudioId !== null) {
                const prevState = audioPlaybackStates[playingAudioId];
                if (prevState?.sound) {
                    await prevState.sound.stopAsync();
                    await prevState.sound.unloadAsync();
                }
            }

            // Получаем URI аудио
            let audioUri = message.mediaUri || message.serverFileUrl;
            if (!audioUri) {
                console.log('🎤 [PLAY] No audio URI, loading from server...');
                audioUri = await getMediaServerUrl(messageId);
                if (!audioUri) {
                    Alert.alert('Ошибка', 'Не удалось загрузить аудио');
                    return;
                }
            }

            console.log('🎤 [PLAY] Loading sound from:', audioUri.substring(0, 100));

            // Создаем и загружаем звук
            const { sound } = await Audio.Sound.createAsync(
                { uri: audioUri },
                { shouldPlay: true },
                (status) => {
                    if (status.isLoaded) {
                        setAudioPlaybackStates(prev => ({
                            ...prev,
                            [messageId]: {
                                ...prev[messageId],
                                isPlaying: status.isPlaying,
                                position: status.positionMillis,
                                duration: status.durationMillis || 0
                            }
                        }));

                        // Если закончилось воспроизведение
                        if (status.didJustFinish) {
                            setPlayingAudioId(null);
                            sound.unloadAsync();
                        }
                    }
                }
            );

            setPlayingAudioId(messageId);
            setAudioPlaybackStates(prev => ({
                ...prev,
                [messageId]: {
                    sound: sound,
                    isPlaying: true,
                    position: 0,
                    duration: 0
                }
            }));

            console.log('🎤 [PLAY] ✅ Audio playing');

        } catch (error) {
            console.error('🎤 [PLAY] ❌ Error playing audio:', error);
            Alert.alert('Ошибка', 'Не удалось воспроизвести аудио');
        }
    };

    // Выбор изображения
    const pickImage = async () => {

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
                quality: 0.7, // Уменьшаем качество для ускорения без значительной потери
                base64: true,
                exif: false, // Убираем EXIF данные для уменьшения размера
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

    // Диагностика видеофайла для проверки совместимости
    const diagnoseVideo = async (videoUri: string): Promise<{compatible: boolean, info: any}> => {
        try {
            console.log('🎥 [DIAGNOSE] Analyzing video compatibility:', videoUri.substring(videoUri.lastIndexOf('/') + 1));

            const fileInfo = await FileSystem.getInfoAsync(videoUri);
            if (!fileInfo.exists) {
                return { compatible: false, info: { error: 'File does not exist' } };
            }

            const fileSizeMB = fileInfo.size / (1024 * 1024);

            // Простая эвристика на основе размера и расширения
            const isLargeFile = fileSizeMB > 100;
            const hasCompatibleExtension = videoUri.toLowerCase().includes('.mp4') ||
                                         videoUri.toLowerCase().includes('.mov');

            const diagnostics = {
                fileSize: fileInfo.size,
                fileSizeMB: fileSizeMB,
                hasCompatibleExtension,
                isLargeFile,
                uri: videoUri,
                likelyCompatible: hasCompatibleExtension && !isLargeFile
            };

            console.log('🎥 [DIAGNOSE] Video diagnostics:', diagnostics);

            return {
                compatible: diagnostics.likelyCompatible,
                info: diagnostics
            };
        } catch (error) {
            console.error('🎥 [DIAGNOSE] Error diagnosing video:', error);
            return { compatible: false, info: { error: error.message } };
        }
    };

    // Выбор видео с диагностикой
    const pickVideo = async () => {

        try {
            // Проверяем разрешения с более подробной обработкой
            const hasPermission = await requestPermissions();
            if (!hasPermission) {
                console.log('🎥 [PICKER] ❌ No permission for media library');
                Alert.alert(
                    'Разрешение требуется',
                    'Для выбора видео необходимо разрешение доступа к медиабиблиотеке. Предоставьте разрешение в настройках приложения.',
                    [{ text: 'OK' }]
                );
                return;
            }



            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['videos'],
                allowsEditing: false,
                quality: 0.5, // Качество применяется к видео автоматически
                videoMaxDuration: 180,
                allowsMultipleSelection: false,
            });

            console.log('🎥 [PICKER] Picker result:', {
                canceled: result.canceled,
                hasAssets: !!result.assets
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
                    mimeType: asset.mimeType
                });

                // Диагностируем видео на совместимость
                const diagnosis = await diagnoseVideo(asset.uri);
                console.log('🎥 [PICKER] Video diagnosis result:', diagnosis);

                // Проверяем размер файла
                const maxVideoSize = 600 * 1024 * 1024; // 300MB
                if (asset.fileSize && asset.fileSize > maxVideoSize) {
                    Alert.alert(
                        'Файл слишком большой',
                        `Размер видео: ${Math.round(asset.fileSize / 1024 / 1024)}MB. Максимальный размер: 300MB.`
                    );
                    return;
                }

                // Проверяем длительность видео
                const maxDuration = 3000000; // 50 минут
                if (asset.duration && asset.duration > maxDuration) {
                    Alert.alert(
                        'Видео слишком длинное',
                        `Длительность: ${Math.round(asset.duration / 1000)}сек. Максимальная длительность: 10 минут.`
                    );
                    return;
                }



                try {
                    const fileSizeMB = asset.fileSize ? asset.fileSize / (1024 * 1024) : 0;

                    console.log('🚀 [PICKER] Processing video for direct upload:', {
                        sizeMB: fileSizeMB.toFixed(1),
                        compatible: diagnosis.compatible,
                        serverCompression: true
                    });

                    // Прямая загрузка без клиентского сжатия
                    // Сжатие выполняется на сервере через Celery для лучшей производительности
                    console.log('🚀 [PICKER] Direct upload - server will handle compression');
                    await sendMediaMessageDirect(asset.uri, 'video', asset.fileSize);

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
        } catch (error: any) {
            console.error('🎥 [PICKER] ❌ Error picking video:', error);

            // Детальная обработка ошибок для production
            let errorMessage = 'Не удалось выбрать видео';

            if (error.message) {
                console.error('🎥 [PICKER] Error message:', error.message);

                // Проверяем различные типы ошибок
                if (error.message.includes('permission') || error.message.includes('Permission')) {
                    errorMessage = 'Нет разрешения на доступ к медиабиблиотеке. Проверьте настройки приложения.';
                } else if (error.message.includes('cancelled') || error.message.includes('canceled')) {
                    console.log('🎥 [PICKER] User cancelled picker');
                    return; // Не показываем ошибку при отмене пользователем
                } else if (error.message.includes('not available')) {
                    errorMessage = 'Медиабиблиотека недоступна на этом устройстве.';
                } else {
                    errorMessage = `Ошибка: ${error.message}`;
                }
            }

            Alert.alert(
                'Ошибка выбора видео',
                errorMessage + '\n\nПопробуйте:\n• Перезапустить приложение\n• Проверить разрешения в настройках\n• Выбрать другое видео',
                [{ text: 'OK' }]
            );
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
                            message: fileName, // Только название файла без эмодзи
                            serverFileUrl: fileUrl
                        };
                    }
                    return msg;
                })
            );

            // Отправляем уведомление через WebSocket
            const messageData = {
                type: 'media_message',
                message: fileName, // Только название файла
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

        const timestamp = Math.floor(Date.now() / 1000);
        const messageId = Date.now();

        try {
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
                            message: fileName, // Только название файла
                            serverFileUrl: fileUrl
                        };
                    }
                    return msg;
                })
            );

            // Отправляем уведомление через WebSocket
            const messageData = {
                type: 'media_message',
                message: fileName, // Только название файла
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
                            // Исправляем расчет: 10% начальная подготовка + 85% загрузка + 5% финализация
                            const uploadProgress = Math.round((progressEvent.loaded / progressEvent.total) * 85);
                            const totalProgress = Math.min(1 + uploadProgress, 99); // Максимум 95% до финализации
                            if (onProgress) {
                                onProgress(totalProgress);
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

        const timestamp = Math.floor(Date.now() / 1000);
        const messageId = Date.now();

        try {
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
                message: mediaType === 'image' ? 'Загрузка изображения...' : 'Загрузка видео...',
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
                    serverFileUrl = await uploadLargeFileChunkedOptimized(
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
                                message: `${mediaType === 'image' ? 'изображения' : 'видео'}`, // Убираем подпись
                                serverFileUrl: serverFileUrl
                            };
                        }
                        return msg;
                    })
                );

                // Отправляем уведомление через WebSocket
                const messageData = {
                    type: 'media_message',
                    message: '', // Убираем подпись
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
                message: mediaType === 'image' ? 'Загрузка изображения...' : 'Загрузка видео...',
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
                message: '', // Пустое сообщение - медиа говорит само за себя
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
        // Защита от параллельных загрузок
        if (isInitialLoading || isLoadingMore) {
            console.log('📜 [HISTORY] ⚠️ Already loading, skipping request');
            return;
        }

        try {
            const token = await getToken();
            if (!token) return;

            console.log('📜 [HISTORY] Loading chat history...', { pageNum, limit, roomId });

            // Устанавливаем флаг загрузки
            if (pageNum === 1) {
                setIsInitialLoading(true);
            }

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

            if (response.data?.messages) {
                const processedMessages = response.data.messages.map((msg: any) => ({
                    ...msg,
                    mediaType: msg.mediaType || msg.media_type || null,
                    mediaHash: msg.mediaHash || msg.media_hash || null,
                    mediaFileName: msg.mediaFileName || msg.media_filename || null,
                    mediaSize: msg.mediaSize || msg.media_size || null,
                    mediaBase64: null,
                    // Redis кэширует URL - загрузится через API при просмотре
                    serverFileUrl: null,
                    isLoadingServerUrl: false,
                    needsReload: false
                }));

                if (pageNum === 1) {
                    // Первая загрузка - НЕ заменяем все сообщения, а мержим с существующими
                    setMessages(prev => {
                        // Не реверсируем - сообщения уже отсортированы от новых к старым
                        const historyMessages = processedMessages;

                        // Сохраняем существующие сообщения, которых нет в истории
                        const existingNewMessages = prev.filter(existingMsg => {
                            return !historyMessages.some(historyMsg => historyMsg.id === existingMsg.id);
                        });

                        // Объединяем новые сообщения с историей - новые сначала
                        const mergedMessages = [...existingNewMessages, ...historyMessages];
                        return mergedMessages;
                    });
                    setPage(1);

                    console.log('📜 [HISTORY] Loaded', processedMessages.length, 'messages from history');

                    // Отметка как прочитанных теперь выполняется через отдельный useEffect
                    // после полной инициализации чата (см. useEffect ниже)

                    // Ленивая загрузка: URL загружаются только при прокрутке к медиа
                    console.log('📜 [HISTORY] Media will be loaded lazily when visible');

                    // Подсчитываем медиа для статистики
                    const imageCount = processedMessages.filter(msg => msg.mediaType === 'image').length;
                    const videoCount = processedMessages.filter(msg => msg.mediaType === 'video').length;

                    if (imageCount > 0 || videoCount > 0) {
                        console.log('📜 [HISTORY] Media summary:', {
                            images: imageCount,
                            videos: videoCount,
                            lazyLoad: true
                        });
                    }
                } else {
                    // Загрузка дополнительных сообщений - добавляем в конец (старые сообщения)
                    setMessages(prev => [...prev, ...processedMessages]);
                }

                // Проверяем, есть ли еще сообщения
                // hasMore = true только если получили ровно столько, сколько запрашивали
                const hasMoreMessages = processedMessages.length === limit;
                setHasMore(hasMoreMessages);

                console.log('📜 [HISTORY] Load complete:', {
                    received: processedMessages.length,
                    limit: limit,
                    hasMore: hasMoreMessages,
                    currentPage: pageNum
                });

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
            console.error('📜 [HISTORY] ❌ Error loading chat history:', error);
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                Alert.alert('Ошибка', 'Сессия истекла. Войдите снова.');
                router.replace('/(auth)/login');
            }
        } finally {
            // КРИТИЧНО: Всегда сбрасываем флаги загрузки
            if (pageNum === 1) {
                setIsInitialLoading(false);
            }
        }
    };

    // Загрузка дополнительных сообщений
    const loadMoreMessages = async () => {
        console.log('📜 [LOAD-MORE] Checking conditions:', {
            hasMore,
            isLoadingMore,
            isInitialLoading,
            currentPage: page
        });

        // КРИТИЧНО: Проверяем все условия
        if (!hasMore || isLoadingMore || isInitialLoading) {
            console.log('📜 [LOAD-MORE] ⚠️ Skipping load - conditions not met');
            return;
        }

        console.log('📜 [LOAD-MORE] Starting to load page', page + 1);
        setIsLoadingMore(true);
        const nextPage = page + 1;

        try {
            await fetchChatHistory(nextPage, 15);
            setPage(nextPage);
            console.log('📜 [LOAD-MORE] ✅ Successfully loaded page', nextPage);
        } catch (error) {
            console.error('📜 [LOAD-MORE] ❌ Error loading more messages:', error);
        } finally {
            setIsLoadingMore(false);
        }
    };

    // Настройка аудио сессии при загрузке компонента
    useEffect(() => {
        const setupAudioSession = async () => {
            // Настраиваем аудио только если приложение активно
            if (appState !== 'active') {
                console.log('🎥 [AUDIO] Skipping audio setup - app not active:', appState);
                setAudioSessionReady(false);
                return;
            }

            try {
                console.log('🎥 [AUDIO] Setting up audio session...');
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    staysActiveInBackground: false,
                    playsInSilentModeIOS: true,
                    shouldDuckAndroid: true,
                    playThroughEarpieceAndroid: false
                });
                setAudioSessionReady(true);
                console.log('🎥 [AUDIO] ✅ Audio session configured successfully');
            } catch (audioError) {
                console.warn('🎥 [AUDIO] ❌ Failed to configure audio session:', audioError);
                setAudioSessionReady(false);
            }
        };

        setupAudioSession();
    }, [appState]);

    // Инициализация чата
    // Синхронизация ref'ов с состояниями для использования в WebSocket колбэках
    useEffect(() => {
        currentUserIdRef.current = currentUserId;
        console.log('🔄 [REF-SYNC] Updated currentUserIdRef:', currentUserId);
    }, [currentUserId]);

    useEffect(() => {
        isDataLoadedRef.current = isDataLoaded;
        console.log('🔄 [REF-SYNC] Updated isDataLoadedRef:', isDataLoaded);
    }, [isDataLoaded]);

    useEffect(() => {
        isConnectedRef.current = isConnected;
        console.log('🔄 [REF-SYNC] Updated isConnectedRef:', isConnected);
    }, [isConnected]);

    useEffect(() => {
        isChatActiveRef.current = isChatActive;
        console.log('🔄 [REF-SYNC] Updated isChatActiveRef:', isChatActive);
    }, [isChatActive]);

    // Отслеживание активности чата
    useEffect(() => {
        // Устанавливаем чат как активный при монтировании
        setIsChatActive(true);
        console.log('📖 [CHAT-ACTIVE] ========== CHAT MOUNTED ==========');
        console.log('📖 [CHAT-ACTIVE] Room ID:', roomId);
        console.log('📖 [CHAT-ACTIVE] Current User ID:', currentUserId);
        console.log('📖 [CHAT-ACTIVE] Is Connected:', isConnected);
        console.log('📖 [CHAT-ACTIVE] Chat is now ACTIVE');

        // При размонтировании помечаем чат как неактивный
        return () => {
            setIsChatActive(false);
            // Очищаем кеш прочитанных сообщений
            markedAsReadCache.current.clear();
            console.log('📖 [CHAT-ACTIVE] ========== CHAT UNMOUNTED ==========');
            console.log('📖 [CHAT-ACTIVE] Chat is now INACTIVE');
            console.log('📖 [CHAT-ACTIVE] Cleared read receipt cache');
        };
    }, [roomId, currentUserId, isConnected]);

    // Отдельный useEffect для массовой отметки сообщений из истории
    // Срабатывает ОДИН РАЗ после полной инициализации
    useEffect(() => {
        // Проверяем что все данные загружены и подключение установлено
        if (!isDataLoaded || !isConnected || !currentUserId || !isChatActive) {
            return;
        }

        // Флаг чтобы выполнить только один раз
        let hasMarkedHistory = false;

        const markHistoryAsRead = () => {
            if (hasMarkedHistory) return;
            hasMarkedHistory = true;

            console.log('📜 [AUTO-MARK] ========== AUTO-MARKING HISTORY AS READ ==========');
            console.log('📜 [AUTO-MARK] Messages count:', messages.length);

            // Фильтруем только чужие сообщения
            const otherUserMessages = messages
                .filter(msg => msg.sender_id && msg.sender_id !== currentUserId)
                .map(msg => msg.id);

            if (otherUserMessages.length > 0) {
                console.log('📜 [AUTO-MARK] Found', otherUserMessages.length, 'messages from other user');

                // Добавляем все в кеш
                otherUserMessages.forEach(id => markedAsReadCache.current.add(id));

                // Отправляем массовое подтверждение
                try {
                    const bulkReadData = {
                        type: 'mark_multiple_as_read',
                        message_ids: otherUserMessages,
                        room_id: roomId,
                        user_id: currentUserId
                    };

                    sendMessage(bulkReadData);
                    console.log('📜 [AUTO-MARK] ✅ Sent bulk read receipt for', otherUserMessages.length, 'messages');
                } catch (error) {
                    console.error('📜 [AUTO-MARK] ❌ Error sending bulk read receipt:', error);
                    // Убираем из кеша при ошибке
                    otherUserMessages.forEach(id => markedAsReadCache.current.delete(id));
                }
            } else {
                console.log('📜 [AUTO-MARK] No messages from other user to mark');
            }
        };

        // Даем небольшую задержку чтобы все состояния обновились
        const timeoutId = setTimeout(markHistoryAsRead, 1000);

        return () => {
            clearTimeout(timeoutId);
        };
    }, [isDataLoaded, isConnected, currentUserId, isChatActive]); // Срабатывает только при изменении этих флагов

    // useEffect для обработки отложенных сообщений после инициализации
    useEffect(() => {
        // Проверяем что инициализация завершена и есть сообщения в очереди
        if (!isDataLoaded || !isConnected || !currentUserId || !isChatActive) {
            return;
        }

        if (pendingMessagesQueue.current.length === 0) {
            return;
        }

        console.log('📨 [PENDING-QUEUE] ========== PROCESSING PENDING MESSAGES ==========');
        console.log('📨 [PENDING-QUEUE] Queue size:', pendingMessagesQueue.current.length);
        console.log('📨 [PENDING-QUEUE] Current state:', {
            currentUserId,
            isConnected,
            isDataLoaded,
            isChatActive
        });

        // Обрабатываем все отложенные сообщения
        const pendingMessages = [...pendingMessagesQueue.current];
        pendingMessagesQueue.current = []; // Очищаем очередь

        pendingMessages.forEach(({ messageId, senderId }) => {
            console.log('📨 [PENDING-QUEUE] Processing pending message:', messageId);

            // Проверяем что это не мое сообщение
            if (senderId !== currentUserId) {
                // Добавляем в список непрочитанных для визуальной индикации
                setUnreadMessages(prev => {
                    const newSet = new Set(prev);
                    newSet.add(messageId);
                    console.log('📨 [PENDING-QUEUE] ✅ Added to unread messages:', messageId);
                    return newSet;
                });

                // Создаем анимацию для этого сообщения
                if (!unreadAnimations.current[messageId]) {
                    const AnimatedNative = require('react-native').Animated;
                    unreadAnimations.current[messageId] = new AnimatedNative.Value(1);
                    console.log('📨 [PENDING-QUEUE] ✅ Created animation for message:', messageId);
                }

                // Через 2 секунды начинаем анимацию прочтения
                setTimeout(() => {
                    if (isConnected && currentUserId && isChatActive && isDataLoaded) {
                        console.log('📨 [PENDING-QUEUE] ✅ Marking pending message as read:', messageId);
                        markMessageAsRead(messageId, senderId);
                        animateMessageAsRead(messageId);
                    }
                }, 2000);
            } else {
                console.log('📨 [PENDING-QUEUE] ⚠️ Skipping own message:', messageId);
            }
        });

        console.log('📨 [PENDING-QUEUE] ✅ Processed', pendingMessages.length, 'pending messages');
    }, [isDataLoaded, isConnected, currentUserId, isChatActive, markMessageAsRead, animateMessageAsRead]);

    // Отслеживание состояния приложения
    useEffect(() => {
        const subscription = AppState.addEventListener('change', async nextAppState => {
            console.log('🎥 [APP-STATE] App state changed:', appState, '->', nextAppState);
            setAppState(nextAppState);

            // Обновляем состояние активности чата в зависимости от состояния приложения
            if (nextAppState === 'active') {
                setIsChatActive(true);
                console.log('📖 [CHAT-ACTIVE] Chat became active');
            } else {
                setIsChatActive(false);
                console.log('📖 [CHAT-ACTIVE] Chat became inactive');
            }

            // Переконфигурируем аудио при возвращении в активное состояние
            if (nextAppState === 'active' && appState !== 'active') {
                console.log('🎥 [APP-STATE] App became active - reconfiguring audio...');
                try {
                    await Audio.setAudioModeAsync({
                        allowsRecordingIOS: false,
                        staysActiveInBackground: false,
                        playsInSilentModeIOS: true,
                        shouldDuckAndroid: true,
                        playThroughEarpieceAndroid: false
                    });
                    setAudioSessionReady(true);
                    console.log('🎥 [APP-STATE] ✅ Audio reconfigured successfully');
                } catch (audioError) {
                    console.warn('🎥 [APP-STATE] ❌ Failed to reconfigure audio:', audioError);
                    setAudioSessionReady(false);
                }
            } else if (nextAppState !== 'active') {
                // Отключаем аудио сессию в фоновом режиме
                setAudioSessionReady(false);
                console.log('🎥 [APP-STATE] App went to background - disabled audio session');
            }
        });

        return () => {
            subscription?.remove();
        };
    }, [appState]);

    useEffect(() => {
        if (!roomId) {
            router.back();
            return;
        }

        const initializeChat = async () => {
            console.log('📜 [INIT] ========== INITIALIZING CHAT ==========');
            console.log('📜 [INIT] Room ID:', roomId);

            setIsLoading(true);
            try {
                // ШАГ 1: Сначала получаем данные текущего пользователя
                const currentUser = await fetchCurrentUser();
                console.log('📜 [INIT] Current user loaded:', currentUser?.id);

                if (!currentUser) {
                    throw new Error('Failed to load current user');
                }

                // ШАГ 2: Получаем информацию о собеседнике
                const recipientInfo = await fetchRecipientInfo();
                console.log('📜 [INIT] Recipient loaded:', recipientInfo?.id);

                if (!recipientInfo) {
                    throw new Error('Failed to load recipient');
                }

                console.log('📜 [INIT] ✅ User data loaded successfully:', {
                    currentUserId: currentUser.id,
                    currentUsername: currentUser.username,
                    recipientId: recipientInfo.id,
                    recipientUsername: recipientInfo.username
                });

                // ШАГ 3: Загружаем историю чата
                await fetchChatHistory(1, 15);
                console.log('📜 [INIT] ✅ Chat history loaded');

                // ШАГ 4: Помечаем данные как загруженные
                setIsDataLoaded(true);
                console.log('📜 [INIT] ✅ Data marked as loaded');

                // ШАГ 5: КРИТИЧНО - Подключаемся к WebSocket только после полной инициализации
                // Увеличиваем задержку чтобы React гарантированно обновил все состояния
                setTimeout(() => {
                    console.log('📜 [INIT] Connecting to WebSocket with initialized data:', {
                        currentUserId: currentUser.id,
                        recipientId: recipientInfo.id,
                        isDataLoaded: true
                    });

                    // Дополнительная проверка перед подключением
                    if (currentUser.id && recipientInfo.id) {
                        connect();
                        console.log('📜 [INIT] ✅ WebSocket connection initiated');
                    } else {
                        console.error('📜 [INIT] ❌ Cannot connect - user data not ready');
                    }
                }, 500);

                console.log('📜 [INIT] ✅ Chat initialized successfully');

            } catch (error) {
                console.error('📜 [INIT] ❌ Initialization error:', error);
                Alert.alert('Ошибка', 'Не удалось загрузить чат');
            } finally {
                setIsLoading(false);
            }
        };

        // КРИТИЧНО: Вызываем инициализацию только один раз при монтировании
        initializeChat();

        return () => {
            console.log('📜 [INIT] ========== CLEANING UP CHAT ==========');
            disconnect();
        };
    }, [roomId]); // ВАЖНО: Только roomId в зависимостях

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


    // Открытие просмотрщика изображений
    const openImageViewer = (imageUri: string) => {
        setSelectedImage(imageUri);
        resetZoom();
        setIsImageViewerVisible(true);

        console.log('🖼️ [IMAGE-VIEWER] Opening image viewer');
    };

    // Функция для сброса масштабирования
    const resetZoom = useCallback(() => {
        scale.value = withSpring(1);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        lastScale.value = 1;
        lastTranslateX.value = 0;
        lastTranslateY.value = 0;
        setZoomLevel(0);
    }, [scale, translateX, translateY, lastScale, lastTranslateX, lastTranslateY]);

    // Функция для установки конкретного уровня масштабирования
    const setZoom = useCallback((level: number) => {
        let targetScale = 1;
        switch (level) {
            case 1:
                targetScale = 1.5;
                break;
            case 2:
                targetScale = 2.5;
                break;
            default:
                targetScale = 1;
        }

        scale.value = withSpring(targetScale);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        lastScale.value = targetScale;
        lastTranslateX.value = 0;
        lastTranslateY.value = 0;
        setZoomLevel(level);

        console.log('🖼️ [IMAGE-ZOOM] Zoom level changed:', {
            level,
            targetScale,
            cycle: level === 0 ? '1x' : level === 1 ? '1.5x' : '2.5x'
        });
    }, [scale, translateX, translateY, lastScale, lastTranslateX, lastTranslateY]);

    // Функция для изменения уровня масштабирования при двойном тапе
    const handleDoubleTap = useCallback(() => {
        const nextLevel = (zoomLevel + 1) % 3;
        setZoom(nextLevel);
    }, [zoomLevel, setZoom]);

    // Обработчик двойного нажатия
    const doubleTapGesture = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
            runOnJS(handleDoubleTap)();
        });

    // Обработчик жестов масштабирования (pinch)
    const pinchGesture = Gesture.Pinch()
        .onUpdate((event) => {
            scale.value = Math.max(0.5, Math.min(event.scale * lastScale.value, 5));
        })
        .onEnd(() => {
            lastScale.value = scale.value;
            // Обновляем уровень масштабирования на основе текущего масштаба
            if (scale.value <= 1.2) {
                runOnJS(setZoomLevel)(0);
            } else if (scale.value <= 2) {
                runOnJS(setZoomLevel)(1);
            } else {
                runOnJS(setZoomLevel)(2);
            }
        });

    // Обработчик жестов перетаскивания
    const panGesture = Gesture.Pan()
        .onUpdate((event) => {
            if (scale.value > 1) {
                translateX.value = event.translationX + lastTranslateX.value;
                translateY.value = event.translationY + lastTranslateY.value;
            }
        })
        .onEnd(() => {
            lastTranslateX.value = translateX.value;
            lastTranslateY.value = translateY.value;
        });

    // Комбинированный жест
    const combinedGesture = Gesture.Race(
        doubleTapGesture,
        Gesture.Simultaneous(pinchGesture, panGesture)
    );

    // Анимированный стиль для изображения
    const animatedImageStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {scale: scale.value},
                {translateX: translateX.value},
                {translateY: translateY.value},
            ],
        };
    });

    // Закрытие просмотрщика изображений с сбросом масштаба
    const closeImageViewer = () => {
        resetZoom();
        setSelectedImage(null);
        setIsImageViewerVisible(false);
        setLastImageTap(0);

        console.log('🖼️ [IMAGE-VIEWER] Closing image viewer');
    };

    // Функция для получения пути к кешированному видео
    const getCachedVideoPath = (messageId: number): string => {
        return `${FileSystem.documentDirectory}cached_video_${messageId}.mp4`;
    };

    // Функция для проверки существования видео в кеше
    const checkVideoCacheExists = async (messageId: number): Promise<boolean> => {
        try {
            const cachedPath = getCachedVideoPath(messageId);
            const fileInfo = await FileSystem.getInfoAsync(cachedPath);

            if (fileInfo.exists) {
                console.log('📹 [VIDEO-CACHE] ✅ Cache file exists:', {
                    messageId,
                    size: fileInfo.size,
                    path: cachedPath.substring(cachedPath.lastIndexOf('/') + 1)
                });
                return true;
            } else {
                console.log('📹 [VIDEO-CACHE] ⚠️ Cache file does not exist:', messageId);
                return false;
            }
        } catch (error) {
            console.error('📹 [VIDEO-CACHE] ❌ Error checking cache:', error);
            return false;
        }
    };

    // Функция для кеширования видео на устройстве
    const cacheVideoToDevice = async (videoUri: string, messageId: number): Promise<string | null> => {
        try {
            console.log('📹 [VIDEO-CACHE] Starting video caching:', {
                messageId,
                sourceUri: videoUri.substring(0, 100)
            });

            const cachedPath = getCachedVideoPath(messageId);

            // Проверяем, не закеширован ли уже файл
            const exists = await checkVideoCacheExists(messageId);
            if (exists) {
                console.log('📹 [VIDEO-CACHE] ✅ Video already cached');
                return cachedPath;
            }

            // Загружаем видео с сервера и сохраняем локально
            if (videoUri.startsWith('http')) {
                console.log('📹 [VIDEO-CACHE] Downloading video from server...');

                const downloadResult = await FileSystem.downloadAsync(
                    videoUri,
                    cachedPath,
                    {
                        sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
                    }
                );

                if (downloadResult.status === 200) {
                    console.log('📹 [VIDEO-CACHE] ✅ Video cached successfully:', cachedPath);
                    return cachedPath;
                } else {
                    throw new Error(`Download failed with status ${downloadResult.status}`);
                }
            } else if (videoUri.startsWith('file://')) {
                // Копируем локальный файл в кеш
                console.log('📹 [VIDEO-CACHE] Copying local video to cache...');
                await FileSystem.copyAsync({
                    from: videoUri,
                    to: cachedPath
                });
                console.log('📹 [VIDEO-CACHE] ✅ Video copied to cache');
                return cachedPath;
            } else {
                console.warn('📹 [VIDEO-CACHE] ⚠️ Unsupported video URI format');
                return null;
            }
        } catch (error) {
            console.error('📹 [VIDEO-CACHE] ❌ Error caching video:', error);
            return null;
        }
    };

    // Функция для получения видео URI с проверкой кеша
    const getVideoUriWithCache = async (message: Message): Promise<string | null> => {
        try {
            const messageId = Number(message.id);

            // Сначала проверяем кеш
            const cacheExists = await checkVideoCacheExists(messageId);
            if (cacheExists) {
                const cachedPath = getCachedVideoPath(messageId);
                console.log('📹 [VIDEO-CACHE] ✅ Using cached video:', messageId);

                // ВАЖНО: Обновляем сообщение чтобы не показывалась ошибка
                updateMessageSafely(messageId, {
                    mediaUri: cachedPath,
                    videoLoadRequested: true,
                    videoIsLoading: false,
                    needsReload: false
                });

                return cachedPath;
            }

            // Если в кеше нет, получаем URI с сервера
            console.log('📹 [VIDEO-CACHE] Video not in cache, fetching from server:', messageId);
            const serverUrl = message.serverFileUrl || await getMediaServerUrl(messageId);

            if (!serverUrl) {
                console.error('📹 [VIDEO-CACHE] ❌ No server URL available');
                return null;
            }

            // Кешируем видео при первом воспроизведении
            const cachedPath = await cacheVideoToDevice(serverUrl, messageId);
            return cachedPath || serverUrl; // Возвращаем кешированный путь или серверный URL
        } catch (error) {
            console.error('📹 [VIDEO-CACHE] ❌ Error getting video URI:', error);
            return null;
        }
    };

    // Загрузка и открытие документа
    const downloadAndOpenDocument = async (message: Message) => {
        console.log('📄 [DOC-DOWNLOAD] ========== OPENING DOCUMENT ==========');
        console.log('📄 [DOC-DOWNLOAD] Message data:', {
            id: message.id,
            fileName: message.mediaFileName,
            fileSize: message.mediaSize,
            mediaType: message.mediaType,
            hasServerUrl: !!message.serverFileUrl,
            hasMediaUri: !!message.mediaUri,
            serverUrl: message.serverFileUrl?.substring(0, 100),
            mediaUri: message.mediaUri?.substring(0, 100)
        });

        if (!message.serverFileUrl && !message.mediaUri) {
            console.log('📄 [DOC-DOWNLOAD] ❌ No URL available, requesting from API...');

            // Попытка загрузить URL через API если его нет
            const serverUrl = await getMediaServerUrl(message.id);
            if (serverUrl) {
                console.log('📄 [DOC-DOWNLOAD] ✅ Got URL from API, updating message...');
                updateMessageSafely(message.id, { serverFileUrl: serverUrl, mediaUri: serverUrl });
                // Рекурсивно вызываем функцию с обновленным сообщением
                setTimeout(() => {
                    const updatedMessage = messages.find(m => m.id === message.id);
                    if (updatedMessage) {
                        downloadAndOpenDocument(updatedMessage);
                    }
                }, 100);
                return;
            } else {
                console.log('📄 [DOC-DOWNLOAD] ❌ Failed to get URL from API');
                Alert.alert('Ошибка', 'Файл недоступен для загрузки. Не удалось получить URL с сервера.');
                return;
            }
        }

        const messageId = message.id;
        const fileName = message.mediaFileName || `document_${messageId}`;

        try {
            // Проверяем, не загружается ли уже документ
            if (downloadingDocuments[messageId]) {
                console.log('📄 [DOC-DOWNLOAD] Document already downloading:', messageId);
                return;
            }

            // Помечаем как загружающийся
            setDownloadingDocuments(prev => ({ ...prev, [messageId]: true }));
            setDocumentDownloadProgress(prev => ({ ...prev, [messageId]: 0 }));

            console.log('📄 [DOC-DOWNLOAD] Starting document download:', {
                messageId,
                fileName,
                hasServerUrl: !!message.serverFileUrl,
                hasLocalUri: !!message.mediaUri
            });

            let sourceUri = message.mediaUri || message.serverFileUrl;
            let localFilePath = '';

            if (sourceUri?.startsWith('http')) {
                // Загружаем с сервера
                const fileExtension = fileName.split('.').pop() || 'bin';
                const localFileName = `${fileName}_${messageId}.${fileExtension}`;
                localFilePath = `${FileSystem.documentDirectory}${localFileName}`;

                // Проверяем, не загружен ли уже файл
                const fileInfo = await FileSystem.getInfoAsync(localFilePath);
                if (fileInfo.exists) {
                    console.log('📄 [DOC-DOWNLOAD] File already exists locally, opening...');
                    await openDocument(localFilePath, fileName);
                    setDownloadingDocuments(prev => ({ ...prev, [messageId]: false }));
                    return;
                }

                console.log('📄 [DOC-DOWNLOAD] Downloading from server...');

                const downloadResult = await FileSystem.downloadAsync(
                    sourceUri,
                    localFilePath,
                    {
                        sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
                    }
                );

                if (downloadResult.status === 200) {
                    console.log('📄 [DOC-DOWNLOAD] ✅ Downloaded successfully');
                    localFilePath = downloadResult.uri;
                } else {
                    throw new Error(`Download failed with status ${downloadResult.status}`);
                }
            } else if (sourceUri?.startsWith('file://')) {
                // Локальный файл
                localFilePath = sourceUri;
            } else {
                throw new Error('Invalid file source');
            }

            // Открываем документ
            await openDocument(localFilePath, fileName);

        } catch (error) {
            console.error('📄 [DOC-DOWNLOAD] ❌ Error downloading document:', error);
            Alert.alert(
                'Ошибка загрузки',
                `Не удалось загрузить документ "${fileName}".\n\nОшибка: ${error.message}`,
                [
                    { text: 'OK', style: 'default' },
                    {
                        text: 'Попробовать в браузере',
                        style: 'default',
                        onPress: () => {
                            if (message.serverFileUrl?.startsWith('http')) {
                                WebBrowser.openBrowserAsync(message.serverFileUrl);
                            }
                        }
                    }
                ]
            );
        } finally {
            setDownloadingDocuments(prev => ({ ...prev, [messageId]: false }));
            setDocumentDownloadProgress(prev => ({ ...prev, [messageId]: 0 }));
        }
    };

    // Функция для запроса загрузки видео с автоматическим кешированием
    const requestVideoLoad = async (message: Message) => {
        console.log('🎥 [REQUEST-LOAD] Requesting video load with caching:', message.id);

        updateMessageSafely(message.id, {
            videoLoadRequested: true,
            videoIsLoading: true
        });

        try {
            // Используем функцию с автоматическим кешированием
            const cachedUri = await getVideoUriWithCache(message);

            if (cachedUri) {
                updateMessageSafely(message.id, {
                    mediaUri: cachedUri,
                    videoIsLoading: false
                });
                console.log('🎥 [REQUEST-LOAD] ✅ Video loaded and cached');
            } else {
                throw new Error('Failed to load video');
            }
        } catch (error) {
            console.error('🎥 [REQUEST-LOAD] ❌ Error loading video:', error);
            updateMessageSafely(message.id, {
                videoIsLoading: false,
                needsReload: true
            });
        }
    };

    // Скачивание видео
    const downloadVideo = async (videoUri: string, messageId: number) => {
        console.log('📥 [VIDEO-DOWNLOAD] Starting video download:', {
            messageId,
            videoUri: videoUri?.substring(videoUri.lastIndexOf('/') + 1)
        });

        if (!videoUri) {
            Alert.alert('Ошибка', 'Видео недоступно для скачивания');
            return;
        }

        try {
            // Для HTTP URL - скачиваем с сервера
            if (videoUri.startsWith('http')) {
                const fileName = `video_${messageId}_${Date.now()}.mp4`;
                const localFilePath = `${FileSystem.documentDirectory}${fileName}`;

                Alert.alert(
                    'Скачивание видео',
                    'Начинаем загрузку видео...',
                    [{ text: 'OK' }]
                );

                const downloadResult = await FileSystem.downloadAsync(
                    videoUri,
                    localFilePath
                );

                if (downloadResult.status === 200) {
                    console.log('📥 [VIDEO-DOWNLOAD] ✅ Downloaded successfully');

                    // Сохраняем в галерею
                    if (await Sharing.isAvailableAsync()) {
                        await Sharing.shareAsync(downloadResult.uri, {
                            mimeType: 'video/mp4',
                            dialogTitle: 'Сохранить видео',
                            UTI: 'public.movie'
                        });
                        Alert.alert('Успешно', 'Видео скачано');
                    } else {
                        Alert.alert('Успешно', `Видео сохранено: ${localFilePath}`);
                    }
                } else {
                    throw new Error(`Download failed with status ${downloadResult.status}`);
                }
            } else if (videoUri.startsWith('file://')) {
                // Для локальных файлов - просто делимся
                if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(videoUri, {
                        mimeType: 'video/mp4',
                        dialogTitle: 'Сохранить видео',
                        UTI: 'public.movie'
                    });
                } else {
                    Alert.alert('Ошибка', 'Функция сохранения недоступна');
                }
            } else {
                Alert.alert('Ошибка', 'Неподдерживаемый формат видео для скачивания');
            }
        } catch (error) {
            console.error('📥 [VIDEO-DOWNLOAD] ❌ Error:', error);
            Alert.alert('Ошибка', 'Не удалось скачать видео');
        }
    };

    // Скачивание изображения
    const downloadImage = async (imageUri: string, messageId: number) => {
        console.log('📥 [IMAGE-DOWNLOAD] Starting image download:', {
            messageId,
            imageUri: imageUri?.substring(imageUri.lastIndexOf('/') + 1)
        });

        if (!imageUri) {
            Alert.alert('Ошибка', 'Изображение недоступно для скачивания');
            return;
        }

        try {
            // Для HTTP URL - скачиваем с сервера
            if (imageUri.startsWith('http')) {
                const fileName = `image_${messageId}_${Date.now()}.jpg`;
                const localFilePath = `${FileSystem.documentDirectory}${fileName}`;

                Alert.alert(
                    'Скачивание изображения',
                    'Начинаем загрузку...',
                    [{ text: 'OK' }]
                );

                const downloadResult = await FileSystem.downloadAsync(
                    imageUri,
                    localFilePath
                );

                if (downloadResult.status === 200) {
                    console.log('📥 [IMAGE-DOWNLOAD] ✅ Downloaded successfully');

                    // Сохраняем в галерею
                    if (await Sharing.isAvailableAsync()) {
                        await Sharing.shareAsync(downloadResult.uri, {
                            mimeType: 'image/jpeg',
                            dialogTitle: 'Сохранить изображение',
                            UTI: 'public.image'
                        });
                        Alert.alert('Успешно', 'Изображение скачано');
                    } else {
                        Alert.alert('Успешно', `Изображение сохранено: ${localFilePath}`);
                    }
                } else {
                    throw new Error(`Download failed with status ${downloadResult.status}`);
                }
            } else if (imageUri.startsWith('file://')) {
                // Для локальных файлов - просто делимся
                if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(imageUri, {
                        mimeType: 'image/jpeg',
                        dialogTitle: 'Сохранить изображение',
                        UTI: 'public.image'
                    });
                } else {
                    Alert.alert('Ошибка', 'Функция сохранения недоступна');
                }
            } else {
                Alert.alert('Ошибка', 'Неподдерживаемый формат изображения для скачивания');
            }
        } catch (error) {
            console.error('📥 [IMAGE-DOWNLOAD] ❌ Error:', error);
            Alert.alert('Ошибка', 'Не удалось скачать изображение');
        }
    };

    // Открытие документа в системном приложении
    const openDocument = async (filePath: string, fileName: string) => {
        try {
            console.log('📄 [DOC-OPEN] Opening document:', {
                filePath: filePath.substring(filePath.lastIndexOf('/') + 1),
                fileName
            });

            // Определяем MIME тип по расширению файла
            const getContentType = (fileName: string): string => {
                const extension = fileName.split('.').pop()?.toLowerCase();
                const mimeTypes: {[key: string]: string} = {
                    'pdf': 'application/pdf',
                    'doc': 'application/msword',
                    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'xls': 'application/vnd.ms-excel',
                    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'ppt': 'application/vnd.ms-powerpoint',
                    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    'txt': 'text/plain',
                    'jpg': 'image/jpeg',
                    'jpeg': 'image/jpeg',
                    'png': 'image/png',
                    'zip': 'application/zip',
                };
                return mimeTypes[extension || ''] || 'application/octet-stream';
            };

            const contentType = getContentType(fileName);

            if (Platform.OS === 'android') {
                // Android: используем Intent Launcher для открытия документа
                try {
                    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
                        data: filePath,
                        flags: 1,
                        type: contentType,
                    });
                    console.log('📄 [DOC-OPEN] ✅ Opened with Android Intent');
                } catch (intentError) {
                    console.log('📄 [DOC-OPEN] Intent failed, trying sharing...');
                    // Если Intent не работает, пробуем поделиться файлом
                    await Sharing.shareAsync(filePath, {
                        mimeType: contentType,
                        dialogTitle: `Открыть ${fileName}`,
                    });
                    console.log('📄 [DOC-OPEN] ✅ Opened via sharing');
                }
            } else {
                // iOS: используем sharing для открытия документа
                await Sharing.shareAsync(filePath, {
                    mimeType: contentType,
                    dialogTitle: `Открыть ${fileName}`,
                });
                console.log('📄 [DOC-OPEN] ✅ Opened via iOS sharing');
            }

        } catch (error) {
            console.error('📄 [DOC-OPEN] ❌ Error opening document:', error);
            Alert.alert(
                'Не удалось открыть файл',
                `Файл "${fileName}" загружен, но не может быть открыт автоматически.\n\nВозможно, на устройстве нет подходящего приложения для этого типа файла.`,
                [
                    { text: 'OK', style: 'default' },
                    {
                        text: 'Показать в файлах',
                        style: 'default',
                        onPress: async () => {
                            try {
                                await Sharing.shareAsync(filePath);
                            } catch (shareError) {
                                console.error('Failed to share file:', shareError);
                            }
                        }
                    }
                ]
            );
        }
    };

    // Функция для открытия в браузере
    const openVideoInBrowser = async (videoUri: string) => {
        try {
            if (videoUri.startsWith('http')) {
                console.log('🎥 [BROWSER] Opening video in browser:', videoUri.substring(videoUri.lastIndexOf('/') + 1));
                await WebBrowser.openBrowserAsync(videoUri, {
                    presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
                    controlsColor: '#007AFF',
                    toolbarColor: '#000000',
                    enableDefaultShare: true,
                    showInRecents: true,
                });
                console.log('🎥 [BROWSER] ✅ Video opened in browser successfully');
            } else {
                Alert.alert('Ошибка', 'Браузер поддерживает только URL-адреса');
            }
        } catch (error) {
            console.error('🎥 [BROWSER] Failed to open video in browser:', error);
            Alert.alert('Ошибка', 'Не удалось открыть видео в браузере');
        }
    };

    // Функция для открытия в системном плеере (обновлена)
    const openInSystemPlayer = async (videoUri: string) => {
        try {
            if (videoUri.startsWith('http')) {
                // Сначала пытаемся открыть в браузере (более надежный способ)
                await openVideoInBrowser(videoUri);
            } else if (videoUri.startsWith('file://') || videoUri.startsWith('content://')) {
                // Для локальных файлов пытаемся поделиться
                if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(videoUri, {
                        mimeType: 'video/mp4',
                        dialogTitle: 'Открыть видео в системном плеере',
                        UTI: 'public.movie'
                    });
                } else {
                    Alert.alert('Ошибка', 'Функция совместного доступа недоступна');
                }
            } else {
                Alert.alert('Ошибка', 'Неподдерживаемый формат видео');
            }
        } catch (error) {
            console.error('🎥 [SYSTEM] Failed to open in system player:', error);

        }
    };

    // Открытие полноэкранного видеоплеера
    const openVideoViewer = async (videoUri: string, messageId?: number) => {
        // Очищаем предыдущее состояние
        setVideoError(null);
        setIsVideoPlaying(false);
        setAudioSessionReady(false);

        console.log('🎥 [VIEWER] Opening video viewer');

        setSelectedVideo(videoUri);
        setIsVideoViewerVisible(true);
        // Store the message ID for download functionality
        setSelectedMessageId(messageId ?? null);

        // Настраиваем аудио сессию после отображения модального окна
        setTimeout(async () => {
            try {
                if (appState === 'active') {
                    await Audio.setAudioModeAsync({
                        allowsRecordingIOS: false,
                        staysActiveInBackground: true,
                        playsInSilentModeIOS: true,
                        shouldDuckAndroid: true,
                        playThroughEarpieceAndroid: false
                    });
                    setAudioSessionReady(true);
                    console.log('🎥 [AUDIO] Audio session configured successfully');
                }
            } catch (audioError) {
                console.warn('🎥 [AUDIO] Failed to configure audio session:', audioError);
                setAudioSessionReady(false);
            }
        }, 1500);
    };

    // Функция принудительного воспроизведения с беззвучным режимом

    // Функция для остановки всех других видео
    const pauseAllOtherVideos = async (exceptMessageId: string | number) => {
        console.log('🎥 [PAUSE-ALL] Pausing all videos except:', exceptMessageId);

        // Получаем все ID видео которые сейчас воспроизводятся
        const playingVideoIds = Object.keys(inlineVideoStates).filter(
            id => inlineVideoStates[id]?.isPlaying && String(id) !== String(exceptMessageId)
        );

        console.log('🎥 [PAUSE-ALL] Found', playingVideoIds.length, 'playing videos to pause');

        // Останавливаем каждое видео
        for (const videoId of playingVideoIds) {
            try {
                const videoRef = inlineVideoRefs.current[videoId];
                if (videoRef) {
                    await videoRef.pauseAsync();
                    console.log('🎥 [PAUSE-ALL] ✅ Paused video:', videoId);

                    // Обновляем состояние
                    setInlineVideoStates(prev => ({
                        ...prev,
                        [videoId]: {
                            ...prev[videoId],
                            isPlaying: false
                        }
                    }));
                }
            } catch (error) {
                console.warn('🎥 [PAUSE-ALL] ⚠️ Failed to pause video:', videoId, error);
            }
        }
    };

    // Функции управления встроенным видео
    const toggleInlineVideo = async (messageId: string | number, videoUri: string) => {
        const currentState = inlineVideoStates[messageId] || {
            isPlaying: false, isMuted: false, isExpanded: false, duration: 0, position: 0, isLoaded: false, isFullscreen: false
        };
        const newPlayingState = !currentState.isPlaying;

        // Проверяем кеш и доступность видео
        const message = messages.find(msg => String(msg.id) === String(messageId));
        if (message) {
            // ВСЕГДА проверяем кеш перед воспроизведением
            const cacheExists = await checkVideoCacheExists(Number(messageId));

            if (cacheExists) {
                // Используем кешированную версию
                const cachedPath = getCachedVideoPath(Number(messageId));
                console.log('🎥 [INLINE] ✅ Using cached video:', cachedPath);

                if (videoUri !== cachedPath) {
                    // Обновляем URI если он отличается
                    updateMessageSafely(message.id, {
                        mediaUri: cachedPath
                    });
                    videoUri = cachedPath;
                }
            } else if (!videoUri.startsWith('http')) {
                console.log('🎥 [INLINE] Video not in cache and not HTTP, fetching and caching...');

                // Получаем URI с кешированием
                const cachedUri = await getVideoUriWithCache(message);
                if (cachedUri) {
                    // Обновляем URI на кешированный
                    updateMessageSafely(message.id, {
                        mediaUri: cachedUri
                    });
                    videoUri = cachedUri;
                } else if (message.serverFileUrl) {
                    // Fallback на серверный URL
                    updateMessageSafely(message.id, {
                        mediaUri: message.serverFileUrl
                    });
                    return;
                } else {
                    // Запрашиваем URL с сервера
                    await requestVideoLoad(message);
                    return;
                }
            } else if (videoUri.startsWith('http')) {
                console.log('🎥 [INLINE] Caching video from server during playback...');
                // Кешируем в фоновом режиме при воспроизведении
                cacheVideoToDevice(videoUri, Number(messageId)).then(cachedPath => {
                    if (cachedPath) {
                        console.log('🎥 [INLINE] ✅ Video cached in background');
                        // Обновляем URI на следующее воспроизведение
                        updateMessageSafely(message.id, {
                            mediaUri: cachedPath
                        });
                    }
                }).catch(err => {
                    console.warn('🎥 [INLINE] Background caching failed:', err);
                });
            }
        }

        try {
            const videoRef = inlineVideoRefs.current[messageId];
            if (videoRef) {
                console.log('🎥 [INLINE] Toggling video playback:', {
                    messageId,
                    currentPlaying: currentState.isPlaying,
                    newPlaying: newPlayingState,
                    appState: appState
                });

                if (newPlayingState) {
                    // При запуске видео сначала останавливаем все другие видео
                    await pauseAllOtherVideos(messageId);

                    // При запуске видео сначала убеждаемся что оно отключено (для избежания ошибок аудио)
                    if (appState === 'active') {
                        await videoRef.setIsMutedAsync(true); // Начинаем без звука
                        await videoRef.playAsync();
                    } else {
                        console.warn('🎥 [INLINE] Cannot start video - app not active');
                        return;
                    }
                } else {
                    await videoRef.pauseAsync();
                }

                setInlineVideoStates(prev => ({
                    ...prev,
                    [messageId]: { ...currentState, isPlaying: newPlayingState }
                }));
            }
        } catch (error: any) {
            console.error('🎥 [INLINE] Error toggling video:', error);

            if (error.message?.includes('AudioFocusNotAcquiredException') ||
                error.message?.includes('background')) {
                console.warn('🎥 [INLINE] Video control error - app in background');
                Alert.alert(
                    'Видео недоступно',
                    'Управление видео доступно только когда приложение активно'
                );
            } else {
                console.warn('🎥 [INLINE] Unknown video error:', error.message);
            }
        }
    };

    const toggleInlineVideoSound = async (messageId: string | number) => {
        // Проверяем, что приложение активно
        if (appState !== 'active') {
            console.warn('🎥 [INLINE] Cannot toggle sound - app not active:', appState);
            Alert.alert(
                'Звук недоступен',
                'Управление звуком доступно только когда приложение активно'
            );
            return;
        }

        const currentState = inlineVideoStates[messageId] || {
            isPlaying: false, isMuted: false, isExpanded: false, duration: 0, position: 0, isLoaded: false, isFullscreen: false
        };
        const newMutedState = !currentState.isMuted;

        try {
            const videoRef = inlineVideoRefs.current[messageId];
            if (videoRef) {
                console.log('🎥 [INLINE] Toggling sound for video:', {
                    messageId,
                    currentMuted: currentState.isMuted,
                    newMuted: newMutedState,
                    appState: appState
                });

                await videoRef.setIsMutedAsync(newMutedState);
                setInlineVideoStates(prev => ({
                    ...prev,
                    [messageId]: { ...currentState, isMuted: newMutedState }
                }));

                console.log('🎥 [INLINE] ✅ Sound toggled successfully');
            }
        } catch (error: any) {
            console.error('🎥 [INLINE] Error toggling sound:', error);

            // Обрабатываем специфичные ошибки
            if (error.message?.includes('AudioFocusNotAcquiredException') ||
                error.message?.includes('background')) {
                console.warn('🎥 [INLINE] Audio focus error - app in background');
                Alert.alert(
                    'Проблема со звуком',
                    'Не удается управлять звуком. Попробуйте:\n• Убедиться, что приложение активно\n• Перезапустить видео\n• Проверить настройки звука устройства'
                );
            } else {
                // Для других ошибок просто обновляем состояние без звука
                console.warn('🎥 [INLINE] Unknown audio error, updating state silently');
            }
        }
    };

    const expandInlineVideo = (messageId: string | number, videoUri: string) => {
        const currentState = inlineVideoStates[messageId] || {
            isPlaying: false, isMuted: false, isExpanded: false, duration: 0, position: 0, isLoaded: false, isFullscreen: false
        };

        // Переключаем полноэкранный режим
        const newExpandedState = !currentState.isExpanded;

        setInlineVideoStates(prev => ({
            ...prev,
            [messageId]: { ...currentState, isExpanded: newExpandedState }
        }));
    };

    // Улучшенная функция переключения полноэкранного режима
    // ВАЖНО: Полноэкранный режим использует тот же videoUri что и инлайн плеер
    // Приоритет загрузки: 1) Кеш (file://cached) 2) Галерея (file://) 3) Сервер (http://) 4) Base64 (data:)
    const toggleVideoFullscreen = async (messageId: string | number, videoUri: string) => {
        const currentState = inlineVideoStates[messageId] || {
            isPlaying: false, isMuted: false, isExpanded: false, duration: 0, position: 0, isLoaded: false, isFullscreen: false
        };

        // ПРОВЕРЯЕМ КЕШ ПЕРЕД ОТКРЫТИЕМ ПОЛНОЭКРАННОГО РЕЖИМА
        const message = messages.find(msg => String(msg.id) === String(messageId));
        let finalVideoUri = videoUri;

        if (message) {
            const cacheExists = await checkVideoCacheExists(Number(messageId));
            if (cacheExists) {
                const cachedPath = getCachedVideoPath(Number(messageId));
                console.log('🎥 [FULLSCREEN] ✅ Using cached video for fullscreen:', cachedPath);
                finalVideoUri = cachedPath;
                // Обновляем mediaUri в сообщении
                updateMessageSafely(message.id, {
                    mediaUri: cachedPath
                });
            } else if (videoUri.startsWith('http')) {
                console.log('🎥 [FULLSCREEN] Video not cached, will cache during playback');
                // Кешируем в фоновом режиме
                cacheVideoToDevice(videoUri, Number(messageId)).then(cachedPath => {
                    if (cachedPath) {
                        console.log('🎥 [FULLSCREEN] ✅ Video cached during fullscreen playback');
                        updateMessageSafely(message.id, {
                            mediaUri: cachedPath
                        });
                    }
                });
            }
        }

        const videoSource = finalVideoUri?.startsWith('file://') ?
                          (finalVideoUri.includes('cached_video_') ? 'cached' : 'local-gallery') :
                          finalVideoUri?.startsWith('http') ? 'server-url' :
                          finalVideoUri?.startsWith('data:') ? 'base64-data' : 'unknown';

        if (!currentState.isFullscreen) {
            // ОСТАНАВЛИВАЕМ поток видео в миниатюре перед открытием полноэкранного режима
            const videoRef = inlineVideoRefs.current[messageId];
            if (videoRef && currentState.isPlaying) {
                try {
                    await videoRef.pauseAsync();

                } catch (error) {
                    console.warn('🎥 [FULLSCREEN] Failed to stop inline video:', error);
                }
            }

            // Включаем полноэкранный режим через модальное окно
            // Используем кешированный URI (приоритет: кеш -> галерея -> сервер -> base64)
            setFullscreenModalVideoUri(finalVideoUri);
            setSelectedVideo(finalVideoUri); // Сохраняем для кнопок управления
            setSelectedMessageId(Number(messageId)); // Сохраняем ID сообщения
            setIsFullscreenModalVisible(true);
            setInlineVideoStates(prev => ({
                ...prev,
                [messageId]: {
                    ...currentState,
                    isFullscreen: true,
                    isPlaying: false // Помечаем как остановленное
                }
            }));

            console.log('🎥 [FULLSCREEN] Modal fullscreen mode activated:', {
                videoSource: videoSource,
                willAutoSave: videoSource === 'server-url',
                messageId: messageId,
                inlineStreamStopped: true
            });
        } else {
            // Выключаем полноэкранный режим
            setIsFullscreenModalVisible(false);
            setFullscreenModalVideoUri(null);
            setInlineVideoStates(prev => ({
                ...prev,
                [messageId]: {
                    ...currentState,
                    isFullscreen: false,
                    isExpanded: false
                }
            }));

            console.log('🎥 [FULLSCREEN] Returned to normal video mode');
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

        // Проверяем, является ли сообщение непрочитанным
        const isUnread = unreadMessages.has(item.id);
        const animatedValue = unreadAnimations.current[item.id];

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

            // Показываем индикатор загрузки URL с сервера
            if (item.isLoadingServerUrl) {
                return (
                    <View style={styles.uploadingContainer}>
                        <View style={styles.uploadingContent}>
                            <ActivityIndicator size="small" color={theme.primary} />
                            <Text style={[styles.uploadingText, { color: theme.textSecondary }]}>
                                {item.mediaType === 'image' ? 'Загрузка изображения из истории...' : 'Загрузка видео из истории...'}
                            </Text>
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
                    // УНИФИЦИРОВАННАЯ ЛОГИКА: точно так же как для видео
                    const imageUri = item.serverFileUrl ||
                                     (item.mediaBase64 ? `data:image/jpeg;base64,${item.mediaBase64}` : null);

                    if (!imageUri) {
                        // Изображение не загружено - используем API endpoint как для видео
                        return (
                            <LazyMedia
                                onVisible={async () => {
                                    console.log('🎨 [LAZY-LOAD] Image became visible, loading via API:', item.id);

                                    if (!item.isLoadingServerUrl && !item.serverFileUrl) {
                                        updateMessageSafely(item.id, { isLoadingServerUrl: true });

                                        // ТОТ ЖЕ API ЧТО И ДЛЯ ВИДЕО
                                        const serverUrl = await getMediaServerUrl(item.id);
                                        if (serverUrl) {
                                            updateMessageSafely(item.id, {
                                                serverFileUrl: serverUrl,
                                                isLoadingServerUrl: false
                                            });
                                            console.log('🎨 [LAZY-LOAD] ✅ Image URL loaded via API');
                                        } else {
                                            updateMessageSafely(item.id, {
                                                isLoadingServerUrl: false,
                                                needsReload: true
                                            });
                                        }
                                    }
                                }}
                                style={styles.missingMediaContainer}
                            >
                                <MaterialIcons name="image" size={48} color={theme.textSecondary} />
                                <Text style={[styles.missingMediaText, { color: theme.textSecondary }]}>
                                    Изображение {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + 'MB' : ''}
                                </Text>
                                <Text style={[styles.missingMediaSubtext, { color: theme.placeholder }]}>
                                    Загружается через API...
                                </Text>
                            </LazyMedia>
                        );
                    }

                    return (
                        <LazyMedia style={styles.mediaContainer}>
                            <TouchableOpacity
                                onPress={() => openImageViewer(imageUri)}
                                style={styles.mediaContainer}
                            >
                                <DirectImage
                                    uri={imageUri}
                                    style={styles.messageImage}
                                    resizeMode="cover"
                                    onError={async () => {
                                        console.error('🎨 [IMAGE-ERROR] Image load failed, reloading via API:', item.id);

                                        // УНИФИЦИРОВАННАЯ ОБРАБОТКА ОШИБОК: как для видео
                                        updateMessageSafely(item.id, { isLoadingServerUrl: true });

                                        const serverUrl = await getMediaServerUrl(item.id);
                                        if (serverUrl) {
                                            updateMessageSafely(item.id, {
                                                serverFileUrl: serverUrl,
                                                isLoadingServerUrl: false
                                            });
                                            console.log('🎨 [AUTO-RELOAD] ✅ Image reloaded via API');
                                        } else {
                                            updateMessageSafely(item.id, {
                                                isLoadingServerUrl: false,
                                                needsReload: true
                                            });
                                        }
                                    }}
                                />
                            </TouchableOpacity>
                        </LazyMedia>
                );
            } else if (item.mediaType === 'video') {
                // Прямая загрузка с сервера: только serverFileUrl или base64
                const hasVideoUri = item.serverFileUrl || (item.mediaBase64 ? `data:video/mp4;base64,${item.mediaBase64}` : null);
                const isVideoRequested = item.videoLoadRequested;
                const isVideoLoading = item.videoIsLoading;

                // Ленивая загрузка видео: URL загружается при появлении в viewport
                if (!isVideoRequested && !hasVideoUri) {
                    return (
                        <LazyMedia
                            onVisible={async () => {
                                // Предзагружаем URL видео когда превью становится видимым
                                console.log('🎥 [LAZY-PREFETCH] Video preview visible, checking cache first:', item.id);

                                // СНАЧАЛА ПРОВЕРЯЕМ КЕШ
                                const cacheExists = await checkVideoCacheExists(item.id);
                                if (cacheExists) {
                                    const cachedPath = getCachedVideoPath(item.id);
                                    console.log('🎥 [LAZY-PREFETCH] ✅ Found in cache, using cached version');
                                    updateMessageSafely(item.id, {
                                        mediaUri: cachedPath,
                                        serverFileUrl: item.serverFileUrl || null,
                                        videoLoadRequested: true,
                                        videoIsLoading: false,
                                        needsReload: false
                                    });
                                    return;
                                }

                                if (!item.videoIsLoading && !item.serverFileUrl) {
                                    // Загружаем только URL, не сам файл (кеширование при воспроизведении)
                                    try {
                                        const serverUrl = await getMediaServerUrl(item.id);
                                        if (serverUrl) {
                                            updateMessageSafely(item.id, {
                                                serverFileUrl: serverUrl
                                            });
                                        }
                                    } catch (error) {
                                        console.log('🎥 [LAZY-PREFETCH] Error prefetching URL:', error);
                                    }
                                }
                            }}
                            style={styles.videoPreviewContainer}
                        >
                            <TouchableOpacity
                                style={styles.videoPreviewContainer}
                                onPress={async () => {
                                    console.log('🎥 [LAZY-LOAD] User pressed play - checking cache first:', item.id);

                                    // ПРОВЕРЯЕМ КЕШ ПЕРЕД ЗАГРУЗКОЙ
                                    const cacheExists = await checkVideoCacheExists(item.id);
                                    if (cacheExists) {
                                        const cachedPath = getCachedVideoPath(item.id);
                                        console.log('🎥 [LAZY-LOAD] ✅ Found in cache, using immediately');
                                        updateMessageSafely(item.id, {
                                            mediaUri: cachedPath,
                                            videoLoadRequested: true,
                                            videoIsLoading: false,
                                            needsReload: false
                                        });
                                    } else {
                                        console.log('🎥 [LAZY-LOAD] Not in cache, loading and caching...');
                                        await requestVideoLoad(item);
                                    }
                                }}
                            >
                                <View style={styles.videoPreviewContent}>
                                    <MaterialIcons name="play-circle-filled" size={64} color={theme.primary} />
                                    <Text style={[styles.videoPreviewTitle, { color: theme.text }]}>
                                        🎥 Видео
                                    </Text>
                                    <Text style={[styles.videoPreviewSize, { color: theme.textSecondary }]}>
                                        {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + ' MB' : 'Размер неизвестен'}
                                    </Text>
                                    <Text style={[styles.videoPreviewHint, { color: theme.primary }]}>
                                        Нажмите ▶ для воспроизведения
                                    </Text>
                                    <Text style={[styles.videoPreviewNote, { color: theme.placeholder }]}>
                                        Загружается при прокрутке
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        </LazyMedia>
                    );
                }

                // Если видео загружается - показываем индикатор
                if (isVideoLoading) {
                    return (
                        <View style={styles.videoLoadingContainer}>
                            <ActivityIndicator size="large" color={theme.primary} />
                            <Text style={[styles.videoLoadingText, { color: theme.textSecondary }]}>
                                Загрузка видео...
                            </Text>
                            <Text style={[styles.videoLoadingSize, { color: theme.placeholder }]}>
                                {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + ' MB' : ''}
                            </Text>
                        </View>
                    );
                }

                // Если не удалось загрузить - показываем ошибку
                // ВАЖНО: НЕ показываем ошибку если есть mediaUri (может быть кеш)
                if (isVideoRequested && !hasVideoUri && !isVideoLoading && !item.mediaUri) {
                    return (
                        <TouchableOpacity
                            style={styles.missingMediaContainer}
                            onPress={async () => {
                                console.log('🎥 [RETRY] Retrying video load:', item.id);

                                // Проверяем кеш перед повторной загрузкой
                                const cacheExists = await checkVideoCacheExists(item.id);
                                if (cacheExists) {
                                    const cachedPath = getCachedVideoPath(item.id);
                                    console.log('🎥 [RETRY] ✅ Found in cache on retry');
                                    updateMessageSafely(item.id, {
                                        mediaUri: cachedPath,
                                        videoLoadRequested: true,
                                        videoIsLoading: false,
                                        needsReload: false
                                    });
                                } else {
                                    await requestVideoLoad(item);
                                }
                            }}
                        >
                            <MaterialIcons name="videocam-off" size={48} color={theme.textSecondary} />
                            <Text style={[styles.missingMediaText, { color: theme.textSecondary }]}>
                                Видео {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + 'MB' : ''}
                            </Text>
                            <Text style={[styles.missingMediaSubtext, { color: theme.placeholder }]}>
                                Ошибка загрузки. Нажмите для повтора
                            </Text>
                        </TouchableOpacity>
                    );
                }

                // Видео загружено - показываем плеер
                // ВАЖНО: Приоритет кешированного видео!
                // 1. Проверяем mediaUri (может быть кешированный путь file://)
                // 2. Затем serverFileUrl (HTTP)
                // 3. В конце base64
                const videoUri = item.mediaUri || item.serverFileUrl || hasVideoUri;
                if (!videoUri) {
                    return null;
                }
                const messageId = String(item.id);
                const videoState = inlineVideoStates[messageId] || {
                    isPlaying: false, isMuted: false, isExpanded: false, duration: 0, position: 0, isLoaded: false
                };

                // Определяем стиль контейнера в зависимости от режима отображения
                const containerStyle = videoState.isFullscreen
                    ? styles.deviceFullscreenVideoContainer
                    : videoState.isExpanded
                    ? styles.fullscreenVideoContainer
                    : styles.inlineVideoContainer;

                const videoStyle = videoState.isFullscreen
                    ? styles.deviceFullscreenVideo
                    : videoState.isExpanded
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
                            source={{
                                uri: videoUri,
                                overrideFileExtensionAndroid: 'mp4' // Оптимизация для Android
                            }}
                            style={videoStyle}
                            resizeMode={videoState.isExpanded ? ResizeMode.CONTAIN : ResizeMode.COVER}
                            useNativeControls={false}
                            shouldPlay={videoState.isPlaying}
                            isMuted={videoState.isMuted}
                            isLooping={false}
                            progressUpdateIntervalMillis={500} // Обновление прогресса каждые 500мс
                            videoStyle={{ backgroundColor: 'black' }} // Оптимизация рендеринга
                            onLoad={(data) => {
                                setInlineVideoStates(prev => ({
                                    ...prev,
                                    [messageId]: {
                                        ...videoState,
                                        duration: data.durationMillis || 0,
                                        isLoaded: true
                                    }
                                }));
                            }}
                            onError={async (error) => {
                                console.error('🎥 [INLINE-VIDEO] ❌ Video error:', {
                                    messageId: item.id,
                                    error: error,
                                    uri: videoUri?.substring(videoUri.lastIndexOf('/') + 1),
                                    fullUri: videoUri,
                                    errorType: error?.error?.includes('MediaCodecRenderer') ? 'codec' :
                                              error?.error?.includes('Decoder') ? 'decoder' :
                                              error?.error?.includes('FileNotFound') || error?.error?.includes('failed to load') ? 'cache' : 'unknown'
                                });

                                // Проверяем, является ли это ошибкой кэша
                                const isCacheError = error?.error?.includes('FileNotFound') ||
                                                    error?.error?.includes('failed to load') ||
                                                    error?.error?.includes('unable to read file') ||
                                                    (!videoUri?.startsWith('http') && error?.error);

                                if (isCacheError) {
                                    // Кэш очищен - повторно загружаем и кешируем с сервера
                                    console.log('🎥 [AUTO-RELOAD] Cache cleared, fetching and caching from server:', item.id);

                                    updateMessageSafely(item.id, {
                                        videoIsLoading: true
                                    });

                                    try {
                                        // Получаем и кешируем видео заново
                                        const newCachedUri = await getVideoUriWithCache(item);
                                        if (newCachedUri) {
                                            updateMessageSafely(item.id, {
                                                mediaUri: newCachedUri,
                                                videoLoadRequested: true,
                                                videoIsLoading: false
                                            });
                                            console.log('🎥 [AUTO-RELOAD] ✅ Video re-cached successfully');
                                        } else {
                                            throw new Error('Failed to get cached video');
                                        }
                                    } catch (cacheError) {
                                        console.error('🎥 [AUTO-RELOAD] Re-caching failed:', cacheError);

                                        // Fallback на прямой серверный URL
                                        if (item.serverFileUrl) {
                                            updateMessageSafely(item.id, {
                                                mediaUri: item.serverFileUrl,
                                                videoLoadRequested: true,
                                                videoIsLoading: false
                                            });
                                        } else {
                                            updateMessageSafely(item.id, {
                                                videoIsLoading: false,
                                                needsReload: true
                                            });
                                        }
                                    }

                                    return;
                                } else if (isCacheError && !item.serverFileUrl) {
                                    // Нет serverFileUrl - запрашиваем с сервера
                                    console.log('🎥 [AUTO-RELOAD] Cache cleared, requesting URL from server:', item.id);

                                    updateMessageSafely(item.id, {
                                        videoIsLoading: true
                                    });

                                    try {
                                        const serverUrl = await getMediaServerUrl(item.id);
                                        if (serverUrl) {
                                            updateMessageSafely(item.id, {
                                                serverFileUrl: serverUrl,
                                                mediaUri: serverUrl,
                                                videoIsLoading: false,
                                                videoLoadRequested: true
                                            });
                                            console.log('🎥 [AUTO-RELOAD] ✅ Server URL loaded after cache miss');
                                        } else {
                                            updateMessageSafely(item.id, {
                                                videoIsLoading: false,
                                                needsReload: true
                                            });
                                        }
                                    } catch (serverError) {
                                        console.error('🎥 [AUTO-RELOAD] Failed to get server URL:', serverError);
                                        updateMessageSafely(item.id, {
                                            videoIsLoading: false,
                                            needsReload: true
                                        });
                                    }

                                    return;
                                }

                                // Определяем тип ошибки и показываем соответствующее решение
                                const isCodecError = error?.error?.includes('MediaCodecRenderer') ||
                                                   error?.error?.includes('Decoder init failed');

                                if (isCodecError) {
                                    // Ошибка кодека - автоматически открываем в браузере
                                    console.log('🎥 [AUTO-FALLBACK] Codec error detected, opening in browser');

                                    if (videoUri?.startsWith('http')) {
                                        // Для HTTP видео - сразу открываем в браузере
                                        Alert.alert(
                                            'Несовместимый кодек',
                                            'Видео использует кодек, который не поддерживается устройством. Открываем в браузере...',
                                            [
                                                {
                                                    text: 'OK',
                                                    onPress: async () => {
                                                        try {
                                                            await WebBrowser.openBrowserAsync(videoUri, {
                                                                presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
                                                                controlsColor: '#007AFF',
                                                                toolbarColor: '#000000',
                                                                enableDefaultShare: true,
                                                                showInRecents: true,
                                                            });
                                                        } catch (browserError) {
                                                            console.error('Browser open failed:', browserError);
                                                            Alert.alert('Ошибка', 'Не удалось открыть видео в браузере');
                                                        }
                                                    }
                                                }
                                            ]
                                        );
                                    } else {
                                        // Для локальных файлов - пробуем системный плеер
                                        Alert.alert(
                                            'Проблема с воспроизведением',
                                            'Встроенный плеер не может воспроизвести это видео.\n\nОткрыть в системном плеере?',
                                            [
                                                { text: 'Отмена', style: 'cancel' },
                                                {
                                                    text: 'Системный плеер',
                                                    onPress: async () => {
                                                        try {
                                                            if (videoUri?.startsWith('file://')) {
                                                                await Sharing.shareAsync(videoUri, {
                                                                    mimeType: 'video/mp4',
                                                                    dialogTitle: 'Открыть видео',
                                                                    UTI: 'public.movie'
                                                                });
                                                            }
                                                        } catch (shareError) {
                                                            console.error('Failed to open in system player:', shareError);
                                                            Alert.alert('Ошибка', 'Не удалось открыть видео');
                                                        }
                                                    }
                                                }
                                            ]
                                        );
                                    }
                                } else {
                                    // Обычная ошибка загрузки
                                    updateMessageSafely(item.id, { needsReload: true });
                                }
                            }}
                            onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                                if ('error' in status) {
                                    console.error('🎥 [INLINE-VIDEO] Playback error:', status.error);
                                } else if ('durationMillis' in status && status.isLoaded) {
                                    const currentState = inlineVideoStates[messageId] || {
                                        isPlaying: false, isMuted: false, isExpanded: false, duration: 0, position: 0, isLoaded: false
                                    };

                                    // Проверяем, закончилось ли видео
                                    const isFinished = status.positionMillis >= status.durationMillis - 200; // 100ms погрешность

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



                        {/* Контролы видео */}
                        <View style={videoState.isExpanded ? styles.fullscreenVideoControls : styles.inlineVideoControls}>
                            {/* Кнопка воспроизведения/паузы удалена, управление происходит через центральную кнопку в полноэкранном модальном плеере */}

                            {/* Кнопка полноэкранного режима */}
                            <TouchableOpacity
                                style={styles.inlineVideoButton}
                                onPress={() => toggleVideoFullscreen(messageId, videoUri)}
                            >
                                <MaterialIcons
                                    name={videoState.isFullscreen ? "fullscreen-exit" : "fullscreen"}
                                    size={videoState.isExpanded ? 28 : 20}
                                    color="white"
                                />
                            </TouchableOpacity>

                            {/* Дополнительные кнопки только в развернутом режиме */}
                            {(videoState.isExpanded || videoState.isFullscreen) && (
                                <>
                                    {/* Кнопка звука */}
                                    <TouchableOpacity
                                        style={styles.inlineVideoButton}
                                        onPress={() => toggleInlineVideoSound(messageId)}
                                    >
                                        <MaterialIcons
                                            name={videoState.isMuted ? "volume-off" : "volume-up"}
                                            size={videoState.isFullscreen ? 32 : 28}
                                            color={audioSessionReady ? "white" : "rgba(255, 255, 255, 0.5)"}
                                        />
                                    </TouchableOpacity>

                                    {/* Кнопка скачивания */}
                                    <TouchableOpacity
                                        style={styles.inlineVideoButton}
                                        onPress={() => downloadVideo(videoUri, Number(messageId))}
                                    >
                                        <MaterialIcons
                                            name="download"
                                            size={videoState.isFullscreen ? 32 : 28}
                                            color="white"
                                        />
                                    </TouchableOpacity>

                                    {/* Кнопка открытия в браузере */}
                                    {videoUri?.startsWith('http') && (
                                        <TouchableOpacity
                                            style={styles.inlineVideoButton}
                                            onPress={() => openVideoInBrowser(videoUri)}
                                        >
                                            <MaterialIcons
                                                name="open-in-browser"
                                                size={videoState.isFullscreen ? 32 : 28}
                                                color="rgba(255, 255, 255, 0.9)"
                                            />
                                        </TouchableOpacity>
                                    )}
                                </>
                            )}
                        </View>

                        {/* Прогресс-бар (перемещён под кнопки) */}
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

                        {/* Время воспроизведения (под прогресс‑баром) */}
                        {videoState.isLoaded && (
                            <View style={styles.videoTimeContainerSimple}>
                                <Text style={styles.videoTimeText}>
                                    {Math.floor(videoState.position / 1000)}s / {Math.floor((videoState.duration ?? 0) / 1000)}s
                                </Text>
                            </View>
                        )}

                        {/* Всегда показываем overlay, меняя иконку в зависимости от состояния */}
                        <TouchableOpacity
                            style={styles.videoPlayOverlay}
                            onPress={() => toggleInlineVideo(messageId, videoUri)}
                        >
                            <MaterialIcons
                                name={videoState.isPlaying ? "pause-circle-filled" : "play-circle-filled"}
                                size={48}
                                color="rgba(255, 255, 255, 0.4)"  // более прозрачный цвет
                            />
                        </TouchableOpacity>

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
            } else if (item.mediaType === 'audio') {
                // Аудио сообщение
                const audioUri = item.serverFileUrl || item.mediaUri;
                const audioState = audioPlaybackStates[item.id];
                const isPlaying = playingAudioId === item.id && audioState?.isPlaying;

                if (!audioUri) {
                    // Аудио не загружено
                    return (
                        <LazyMedia
                            onVisible={async () => {
                                console.log('🎤 [LAZY-LOAD] Audio became visible, loading via API:', item.id);

                                if (!item.isLoadingServerUrl && !item.serverFileUrl) {
                                    updateMessageSafely(item.id, { isLoadingServerUrl: true });

                                    const serverUrl = await getMediaServerUrl(item.id);
                                    if (serverUrl) {
                                        updateMessageSafely(item.id, {
                                            serverFileUrl: serverUrl,
                                            mediaUri: serverUrl,
                                            isLoadingServerUrl: false
                                        });
                                        console.log('🎤 [LAZY-LOAD] ✅ Audio URL loaded');
                                    } else {
                                        updateMessageSafely(item.id, {
                                            isLoadingServerUrl: false,
                                            needsReload: true
                                        });
                                    }
                                }
                            }}
                            style={styles.audioContainer}
                        >
                            {item.isLoadingServerUrl ? (
                                <View style={styles.audioPlayerContainer}>
                                    <ActivityIndicator size="small" color={theme.primary} />
                                    <Text style={[styles.audioLoadingText, { color: theme.textSecondary }]}>
                                        Загрузка аудио...
                                    </Text>
                                </View>
                            ) : (
                                <View style={styles.audioPlayerContainer}>
                                    <MaterialIcons name="mic" size={24} color={theme.textSecondary} />
                                    <Text style={[styles.audioLoadingText, { color: theme.textSecondary }]}>
                                        Голосовое сообщение
                                    </Text>
                                </View>
                            )}
                        </LazyMedia>
                    );
                }

                // Аудио-плеер
                const duration = audioState?.duration || 0;
                const position = audioState?.position || 0;
                const progress = duration > 0 ? (position / duration) * 100 : 0;

                return (
                    <TouchableOpacity
                        style={styles.audioPlayerContainer}
                        onPress={() => playAudio(item)}
                        activeOpacity={0.7}
                    >
                        <View style={[styles.audioPlayButton, { backgroundColor: theme.primary }]}>
                            <MaterialIcons
                                name={isPlaying ? "pause" : "play-arrow"}
                                size={24}
                                color="white"
                            />
                        </View>

                        <View style={styles.audioWaveform}>
                            <View style={[styles.audioProgressBar, { backgroundColor: theme.border }]}>
                                <View
                                    style={[
                                        styles.audioProgressFill,
                                        {
                                            backgroundColor: theme.primary,
                                            width: `${progress}%`
                                        }
                                    ]}
                                />
                            </View>
                            <Text style={[styles.audioDuration, { color: theme.textSecondary }]}>
                                {duration > 0
                                    ? `${Math.floor(position / 1000)}:${String(Math.floor((position % 1000) / 10)).padStart(2, '0')} / ${Math.floor(duration / 1000)}:${String(Math.floor((duration % 1000) / 10)).padStart(2, '0')}`
                                    : item.message.match(/\((\d+)с\)/)?.[1] ? `${item.message.match(/\((\d+)с\)/)?.[1]}с` : '0:00'
                                }
                            </Text>
                        </View>
                    </TouchableOpacity>
                );
            } else if (item.mediaType === 'file') {
                // ЛЕНИВАЯ ЗАГРУЗКА URL для документов (как для изображений и видео)
                const fileUrl = item.serverFileUrl || item.mediaUri;

                if (!fileUrl) {
                    // Документ не загружен - используем LazyMedia для загрузки через API
                    return (
                        <LazyMedia
                            onVisible={async () => {
                                console.log('📄 [LAZY-LOAD] Document became visible, loading via API:', item.id);

                                if (!item.isLoadingServerUrl && !item.serverFileUrl) {
                                    updateMessageSafely(item.id, { isLoadingServerUrl: true });

                                    // ЗАГРУЖАЕМ URL ЧЕРЕЗ API (как для изображений и видео)
                                    const serverUrl = await getMediaServerUrl(item.id);
                                    if (serverUrl) {
                                        updateMessageSafely(item.id, {
                                            serverFileUrl: serverUrl,
                                            mediaUri: serverUrl,
                                            isLoadingServerUrl: false
                                        });
                                        console.log('📄 [LAZY-LOAD] ✅ Document URL loaded via API');
                                    } else {
                                        updateMessageSafely(item.id, {
                                            isLoadingServerUrl: false,
                                            needsReload: true
                                        });
                                        console.log('📄 [LAZY-LOAD] ❌ Failed to load document URL');
                                    }
                                }
                            }}
                            style={styles.missingMediaContainer}
                        >
                            {item.isLoadingServerUrl ? (
                                <>
                                    <ActivityIndicator size="small" color={theme.primary} />
                                    <Text style={[styles.missingMediaText, { color: theme.textSecondary, marginTop: 8 }]}>
                                        Загрузка документа...
                                    </Text>
                                </>
                            ) : (
                                <>
                                    <MaterialIcons name="description" size={48} color={theme.textSecondary} />
                                    <Text style={[styles.missingMediaText, { color: theme.textSecondary }]}>
                                        {item.mediaFileName || 'Документ'} {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + 'MB' : ''}
                                    </Text>
                                    <Text style={[styles.missingMediaSubtext, { color: theme.placeholder }]}>
                                        Загружается через API...
                                    </Text>
                                </>
                            )}
                        </LazyMedia>
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

                const isDownloading = downloadingDocuments[item.id];
                const downloadProgress = documentDownloadProgress[item.id] || 0;

                return (
                    <TouchableOpacity
                        style={[
                            styles.fileContainer,
                            isDownloading && styles.fileContainerDownloading
                        ]}
                        onPress={() => {
                            if (!isDownloading) {
                                downloadAndOpenDocument(item);
                            }
                        }}
                        activeOpacity={0.7}
                        disabled={isDownloading}
                    >
                        <View style={styles.fileIconContainer}>
                            {isDownloading ? (
                                <ActivityIndicator size="small" color={theme.primary} />
                            ) : (
                                <MaterialIcons
                                    name={fileIcon as any}
                                    size={32}
                                    color={theme.primary}
                                />
                            )}
                        </View>
                        <View style={styles.fileInfo}>
                            <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={5}>
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
                            {isDownloading && (
                                <View style={styles.downloadProgressContainer}>
                                    <View style={[styles.downloadProgressBar, { backgroundColor: theme.border }]}>
                                        <View
                                            style={[
                                                styles.downloadProgressFill,
                                                {
                                                    backgroundColor: theme.primary,
                                                    width: `${downloadProgress}%`
                                                }
                                            ]}
                                        />
                                    </View>
                                    <Text style={[styles.downloadProgressText, { color: theme.textSecondary }]}>
                                        Загрузка... {downloadProgress}%
                                    </Text>
                                </View>
                            )}
                        </View>
                        <MaterialIcons
                            name={isDownloading ? "hourglass-empty" : "open-in-new"}
                            size={20}
                            color={isDownloading ? theme.placeholder : theme.primary}
                        />
                    </TouchableOpacity>
                );
            }

            return null;
        };

        // ИСПРАВЛЕНИЕ: Используем правильный Animated компонент из react-native
        const AnimatedNative = require('react-native').Animated;
        const AnimatedView = AnimatedNative.View;

        // Создаем анимированный стиль для непрочитанных сообщений
        // ВАЖНО: Проверяем что animatedValue существует перед использованием
        const getBackgroundStyle = () => {
            if (!isUnread || !animatedValue) {
                // Обычный статичный стиль для прочитанных сообщений
                return {
                    backgroundColor: isMyMessage ? theme.primary : theme.surface
                };
            }

            // Анимированный стиль для непрочитанных сообщений
            return {
                backgroundColor: animatedValue.interpolate({
                    inputRange: [0, 1],
                    outputRange: [
                        isMyMessage ? theme.primary : theme.surface,
                        'rgba(255, 215, 0, 0.3)' // Золотистый оттенок для непрочитанных
                    ]
                })
            };
        };

        const backgroundStyle = getBackgroundStyle();

        return (
            <AnimatedView style={[
                styles.messageContainer,
                isMyMessage ? styles.myMessage : styles.otherMessage,
                item.mediaType ? styles.mediaMessage : null,
                backgroundStyle
            ]}>
                {!isMyMessage && (
                    <Text style={[styles.senderName, { color: theme.textSecondary }]}>{item.sender__username}</Text>
                )}

                {renderMediaContent()}

                {/* Показываем текст только если это не медиа (фото/видео) или если есть реальное текстовое сообщение */}
                {item.message && !item.message.match(/^(📷 Изображение|🎥 Видео)$/) && (
                    <Text style={[
                        styles.messageText,
                        isMyMessage ? styles.myMessageText : styles.otherMessageText,
                        item.mediaType ? styles.mediaMessageText : null
                    ]}>
                        {item.message}
                    </Text>
                )}

                <Text style={[
                    styles.timestamp,
                    isMyMessage ? styles.myTimestamp : styles.otherTimestamp
                ]}>
                    {formatTimestamp(item.timestamp)}
                </Text>
            </AnimatedView>
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
                        <DirectImage
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
                    keyExtractor={(item, index) => `msg-${item.id}-${item.mediaType || 'text'}-${index}`}
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
                    // Оптимизации для ленивой загрузки - БЕЗ getItemLayout для динамической высоты
                    removeClippedSubviews={Platform.OS === 'android'} // Только для Android
                    maxToRenderPerBatch={8}
                    updateCellsBatchingPeriod={100}
                    initialNumToRender={12}
                    windowSize={7}
                    // Убираем getItemLayout - он вызывает мерцание с динамической высотой видео
                />

                <View style={styles.inputContainer}>
                    {isRecordingAudio ? (
                        /* Панель записи аудио */
                        <View style={styles.recordingContainer}>
                            <TouchableOpacity
                                style={[styles.cancelRecordButton, { backgroundColor: theme.error || '#ff4444' }]}
                                onPress={cancelAudioRecording}
                            >
                                <MaterialIcons name="close" size={24} color="white" />
                            </TouchableOpacity>

                            <View style={styles.recordingIndicator}>
                                <View style={styles.recordingDot} />
                                <Text style={[styles.recordingText, { color: theme.text }]}>
                                    {Math.floor(recordingDuration / 60)}:{String(recordingDuration % 60).padStart(2, '0')}
                                </Text>
                            </View>

                            <TouchableOpacity
                                style={[styles.sendRecordButton, { backgroundColor: theme.primary }]}
                                onPress={stopAndSendAudio}
                            >
                                <MaterialIcons name="send" size={24} color="white" />
                            </TouchableOpacity>
                        </View>
                    ) : (
                        /* Обычная панель ввода */
                        <>
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

                            {messageText.trim() ? (
                                /* Кнопка отправки текста */
                                <Pressable
                                    style={[
                                        styles.sendButton,
                                        {
                                            backgroundColor: isConnected && isDataLoaded ? theme.primary : theme.placeholder,
                                            opacity: isConnected && isDataLoaded ? 1 : 0.5
                                        }
                                    ]}
                                    onPress={handleSend}
                                    disabled={!isConnected || !isDataLoaded}
                                >
                                    <MaterialIcons
                                        name="send"
                                        size={20}
                                        color={isConnected && isDataLoaded ? "#fff" : theme.textSecondary}
                                    />
                                </Pressable>
                            ) : (
                                /* Кнопка записи аудио */
                                <Pressable
                                    style={[
                                        styles.audioRecordButton,
                                        {
                                            backgroundColor: isConnected && isDataLoaded ? theme.primary : theme.placeholder,
                                            opacity: isConnected && isDataLoaded ? 1 : 0.5
                                        }
                                    ]}
                                    onPress={startAudioRecording}
                                    disabled={!isConnected || !isDataLoaded}
                                >
                                    <MaterialIcons
                                        name="mic"
                                        size={24}
                                        color="white"
                                    />
                                </Pressable>
                            )}
                        </>
                    )}
                </View>

                {/* Просмотрщик изображений с поддержкой масштабирования */}
                <Modal
                    visible={isImageViewerVisible}
                    transparent={true}
                    animationType="fade"
                    onRequestClose={closeImageViewer}
                    statusBarTransluceholder="true"
                >
                    <GestureHandlerRootView style={{flex: 1}}>
                        <View style={styles.imageViewerContainer}>
                            <TouchableOpacity
                                style={styles.imageViewerCloseButton}
                                onPress={closeImageViewer}
                            >
                                <MaterialIcons name="close" size={32} color="white" />
                            </TouchableOpacity>

                            {/* Кнопка скачивания изображения в полноэкранном режиме */}
                            {selectedImage && (
                                <TouchableOpacity
                                    style={styles.imageFullscreenDownloadButton}
                                    onPress={() => {
                                        const messageId = messages.find(msg => 
                                            (msg.serverFileUrl === selectedImage || 
                                            (msg.mediaBase64 && `data:image/jpeg;base64,${msg.mediaBase64}` === selectedImage))
                                        )?.id;
                                        if (messageId) {
                                            downloadImage(selectedImage, Number(messageId));
                                        }
                                    }}
                                >
                                    <MaterialIcons name="ios-share" size={32} color="white" />
                                </TouchableOpacity>
                            )}

                            {/* Индикатор масштаба */}
                            {zoomLevel > 0 && (
                                <View style={styles.imageZoomIndicator}>
                                    <Text style={styles.imageZoomText}>
                                        {zoomLevel === 1 ? '1.5x' : '2.5x'}
                                    </Text>
                                </View>
                            )}

                            {/* Подсказка для пользователя */}
                            <View style={styles.imageHintContainer}>
                                <Text style={styles.imageHintText}>
                                    Двойной тап: 1x → 1.5x → 2.5x → 1x • Pinch для масштаба • Свайп для перемещения
                                </Text>
                            </View>

                            {/* Контент с жестами */}
                            <View style={styles.imageModalContent}>
                                {selectedImage && (
                                    <GestureDetector gesture={combinedGesture}>
                                        <View style={styles.imageContainer}>
                                            <Animated.Image
                                                source={{uri: selectedImage}}
                                                style={[styles.fullScreenImage, animatedImageStyle]}
                                                resizeMode="contain"
                                                onLoad={() => {
                                                    console.log('🖼️ [IMAGE-VIEWER] Image loaded for fullscreen view');
                                                }}
                                                onError={(error) => {
                                                    console.error('🖼️ [IMAGE-VIEWER] Image load error:', error);
                                                }}
                                            />
                                        </View>
                                    </GestureDetector>
                                )}
                            </View>
                        </View>
                    </GestureHandlerRootView>
                </Modal>

                {/* Полноэкранный видеоплеер */}
                <Modal
                    visible={isVideoViewerVisible}
                    transparent={false}
                    animationType="slide"
                    onRequestClose={() => setIsVideoViewerVisible(false)}
                >
                    <View style={styles.videoViewerContainer}>
                        {selectedVideo && (
                            <Video
                                ref={videoRef}
                                source={{ uri: selectedVideo }}
                                style={styles.fullScreenVideo}
                                resizeMode={ResizeMode.CONTAIN}
                                useNativeControls={true}
                                shouldPlay={true}
                                isLooping={false}
                                isMuted={false}
                                onLoad={(data) => {
                                    console.log('🎥 [FULLSCREEN] Video loaded:', {
                                        duration: data.durationMillis,
                                        naturalSize: data.naturalSize,
                                        uri: selectedVideo?.substring(selectedVideo.lastIndexOf('/') + 1)
                                    });

                                    console.log('🎥 [FULLSCREEN] Video ready with native controls');
                                }}
                                onError={(error) => {
                                    console.error('🎥 [FULLSCREEN] ❌ Video decoder error:', {
                                        error: error,
                                        uri: selectedVideo?.substring(selectedVideo.lastIndexOf('/') + 1),
                                        uriType: selectedVideo?.startsWith('data:') ? 'base64' :
                                                 selectedVideo?.startsWith('http') ? 'url' : 'file',
                                        fullUri: selectedVideo,
                                        isCodecError: error?.error?.includes('MediaCodecRenderer') ||
                                                     error?.error?.includes('Decoder')
                                    });

                                    const isCodecError = error?.error?.includes('MediaCodecRenderer') ||
                                                       error?.error?.includes('Decoder init failed');

                                    if (isCodecError) {
                                        // Автоматически пытаемся открыть в браузере для HTTP видео
                                        if (selectedVideo?.startsWith('http')) {
                                            console.log('🎥 [AUTO-BROWSER] Auto-opening codec-problematic video in browser');
                                            openVideoInBrowser(selectedVideo).then(() => {
                                                setIsVideoViewerVisible(false);
                                            }).catch((browserError) => {
                                                console.error('🎥 [AUTO-BROWSER] Auto-browser failed:', browserError);

                                                Alert.alert(
                                                    'Проблема с кодеком видео',
                                                    `Встроенный плеер не поддерживает кодеки этого видео.\n\n` +
                                                    `Ошибка: ${error?.error?.split(':')[0] || 'Неизвестная ошибка декодера'}\n\n` +
                                                    `Попробуйте открыть в браузере.`,
                                                    [
                                                        { text: 'Закрыть', onPress: () => setIsVideoViewerVisible(false) },
                                                        {
                                                            text: 'Открыть в браузере',
                                                            onPress: async () => {
                                                                try {
                                                                    await openVideoInBrowser(selectedVideo);
                                                                    setIsVideoViewerVisible(false);
                                                                } catch (retryError) {
                                                                    console.error('🎥 [RETRY-BROWSER] Browser retry failed:', retryError);
                                                                    setIsVideoViewerVisible(false);
                                                                }
                                                            }
                                                        }
                                                    ]
                                                );
                                            });
                                            return;
                                        }

                                        Alert.alert(
                                            'Проблема с кодеком видео',
                                            `Встроенный плеер не поддерживает кодеки этого видео.\n\n` +
                                            `Ошибка: ${error?.error?.split(':')[0] || 'Неизвестная ошибка декодера'}\n\n` +
                                            `${selectedVideo?.startsWith('http') ? 'Попробуем открыть в браузере.' : 'Попробуйте системный плеер.'}`,
                                            [
                                                { text: 'Закрыть', onPress: () => setIsVideoViewerVisible(false) },
                                                selectedVideo?.startsWith('http') ? {
                                                    text: 'Открыть в браузере',
                                                    onPress: async () => {
                                                        try {
                                                            await openVideoInBrowser(selectedVideo);
                                                            setIsVideoViewerVisible(false);
                                                        } catch (retryError) {
                                                            console.error('🎥 [MANUAL-BROWSER] Manual browser open failed:', retryError);
                                                            setIsVideoViewerVisible(false);
                                                        }
                                                    }
                                                } : {
                                                    text: 'Системный плеер',
                                                    onPress: async () => {
                                                        try {
                                                            await openInSystemPlayer(selectedVideo);
                                                            setIsVideoViewerVisible(false);
                                                        } catch (retryError) {
                                                            console.error('🎥 [MANUAL-PLAYER] Manual player open failed:', retryError);
                                                            setIsVideoViewerVisible(false);
                                                        }
                                                    }
                                                }
                                            ]
                                        );
                                    } else {
                                        Alert.alert(
                                            'Ошибка воспроизведения',
                                            `Не удалось воспроизвести видео.\n\nТип: ${selectedVideo?.startsWith('data:') ? 'Base64' : selectedVideo?.startsWith('http') ? 'URL' : 'Файл'}\n\nОшибка: ${error?.error || 'Неизвестная ошибка'}`,
                                            [
                                                { text: 'Закрыть', onPress: () => setIsVideoViewerVisible(false) },
                                                {
                                                    text: 'Попробовать в браузере',
                                                    onPress: async () => {
                                                        try {
                                                            if (selectedVideo?.startsWith('http')) {
                                                                const { WebBrowser } = await import('expo-web-browser');
                                                                await WebBrowser.openBrowserAsync(selectedVideo);
                                                            } else {
                                                                Alert.alert('Ошибка', 'Можно открыть только URL в браузере');
                                                            }
                                                        } catch (browserError) {
                                                            console.error('Browser error:', browserError);
                                                            Alert.alert('Ошибка', 'Не удалось открыть в браузере');
                                                        }
                                                        setIsVideoViewerVisible(false);
                                                    }
                                                }
                                            ]
                                        );
                                    }
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

                {/* Модальное окно для полноэкранного инлайн видео */}
                <Modal
                    visible={isFullscreenModalVisible}
                    transparent={false}
                    animationType="fade"
                    onRequestClose={() => {
                        setIsFullscreenModalVisible(false);
                        setFullscreenModalVideoUri(null);
                        setSelectedVideo(null);
                        setSelectedMessageId(null);
                    }}
                >
                    <View style={styles.fullscreenModalContainer}>
                        <TouchableOpacity
                            style={styles.fullscreenModalCloseButton}
                            onPress={() => {
                                setIsFullscreenModalVisible(false);
                                setFullscreenModalVideoUri(null);
                                setSelectedVideo(null);
                                setSelectedMessageId(null);
                            }}
                        >
                            <MaterialIcons name="close" size={32} color="white" />
                        </TouchableOpacity>

                        {/* Кнопки управления для fullscreen modal */}
                        {fullscreenModalVideoUri && (
                            <>
                                {/* Кнопка скачивания */}
                                <TouchableOpacity
                                    style={styles.videoDownloadButtonFullscreen}
                                    onPress={() => {
                                        if (fullscreenModalVideoUri && selectedMessageId) {
                                            downloadVideo(fullscreenModalVideoUri, selectedMessageId);
                                        }
                                    }}
                                >
                                    <MaterialIcons name="ios-share" size={32} color="white" />
                                </TouchableOpacity>


                            </>
                        )}

                        {fullscreenModalVideoUri && (
                            <Video
                                source={{ uri: fullscreenModalVideoUri }}
                                style={styles.fullscreenModalVideo}
                                resizeMode={ResizeMode.CONTAIN}
                                useNativeControls={true}
                                shouldPlay={true}
                                isLooping={false}
                                onLoad={(data) => {
                                    console.log('🎥 [FULLSCREEN-MODAL] Video loaded:', {
                                        duration: data.durationMillis,
                                        naturalSize: data.naturalSize
                                    });
                                }}
                                onError={(error) => {
                                    console.error('🎥 [FULLSCREEN-MODAL] Video error:', error);

                                    // Проверяем тип ошибки
                                    const errorString = error?.error?.toString() || '';
                                    const isDecoderError = errorString.includes('MediaCodecRenderer') ||
                                                          errorString.includes('Decoder init failed') ||
                                                          errorString.includes('DecoderInitializationException');

                                    if (isDecoderError && fullscreenModalVideoUri?.startsWith('http')) {
                                        // Автоматически открываем в браузере для видео с проблемными кодеками
                                        console.log('🎥 [AUTO-FALLBACK] Opening video in browser due to decoder error');

                                        Alert.alert(
                                            'Несовместимый кодек',
                                            'Видео использует кодек, который не поддерживается устройством. Открыть в браузере?',
                                            [
                                                {
                                                    text: 'Отмена',
                                                    style: 'cancel',
                                                    onPress: () => {
                                                        setIsFullscreenModalVisible(false);
                                                        setFullscreenModalVideoUri(null);
                                                    }
                                                },
                                                {
                                                    text: 'Открыть в браузере',
                                                    onPress: async () => {
                                                        try {
                                                            await WebBrowser.openBrowserAsync(fullscreenModalVideoUri, {
                                                                presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
                                                                controlsColor: '#007AFF',
                                                                toolbarColor: '#000000',
                                                                enableDefaultShare: true,
                                                                showInRecents: true,
                                                            });
                                                        } catch (browserError) {
                                                            console.error('Browser open failed:', browserError);
                                                        } finally {
                                                            setIsFullscreenModalVisible(false);
                                                            setFullscreenModalVideoUri(null);
                                                        }
                                                    }
                                                }
                                            ]
                                        );
                                    } else {
                                        Alert.alert('Ошибка', 'Не удалось воспроизвести видео в полноэкранном режиме');
                                    }
                                }}
                            />
                        )}

                        {/* Кнопка принудительного воспроизведения */}
                        {!isVideoPlaying && !videoError && (
                            <TouchableOpacity
                                style={styles.forcePlayButton}
                                onPress={async () => {
                                    if (!videoRef.current) return;
                                    try {
                                        if (isVideoPlaying) {
                                            await videoRef.current.pauseAsync();
                                            setIsVideoPlaying(false);
                                        } else {
                                            await videoRef.current.playAsync();
                                            setIsVideoPlaying(true);
                                        }
                                    } catch (e) {
                                        console.error('🎥 [FULLSCREEN] ❌ Error toggling playback from central button:', e);
                                        Alert.alert('Ошибка', 'Не удалось изменить состояние воспроизведения');
                                    }
                                }}
                            >

                            </TouchableOpacity>
                        )}



                        {/* Кнопка скачивания видео - рядом с кнопкой звука */}
                        <TouchableOpacity
                            style={styles.videoDownloadButtonFullscreen}
                            onPress={() => {
                                console.log('🎥 [DOWNLOAD] ========== DOWNLOAD BUTTON PRESSED ==========');
                                console.log('🎥 [DOWNLOAD] Selected video:', selectedVideo);
                                console.log('🎥 [DOWNLOAD] Selected message ID:', selectedMessageId);

                                let messageId = selectedMessageId;
                                if (!messageId) {
                                    const foundMessage = messages.find(msg => 
                                        msg.serverFileUrl === selectedVideo || 
                                        msg.mediaUri === selectedVideo ||
                                        (msg.mediaBase64 && `data:video/mp4;base64,${msg.mediaBase64}` === selectedVideo)
                                    );
                                    messageId = foundMessage ? Number(foundMessage.id) : Date.now();
                                    console.log('🎥 [DOWNLOAD] Found message ID:', messageId);
                                }

                                if (selectedVideo) {
                                    downloadVideo(selectedVideo, messageId);
                                } else {
                                    console.error('🎥 [DOWNLOAD] No selected video!');
                                    Alert.alert('Ошибка', 'Видео недоступно для скачивания');
                                }
                            }}
                        >
                            <MaterialIcons name="ios-share" size={32} color="white" />
                        </TouchableOpacity>



                        {/* Отображение ошибки */}
                        {videoError && (
                            <View style={styles.videoErrorContainer}>
                                <MaterialIcons name="error" size={48} color="red" />
                                <Text style={styles.videoErrorText}>Ошибка воспроизведения:</Text>
                                <Text style={styles.videoErrorDetails}>{videoError}</Text>
                                <TouchableOpacity
                                    style={styles.retryButton}
                                    onPress={() => {
                                        setVideoError(null);
                                        setIsVideoPlaying(false);
                                    }}
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



                    </View>
                </Modal>
            </KeyboardAvoidingView>
        </View>
    );
}

const createStyles = (theme: any) => {
    const screenDimensions = Dimensions.get('screen');

    return StyleSheet.create({
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
        marginVertical: 2,
        padding: 6,
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
    unreadMessage: {
        backgroundColor: 'rgba(255, 215, 0, 0.15)', // Легкий золотистый фон
        borderColor: 'rgba(255, 215, 0, 0.3)',
        borderWidth: 2,
    },
    senderName: {
        fontSize: 10,
        marginBottom: 2,
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
        fontSize: 9,
        marginTop: 2,
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
        borderRadius: 1,
        overflow: 'hidden',
    },
    messageImage: {
        width: 200,
        minHeight: 100,
        maxHeight: 300,
        borderRadius: 1,
    },
    messageVideo: {
        width: 200,
        height: 150,
        borderRadius: 8,
    },
    mediaMessage: {
        maxWidth: '85%',
        borderWidth: 0,
        borderColor: 'transparent',
    },
    mediaMessageText: {
        fontSize: 12,
        fontStyle: 'normal',
        marginTop: 4,
    },
    imageViewerContainer: {
        flex: 1,
        backgroundColor: 'black',
        justifyContent: 'center',
        alignItems: 'center',
    },
    imageViewerCloseButton: {
        position: 'absolute',
        top: 60,
        right: 20,
        zIndex: 10,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 25,
        padding: 8,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    imageZoomIndicator: {
        position: 'absolute',
        top: 60,
        left: 20,
        zIndex: 9,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 15,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    imageZoomText: {
        color: 'white',
        fontSize: 14,
        fontWeight: 'bold',
    },
    imageHintContainer: {
        position: 'absolute',
        bottom: 60,
        left: 20,
        right: 20,
        zIndex: 9,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 8,
        alignItems: 'center',
    },
    imageHintText: {
        color: 'rgba(255, 255, 255, 0.8)',
        fontSize: 12,
        textAlign: 'center',
        fontStyle: 'italic',
    },
    imageModalContent: {
        flex: 1,
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    imageContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
    },
    fullScreenImage: {
        width: '100%',
        height: '100%',
    },
    videoPlayOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.05)', // почти прозрачен
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
        zIndex: 1000,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 25,
        padding: 8,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.5,
        shadowRadius: 4,
    },
    videoDownloadButtonFullscreen: {
        position: 'absolute',
        top: 50,
        left: 20,
        zIndex: 1000,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 25,
        padding: 8,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.5,
        shadowRadius: 4,
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
    imageFullscreenDownloadButton: {
        position: 'absolute',
        top: 60,
        left: 20,
        zIndex: 10,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 25,
        padding: 8,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    fileContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 8,
        padding: 8,
        borderRadius: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.1)',
        minHeight: 60,
        width: 220,
    },
    fileIconContainer: {
        marginRight: 8,
        marginTop: 2,
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        borderRadius: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
    },
    fileInfo: {
        flex: 1,
        marginRight: 4,
    },
    fileName: {
        fontSize: 13,
        fontWeight: '500',
        marginBottom: 2,
        flexWrap: 'wrap',
    },
    fileSize: {
        fontSize: 12,
        marginBottom: 1,
    },
    fileMimeType: {
        fontSize: 10,
        fontStyle: 'italic',
    },
    fileContainerDownloading: {
        opacity: 0.7,
        borderColor: theme.primary,
        borderWidth: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.02)',
    },
    downloadProgressContainer: {
        marginTop: 6,
        width: '100%',
    },
    downloadProgressBar: {
        height: 3,
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 2,
    },
    downloadProgressFill: {
        height: '100%',
        borderRadius: 2,
    },
    downloadProgressText: {
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
        top: 50,
        left: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        padding: 10,
        borderRadius: 25,
        zIndex: 1000,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.5,
        shadowRadius: 4,
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
    browserButton: {
        position: 'absolute',
        top: 50,
        left: 140,
        backgroundColor: 'rgba(0, 123, 255, 0.8)',
        padding: 10,
        borderRadius: 25,
        zIndex: 1000,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.5,
        shadowRadius: 4,
    },
    systemPlayerButton: {
        position: 'absolute',
        top: 50,
        left: 200,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        padding: 10,
        borderRadius: 25,
        zIndex: 1000,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.5,
        shadowRadius: 4,
    },
    // Стили для встроенного видеоплеера
    inlineVideoContainer: {
        position: 'relative',
        marginBottom: 8,
        borderRadius: 8,
        overflow: 'visible',
        maxWidth: '100%',
        width: 250,
        height: 180,                  // фиксированная высота, как было изначально
        borderWidth: 0.5,
        borderColor: 'transparent',
        borderStyle: 'solid',
    },
    inlineVideo: {
        width: '100%',
        height: '100%',
        borderRadius: 8,
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
    // Новые стили для полноэкранного режима на весь экран устройства
    deviceFullscreenVideoContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2000, // Выше чем обычный полноэкранный режим
        backgroundColor: 'black',
        marginBottom: 0,
        borderRadius: 0,
    },
    deviceFullscreenVideo: {
        width: '100%',
        height: '100%',
        borderRadius: 0,
    },
    // Стили для модального полноэкранного видео
    fullscreenModalContainer: {
        flex: 1,
        backgroundColor: 'black',
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullscreenModalVideo: {
        width: '100%',
        height: '100%',
    },
    fullscreenModalCloseButton: {
        position: 'absolute',
        top: 50,
        right: 20,
        zIndex: 10,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 25,
        padding: 10,
    },
    fullscreenModeControls: {
        position: 'absolute',
        bottom: 100,
        right: 20,
        flexDirection: 'row',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderRadius: 25,
        padding: 8,
        zIndex: 2001, // Выше видео контейнера
    },
    inlineVideoControls: {
        position: 'absolute',
        bottom: 6,
        right: 6,
        flexDirection: 'row',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderRadius: 18,
        padding: 3,
        zIndex: 2,
        maxWidth: '90%', // Ограничиваем ширину контролов
    },
    fullscreenVideoControls: {
        position: 'absolute',
        bottom: 60,
        right: 20,
        flexDirection: 'row',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderRadius: 25,
        padding: 8,
        zIndex: 2,
    },
    inlineVideoButton: {
        padding: 5,
        marginHorizontal: 1,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 26,
        minHeight: 26,
    },
    videoProgressContainerSimple: {
        marginTop: 8,               // небольшое отступление от кнопок
        marginHorizontal: 6,       // отступы по бокам, чтобы не прилипало к краям
    },
    videoProgressBar: {
        height: 3,
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
        top: -8,
        bottom: -8,
        left: 0,
        right: 0,
    },
    // Текущий стиль теперь просто контейнер без абсолютного позиционирования
    videoTimeContainer: {
        // Сохранён для совместимости, но не используется в рендере
    },

    // Новый простой стиль для времени под прогресс‑баром
    videoTimeContainerSimple: {
        marginTop: 4,
        marginHorizontal: 6,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 3,
        alignSelf: 'flex-start',
    },
    videoTimeText: {
        color: 'white',
        fontSize: 10,
        fontFamily: 'monospace',
    },
    fullscreenPlayOverlay: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: [{ translateX: -40 }, { translateY: -40 }],
        zIndex: 3,
    },
    fullscreenCloseButton: {
        position: 'absolute',
        top: 60,
        right: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 20,
        padding: 8,
        zIndex: 10, // Поверх всех элементов
    },
    // Стили для превью видео (ленивая загрузка)
    videoPreviewContainer: {
        marginBottom: 8,
        borderRadius: 12,
        backgroundColor: theme.surface,
        borderWidth: 0.5,           // почти незаметная граница
        borderColor: 'transparent', // полностью прозрачная
        borderStyle: 'solid',
        padding: 16,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 110,
        maxWidth: '100%',
        width: 250, // Соответствует ширине инлайн видео
    },
    videoPreviewContent: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    videoPreviewTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        marginTop: 8,
        marginBottom: 4,
    },
    videoPreviewSize: {
        fontSize: 14,
        marginBottom: 8,
    },
    videoPreviewHint: {
        fontSize: 12,
        fontStyle: 'italic',
        textAlign: 'center',
    },
    videoPreviewNote: {
        fontSize: 10,
        fontStyle: 'italic',
        textAlign: 'center',
        marginTop: 4,
        opacity: 0.7,
    },
    // Стили для индикатора загрузки видео
    videoLoadingContainer: {
        marginBottom: 8,
        borderRadius: 12,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 16,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 110,
        maxWidth: '100%',
        width: 250, // Соответствует ширине инлайн видео
    },
    videoLoadingText: {
        fontSize: 14,
        marginTop: 12,
        marginBottom: 4,
    },
    videoLoadingSize: {
        fontSize: 12,
    },
    // Стили для аудио записи
    recordingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        paddingVertical: 8,
    },
    cancelRecordButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendRecordButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    recordingIndicator: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 16,
    },
    recordingDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#ff4444',
        marginRight: 8,
    },
    recordingText: {
        fontSize: 18,
        fontWeight: 'bold',
        fontFamily: 'monospace',
    },
    audioRecordButton: {
        justifyContent: 'center',
        alignItems: 'center',
        width: 44,
        height: 44,
        borderRadius: 22,
    },
    // Стили для аудио плеера
    audioContainer: {
        marginBottom: 8,
        borderRadius: 12,
        overflow: 'hidden',
    },
    audioPlayerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 8,
        borderRadius: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        minWidth: 200,
    },
    audioPlayButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
    },
    audioWaveform: {
        flex: 1,
    },
    audioProgressBar: {
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 4,
    },
    audioProgressFill: {
        height: '100%',
        borderRadius: 2,
    },
    audioDuration: {
        fontSize: 12,
    },
    audioLoadingText: {
        fontSize: 14,
        marginLeft: 8,
    },
    });
};