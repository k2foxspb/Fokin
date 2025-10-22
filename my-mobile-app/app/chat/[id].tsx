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
    runOnJS,
    withTiming
} from 'react-native-reanimated';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useWebSocket} from '../../hooks/useWebSocket';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {MaterialIcons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {useNotifications} from '../../contexts/NotificationContext';
import DirectImage from '../../components/DirectImage';
import LazyMedia from '../../components/LazyMedia';
import {API_CONFIG} from '../../config';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import {Video, ResizeMode, Audio, AVPlaybackStatus} from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import * as IntentLauncher from 'expo-intent-launcher';
import {useSafeAreaInsets} from "react-native-safe-area-context";

// Интерфейс для фоновых загрузок
interface BackgroundUpload {
    id: string;
    messageId: number;
    roomId: string;
    fileUri: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    mediaType: 'image' | 'video' | 'audio' | 'file';
    status: 'pending' | 'uploading' | 'completed' | 'failed';
    progress: number;
    startTime: number;
    serverUrl?: string;
    error?: string;
}

// Менеджер фоновых загрузок
class BackgroundUploadManager {
    private static instance: BackgroundUploadManager;
    private uploads: Map<string, BackgroundUpload> = new Map();
    private listeners: Set<(uploads: BackgroundUpload[]) => void> = new Set();

    static getInstance(): BackgroundUploadManager {
        if (!BackgroundUploadManager.instance) {
            BackgroundUploadManager.instance = new BackgroundUploadManager();
        }
        return BackgroundUploadManager.instance;
    }

    async saveUpload(upload: BackgroundUpload): Promise<void> {
        this.uploads.set(upload.id, upload);
        await this.persistUploads();
        this.notifyListeners();
    }

    async updateUpload(id: string, updates: Partial<BackgroundUpload>): Promise<void> {
        const upload = this.uploads.get(id);
        if (upload) {
            Object.assign(upload, updates);
            await this.persistUploads();
            this.notifyListeners();
        }
    }

    async removeUpload(id: string): Promise<void> {
        this.uploads.delete(id);
        await this.persistUploads();
        this.notifyListeners();
    }

    getUpload(id: string): BackgroundUpload | undefined {
        return this.uploads.get(id);
    }

    getUploadsForRoom(roomId: string): BackgroundUpload[] {
        return Array.from(this.uploads.values()).filter(upload => upload.roomId === roomId);
    }

    getAllUploads(): BackgroundUpload[] {
        return Array.from(this.uploads.values());
    }

    addListener(listener: (uploads: BackgroundUpload[]) => void): void {
        this.listeners.add(listener);
    }

    removeListener(listener: (uploads: BackgroundUpload[]) => void): void {
        this.listeners.delete(listener);
    }

    private notifyListeners(): void {
        const uploads = this.getAllUploads();
        this.listeners.forEach(listener => listener(uploads));
    }

    private async persistUploads(): Promise<void> {
        try {
            const uploadsData = JSON.stringify(Array.from(this.uploads.entries()));
            await AsyncStorage.setItem('backgroundUploads', uploadsData);
        } catch (error) {
            console.error('📤 [BACKGROUND] Failed to persist uploads:', error);
        }
    }

    async loadUploads(): Promise<void> {
        try {
            const uploadsData = await AsyncStorage.getItem('backgroundUploads');
            if (uploadsData) {
                const uploadsArray = JSON.parse(uploadsData);
                this.uploads = new Map(uploadsArray);
                console.log('📤 [BACKGROUND] Loaded', this.uploads.size, 'uploads from storage');
            }
        } catch (error) {
            console.error('📤 [BACKGROUND] Failed to load uploads:', error);
        }
    }

    async cleanupOldUploads(): Promise<void> {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 часа
        let cleaned = 0;

        for (const [id, upload] of this.uploads.entries()) {
            if (now - upload.startTime > maxAge && (upload.status === 'completed' || upload.status === 'failed')) {
                this.uploads.delete(id);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            await this.persistUploads();
            console.log('📤 [BACKGROUND] Cleaned up', cleaned, 'old uploads');
        }
    }
}

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
    // Новые поля для мягкого удаления
    deletedForUsers?: number[];
    deletedAt?: number;
    isDeletedForMe?: boolean;
    isDeletedByOther?: boolean;
    deletedByUsername?: string;
    // Флаг процесса удаления
    isDeleting?: boolean;
    // Поля для оптимистичных сообщений
    _isOptimistic?: boolean;
    _optimisticId?: number;
    // Поле для новых непрочитанных сообщений
    _isNewUnread?: boolean;
    // Поле для непрочитанных отправленных сообщений из истории
    _isUnreadBySender?: boolean;
    // Серверное поле статуса прочтения
    is_read_by_recipient?: boolean;
    // Статус прочтения сообщения
    read?: boolean;
    read_at?: string;
    // Поля для реплаев
    reply_to_message_id?: number;
    reply_to_message?: string;
    reply_to_sender?: string;
    reply_to_media_type?: string;
    // Поле для временной подсветки при скролле
    _highlighted?: boolean;
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
    const {theme} = useTheme();
    const {userStatuses} = useNotifications();
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
    const [inlineVideoStates, setInlineVideoStates] = useState<{
        [key: string]: {
            isPlaying: boolean,
            isMuted: boolean,
            isExpanded: boolean,
            duration: number,
            position: number,
            isLoaded: boolean,
            isFullscreen: boolean,
            isResetting?: boolean
        }
    }>({});
    const [fullscreenModalVideoUri, setFullscreenModalVideoUri] = useState<string | null>(null);
    const [isFullscreenModalVisible, setIsFullscreenModalVisible] = useState(false);
    const [downloadingDocuments, setDownloadingDocuments] = useState<{ [key: number]: boolean }>({});
    const [documentDownloadProgress, setDocumentDownloadProgress] = useState<{ [key: number]: number }>({});

    // Состояния для фоновых загрузок
    const [backgroundUploads, setBackgroundUploads] = useState<BackgroundUpload[]>([]);
    const backgroundUploadManager = BackgroundUploadManager.getInstance();

    // Состояния для записи аудио
    const [isRecordingAudio, setIsRecordingAudio] = useState(false);

    // Флаг для отслеживания активности компонента чата
    const [isChatActive, setIsChatActive] = useState(false); // ИСПРАВЛЕНИЕ: начинаем с false

    // Флаг для отслеживания "холодного старта" чата (открытие из уведомления/другой части приложения)
    const [isColdStart, setIsColdStart] = useState(true);

    // Таймер для задержки активации чата
    const chatActivationTimer = useRef<NodeJS.Timeout | null>(null);

    // Кеш для отслеживания уже помеченных сообщений (предотвращение дублирования)
    const markedAsReadCache = useRef<Set<number>>(new Set());
    // Состояние для отслеживания непрочитанных сообщений с анимацией
    const [unreadMessages, setUnreadMessages] = useState<Set<number>>(new Set());
    const unreadAnimations = useRef<{ [key: number]: Animated.Value }>({});
    // Состояние для отслеживания непрочитанных ОТПРАВЛЕННЫХ сообщений
    const [unreadSentMessages, setUnreadSentMessages] = useState<Set<number>>(new Set());
    const unreadSentAnimations = useRef<{ [key: number]: Animated.Value }>({});
    // Очередь для сообщений, полученных до инициализации
    const pendingMessagesQueue = useRef<Array<{ messageId: number, senderId: number }>>([]);
    // Ref'ы для актуальных значений состояний (для использования в WebSocket колбэках)
    const currentUserIdRef = useRef<number | null>(null);
    const isDataLoadedRef = useRef<boolean>(false);
    const isConnectedRef = useRef<boolean>(false);
    const isChatActiveRef = useRef<boolean>(false);
    const isColdStartRef = useRef<boolean>(true);
    const [audioRecording, setAudioRecording] = useState<Audio.Recording | null>(null);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [audioPermissionGranted, setAudioPermissionGranted] = useState(false);
    const [playingAudioId, setPlayingAudioId] = useState<number | null>(null);
    const [audioPlaybackStates, setAudioPlaybackStates] = useState<{
        [key: number]: {
            isPlaying: boolean;
            position: number;
            duration: number;
            sound: Audio.Sound | null;
        }
    }>({});

    // Состояния для выделения сообщений
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());

    // Состояния для реплаев
    const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);

    const flatListRef = useRef<FlatList>(null);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const videoRef = useRef<any>(null);
    const inlineVideoRefs = useRef<{ [key: string]: any }>({});

    const router = useRouter();

    const updateMessageSafely = (messageId: number | string, updates: Partial<Message>) => {
        setMessages(prev =>
            prev.map(msg => msg.id === messageId ? {...msg, ...updates} : msg)
        );
    };

    // Состояние для индикации загрузки сообщения
    const [isLoadingReplyMessage, setIsLoadingReplyMessage] = useState(false);

    // Функция для загрузки дополнительных страниц истории до нахождения сообщения
    const loadHistoryUntilMessage = async (targetMessageId: number): Promise<boolean> => {
        console.log('🔍 [LOAD-HISTORY] Starting to load history until message:', targetMessageId);

        let currentPage = page + 1;
        const maxPages = 20; // Максимум 20 страниц (300 сообщений)
        let found = false;

        while (currentPage <= maxPages && !found) {
            console.log('🔍 [LOAD-HISTORY] Loading page:', currentPage);

            try {
                const token = await getToken();
                if (!token) {
                    console.error('🔍 [LOAD-HISTORY] No token available');
                    return false;
                }

                const response = await axios.get(
                    `${API_CONFIG.BASE_URL}/profile/api/chat_history/${roomId}/`,
                    {
                        headers: {
                            'Authorization': `Token ${token}`,
                            'Content-Type': 'application/json',
                        },
                        params: {
                            page: currentPage,
                            limit: 15
                        }
                    }
                );

                if (response.data?.messages && response.data.messages.length > 0) {
                    const processedMessages = response.data.messages.map((msg: any) => {
                        const isMyMessage = msg.sender_id === currentUserId;
                        const messageTime = new Date(msg.timestamp * 1000);
                        const now = new Date();
                        const hoursAgo = (now.getTime() - messageTime.getTime()) / (1000 * 60 * 60);
                        const isUnreadBySender = isMyMessage && hoursAgo <= 48;

                        const replyToMessageId = msg.reply_to_message_id || msg.replyToMessageId || null;
                        const replyToMessage = msg.reply_to_message || msg.replyToMessage || msg.reply_message || null;
                        const replyToSender = msg.reply_to_sender || msg.replyToSender || msg.reply_sender || null;
                        const replyToMediaType = msg.reply_to_media_type || msg.replyToMediaType || msg.reply_media_type || null;

                        return {
                            ...msg,
                            mediaType: msg.mediaType || msg.media_type || null,
                            mediaHash: msg.mediaHash || msg.media_hash || null,
                            mediaFileName: msg.mediaFileName || msg.media_filename || null,
                            mediaSize: msg.mediaSize || msg.media_size || null,
                            mediaBase64: null,
                            serverFileUrl: null,
                            isLoadingServerUrl: false,
                            needsReload: false,
                            _isUnreadBySender: isUnreadBySender,
                            reply_to_message_id: replyToMessageId,
                            reply_to_message: replyToMessage,
                            reply_to_sender: replyToSender,
                            reply_to_media_type: replyToMediaType
                        };
                    });

                    // Добавляем новые сообщения в конец списка
                    setMessages(prev => [...prev, ...processedMessages]);
                    setPage(currentPage);

                    // Проверяем, нашли ли целевое сообщение
                    found = processedMessages.some((msg: any) => msg.id === targetMessageId);

                    if (found) {
                        console.log('🔍 [LOAD-HISTORY] ✅ Target message found on page:', currentPage);
                        return true;
                    }

                    // Если страница неполная, значит достигнут конец истории
                    if (processedMessages.length < 15) {
                        console.log('🔍 [LOAD-HISTORY] Reached end of history without finding message');
                        return false;
                    }
                } else {
                    console.log('🔍 [LOAD-HISTORY] No more messages available');
                    return false;
                }

                currentPage++;
            } catch (error) {
                console.error('🔍 [LOAD-HISTORY] ❌ Error loading page:', currentPage, error);
                return false;
            }
        }

        console.log('🔍 [LOAD-HISTORY] Reached max pages without finding message');
        return false;
    };

    // Функция для прокрутки к конкретному сообщению
    const scrollToMessage = useCallback(async (messageId: number) => {
        console.log('🔍 [SCROLL] Attempting to scroll to message:', messageId);

        // Сначала проверяем, загружено ли сообщение
        let messageIndex = messages.findIndex(msg => msg.id === messageId);

        if (messageIndex === -1) {
            console.warn('🔍 [SCROLL] ⚠️ Message not found in current messages, attempting to load history...');

            // Показываем индикатор загрузки
            setIsLoadingReplyMessage(true);

            try {
                // Пытаемся загрузить историю до нахождения сообщения
                const found = await loadHistoryUntilMessage(messageId);

                if (!found) {
                    console.error('🔍 [SCROLL] ❌ Message not found even after loading history');
                    Alert.alert(
                        'Сообщение не найдено',
                        'Сообщение могло быть удалено или находится слишком далеко в истории.'
                    );
                    setIsLoadingReplyMessage(false);
                    return;
                }

                // КРИТИЧНО: Ждем обновления состояния после загрузки истории
                // React обновляет состояние асинхронно, поэтому нужны повторные попытки
                console.log('🔍 [SCROLL] History loaded, waiting for state update...');

                let attempts = 0;
                const maxAttempts = 10;
                const retryInterval = 200; // 200мс между попытками

                while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, retryInterval));

                    // Используем колбэк setMessages чтобы получить актуальное состояние
                    let foundIndex = -1;
                    setMessages(currentMessages => {
                        foundIndex = currentMessages.findIndex(msg => msg.id === messageId);
                        console.log(`🔍 [SCROLL] Attempt ${attempts + 1}/${maxAttempts}: index = ${foundIndex}`);
                        return currentMessages; // Не изменяем состояние
                    });

                    if (foundIndex !== -1) {
                        messageIndex = foundIndex;
                        console.log('🔍 [SCROLL] ✅ Message found after', attempts + 1, 'attempts');
                        break;
                    }

                    attempts++;
                }

                if (messageIndex === -1) {
                    console.error('🔍 [SCROLL] ❌ Message still not found after', maxAttempts, 'attempts');
                    Alert.alert('Ошибка', 'Не удалось найти сообщение после загрузки');
                    setIsLoadingReplyMessage(false);
                    return;
                }
            } catch (error) {
                console.error('🔍 [SCROLL] ❌ Error loading history:', error);
                Alert.alert('Ошибка', 'Не удалось загрузить сообщение');
                setIsLoadingReplyMessage(false);
                return;
            } finally {
                setIsLoadingReplyMessage(false);
            }
        }

        if (messageIndex === -1) {
            console.error('🔍 [SCROLL] ❌ Message still not found after all attempts');
            return;
        }

        console.log('🔍 [SCROLL] Found message at index:', messageIndex);

        try {
            // Прокручиваем к сообщению
            flatListRef.current?.scrollToIndex({
                index: messageIndex,
                animated: true,
                viewPosition: 0.5 // Располагаем сообщение по центру экрана
            });

            // Добавляем временную подсветку для визуальной индикации
            setTimeout(() => {
                setMessages(prev =>
                    prev.map(msg =>
                        msg.id === messageId
                            ? { ...msg, _highlighted: true }
                            : msg
                    )
                );

                // Убираем подсветку через 2 секунды
                setTimeout(() => {
                    setMessages(prev =>
                        prev.map(msg =>
                            msg.id === messageId
                                ? { ...msg, _highlighted: false }
                                : msg
                        )
                    );
                }, 2000);
            }, 300);

            console.log('🔍 [SCROLL] ✅ Scrolled to message successfully');
        } catch (error) {
            console.error('🔍 [SCROLL] ❌ Error scrolling to message:', error);
            // Fallback: пробуем прокрутить с offset
            try {
                flatListRef.current?.scrollToOffset({
                    offset: messageIndex * 100, // Примерная высота сообщения
                    animated: true
                });
            } catch (fallbackError) {
                console.error('🔍 [SCROLL] ❌ Fallback scroll also failed:', fallbackError);
            }
        }
    }, [messages, page, roomId, currentUserId]);

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

        // Плавно убираем фоновую подсветку за 2 секунды
        const AnimatedNative = require('react-native').Animated;
        AnimatedNative.timing(unreadAnimations.current[messageId], {
            toValue: 0,
            duration: 2000, // 2 секунды для плавного перехода
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

                // Очищаем флаг нового непрочитанного сообщения
                setMessages(prev =>
                    prev.map(msg =>
                        msg.id === messageId
                            ? {...msg, _isNewUnread: false}
                            : msg
                    )
                );

                // Очищаем анимацию
                delete unreadAnimations.current[messageId];
                console.log('✨ [ANIMATION] Read animation completed for message:', messageId);
            }, 0);
        });
    }, []);

    // Функция для анимированного перехода ОТПРАВЛЕННОГО сообщения в состояние "прочитано получателем"
    // ВАЖНО: Поскольку сервер не предоставляет статус прочтения в истории, мы используем следующую стратегию:
    // 1. При загрузке истории помечаем все свежие (до 48ч) отправленные сообщения как потенциально непрочитанные
    // 2. При получении WebSocket уведомления 'message_read_by_recipient' запускаем эту анимацию
    // 3. Новые отправленные сообщения всегда помечаются как непрочитанные до получения уведомления
    const animateSentMessageAsRead = useCallback((messageId: number) => {
        console.log('📤 [SENT-ANIMATION] Starting read animation for sent message:', messageId);
        console.log('📤 [SENT-ANIMATION] Current unread sent messages:', Array.from(unreadSentMessages));

        // Создаем анимацию затухания фона, если еще не создана
        if (!unreadSentAnimations.current[messageId]) {
            const AnimatedNative = require('react-native').Animated;
            unreadSentAnimations.current[messageId] = new AnimatedNative.Value(1);
            console.log('📤 [SENT-ANIMATION] Created new animation value for sent message:', messageId);
        }

        // Плавно убираем фоновую подсветку за 2 секунды
        const AnimatedNative = require('react-native').Animated;
        AnimatedNative.timing(unreadSentAnimations.current[messageId], {
            toValue: 0,
            duration: 2000, // 2 секунды для плавного перехода
            useNativeDriver: false, // backgroundColor не поддерживает native driver
        }).start(() => {
            // После завершения анимации удаляем сообщение из непрочитанных отправленных
            console.log('📤 [SENT-ANIMATION] Animation finished, removing from unread sent:', messageId);

            setTimeout(() => {
                setUnreadSentMessages(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(messageId);
                    console.log('📤 [SENT-ANIMATION] Updated unread sent messages:', Array.from(newSet));
                    return newSet;
                });

                // Очищаем флаг непрочитанного отправленного сообщения из истории
                setMessages(prev =>
                    prev.map(msg =>
                        msg.id === messageId
                            ? {...msg, _isUnreadBySender: false, is_read_by_recipient: true}
                            : msg
                    )
                );

                // Очищаем анимацию
                delete unreadSentAnimations.current[messageId];
                console.log('📤 [SENT-ANIMATION] Sent message read animation completed for message:', messageId);
            }, 0);
        });
    }, [unreadSentMessages]);

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
                // Синхронизируем в обе стороны
                if (wsConnected && !isConnected) {
                    setIsConnected(true);
                } else if (!wsConnected && isConnected) {
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
    }, [isConnected]);

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

                    // ОТЛАДКА: Логируем все входящие сообщения
                    console.log('📡 [WEBSOCKET] ========== RECEIVED MESSAGE ==========');
                    console.log('📡 [WEBSOCKET] Type:', data.type);
                    console.log('📡 [WEBSOCKET] Data:', JSON.stringify(data, null, 2).substring(0, 500));

                    if (data.type === 'messages_by_sender_update') {
                        return;
                    }

                    if (data.error) {
                        console.error('📡 [WEBSOCKET] ❌ Server error:', data.error);
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

                    // Обработка уведомлений об удалении сообщений от других пользователей
                    if (data.type === 'messages_deleted_notification') {
                        console.log('🗑️ [DELETE-NOTIFICATION] Received deletion notification:', data);

                        const {message_ids, deleted_by_user_id, deleted_by_username, delete_type} = data;
                        const actualCurrentUserId = currentUserIdRef.current;

                        if (message_ids && Array.isArray(message_ids)) {
                            if (delete_type === 'for_everyone' && deleted_by_user_id !== actualCurrentUserId) {
                                // Сообщения удалены для всех - убираем их из UI
                                setMessages(prev => prev.filter(msg => !message_ids.includes(msg.id)));
                                console.log('🗑️ [DELETE-NOTIFICATION] ✅ Messages deleted for everyone');
                            } else if (delete_type === 'for_me' && deleted_by_user_id !== actualCurrentUserId) {
                                // Собеседник удалил сообщения только у себя - показываем пометку
                                setMessages(prev => prev.map(msg => {
                                    if (message_ids.includes(msg.id)) {
                                        console.log('🗑️ [DELETE-NOTIFICATION] Marking message as deleted by other:', {
                                            messageId: msg.id,
                                            isMyMessage: msg.sender_id === actualCurrentUserId,
                                            deletedBy: deleted_by_username
                                        });
                                        return {
                                            ...msg,
                                            deletedForUsers: [...(msg.deletedForUsers || []), deleted_by_user_id],
                                            isDeletedByOther: true,
                                            deletedByUsername: deleted_by_username,
                                            deletedAt: Date.now()
                                        };
                                    }
                                    return msg;
                                }));
                                console.log('🗑️ [DELETE-NOTIFICATION] ✅ Messages marked as deleted by other user');
                            }
                        }
                        return;
                    }

                    // Обработка уведомлений о мягком удалении сообщений (обратная совместимость)
                    if (data.type === 'messages_deleted_by_user') {
                        console.log('🗑️ [DELETE-NOTIFICATION] Received legacy deletion notification:', data);

                        const {message_ids, deleted_by_user_id, deleted_by_username} = data;
                        const actualCurrentUserId = currentUserIdRef.current;

                        if (message_ids && Array.isArray(message_ids)) {
                            setMessages(prev => prev.map(msg => {
                                if (message_ids.includes(msg.id)) {
                                    const updatedMsg = {
                                        ...msg,
                                        deletedForUsers: [...(msg.deletedForUsers || []), deleted_by_user_id]
                                    };

                                    // Если это не мое сообщение и его удалил собеседник
                                    if (deleted_by_user_id !== actualCurrentUserId && msg.sender_id !== actualCurrentUserId) {
                                        updatedMsg.isDeletedByOther = true;
                                        updatedMsg.deletedByUsername = deleted_by_username;
                                        updatedMsg.deletedAt = Date.now();
                                    }

                                    return updatedMsg;
                                }
                                return msg;
                            }));
                        }
                        return;
                    }

                    // Обработка уведомлений о прочтении сообщений получателем
                    if (data.type === 'message_read_by_recipient') {
                        console.log('📖 [READ-NOTIFICATION] Received read notification from recipient:', data);

                        const {message_id, read_by_user_id} = data;
                        const actualCurrentUserId = currentUserIdRef.current;

                        // Проверяем что это уведомление о прочтении нашего сообщения
                        if (message_id && read_by_user_id !== actualCurrentUserId) {
                            console.log('📖 [READ-NOTIFICATION] Our message was read by recipient:', {
                                messageId: message_id,
                                readByUserId: read_by_user_id,
                                ourUserId: actualCurrentUserId
                            });

                            // Запускаем анимацию перехода к прочитанному состоянию
                            animateSentMessageAsRead(message_id);
                        }

                        return;
                    }

                    // Обработка обновления статуса сообщения
                    if (data.type === 'message_status_update') {
                        console.log('📖 [STATUS-UPDATE] Received message status update:', data);

                        const {message_id, read, read_by_user_id} = data;

                        if (message_id) {
                            // Обновляем статус сообщения
                            setMessages(prev =>
                                prev.map(msg =>
                                    msg.id === message_id
                                        ? {...msg, read: read, read_at: read ? new Date().toISOString() : undefined}
                                        : msg
                                )
                            );
                        }

                        return;
                    }

                    // Обработка массовых уведомлений о прочтении
                    if (data.type === 'messages_read_by_recipient') {
                        console.log('📖 [BULK-READ-NOTIFICATION] Received bulk read notification:', data);

                        const {message_ids, read_by_user_id} = data;
                        const actualCurrentUserId = currentUserIdRef.current;

                        if (message_ids && Array.isArray(message_ids) && read_by_user_id !== actualCurrentUserId) {
                            console.log('📖 [BULK-READ-NOTIFICATION] Multiple messages read by recipient:', {
                                count: message_ids.length,
                                readByUserId: read_by_user_id,
                                ourUserId: actualCurrentUserId
                            });

                            // Запускаем анимацию для каждого сообщения с небольшой задержкой
                            message_ids.forEach((messageId, index) => {
                                setTimeout(() => {
                                    animateSentMessageAsRead(messageId);
                                }, index * 100); // 100мс между анимациями для визуального эффекта
                            });
                        }

                        return;
                    }

                    // Обработка сообщений чата (включая сообщения без типа) - РАСШИРЕННАЯ ПРОВЕРКА
                    const isChatMessage = data.message !== undefined &&
                        (!data.type || data.type === 'chat_message' || data.type === 'media_message' || data.type === 'message');

                    const hasMessageData = data.id && (data.message !== undefined || data.mediaType);

                    if (isChatMessage || hasMessageData) {
                        console.log('💬 [NEW-MESSAGE] ========== NEW MESSAGE RECEIVED ==========');
                        console.log('💬 [NEW-MESSAGE] Message ID:', data.id);
                        console.log('💬 [NEW-MESSAGE] Message text:', data.message?.substring(0, 50));
                        console.log('💬 [NEW-MESSAGE] Message type:', data.type);
                        console.log('💬 [NEW-MESSAGE] Sender:', data.sender__username);
                        console.log('💬 [NEW-MESSAGE] Sender ID:', data.sender_id);
                        console.log('💬 [NEW-MESSAGE] Full data:', JSON.stringify(data, null, 2));

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

                        // УЛУЧШЕННАЯ ЛОГИКА: Обработка новых сообщений с учетом холодного старта
                        if (!isMyMessage && messageId && data.sender_id) {
                            const actualIsColdStart = isColdStartRef.current;

                            console.log('💬 [NEW-MESSAGE] ========== PROCESSING NEW MESSAGE ==========');
                            console.log('💬 [NEW-MESSAGE] Message ID:', messageId);
                            console.log('💬 [NEW-MESSAGE] Chat Active:', actualIsChatActive);
                            console.log('💬 [NEW-MESSAGE] Is Cold Start:', actualIsColdStart);
                            console.log('💬 [NEW-MESSAGE] Data Loaded:', actualIsDataLoaded);

                            if (actualCurrentUserId && actualIsDataLoaded) {
                                // КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Показываем анимацию даже при холодном старте
                                // если чат активен (пользователь действительно смотрит на экран)
                                const shouldShowAnimation = actualIsChatActive && (!actualIsColdStart || AppState.currentState === 'active');

                                console.log('💬 [NEW-MESSAGE] Should show animation:', shouldShowAnimation);
                                console.log('💬 [NEW-MESSAGE] App State:', AppState.currentState);

                                if (shouldShowAnimation) {
                                    console.log('💬 [NEW-MESSAGE] ✅ Processing new message with animation');

                                    // Добавляем сообщение в список непрочитанных для визуальной индикации
                                    setUnreadMessages(prev => {
                                        const newSet = new Set(prev);
                                        newSet.add(messageId);
                                        console.log('💬 [NEW-MESSAGE] ✅ Added to unread messages:', messageId);
                                        return newSet;
                                    });

                                    // Создаем анимацию для этого сообщения
                                    if (!unreadAnimations.current[messageId]) {
                                        const AnimatedNative = require('react-native').Animated;
                                        unreadAnimations.current[messageId] = new AnimatedNative.Value(1);
                                        console.log('💬 [NEW-MESSAGE] ✅ Created animation for message:', messageId);
                                    }

                                    // УЛУЧШЕНИЕ: Адаптивная задержка - меньше для холодного старта
                                    const animationDelay = actualIsColdStart ? 1000 : 2000; // 1с для холодного старта, 2с обычно

                                    setTimeout(() => {
                                        // Повторная проверка состояния с актуальными значениями
                                        if (currentUserIdRef.current && isConnectedRef.current && isChatActiveRef.current) {
                                            console.log('💬 [NEW-MESSAGE] ✅ Marking as read and starting animation after', animationDelay + 'ms');
                                            markMessageAsRead(messageId, data.sender_id);
                                            animateMessageAsRead(messageId);
                                        }
                                    }, animationDelay);
                                } else {
                                    // Если анимация не нужна - просто отмечаем как прочитанное
                                    console.log('💬 [NEW-MESSAGE] No animation needed, marking as read immediately');
                                    markMessageAsRead(messageId, data.sender_id);
                                }
                            } else {
                                console.log('💬 [NEW-MESSAGE] ⚠️ Not ready for processing, adding to pending queue');
                                // Добавляем в очередь для обработки после инициализации
                                pendingMessagesQueue.current.push({messageId, senderId: data.sender_id});
                            }
                        }

                        setMessages(prev => {
                            // КРИТИЧНО: Сначала проверяем дубликаты по ID, хешу и содержимому
                            const existingById = prev.find(msg => msg.id === messageId);
                            const existingByHash = data.mediaHash ?
                                prev.find(msg => msg.mediaHash === data.mediaHash && msg.sender_id === data.sender_id) :
                                null;
                            const existingByContent = !data.mediaHash ?
                                prev.find(msg =>
                                    msg.message === data.message &&
                                    msg.sender_id === data.sender_id &&
                                    Math.abs(Number(msg.timestamp) - Number(data.timestamp)) < 30
                                ) :
                                null;

                            if (existingById || existingByHash || existingByContent) {
                                console.log('💬 [DUPLICATE] Message already exists, skipping:', {
                                    messageId,
                                    existsById: !!existingById,
                                    existsByHash: !!existingByHash,
                                    existsByContent: !!existingByContent
                                });
                                return prev;
                            }

                            // Если это мое сообщение, ищем оптимистичное сообщение для обновления
                            if (isMyMessage) {
                                // Ищем оптимистичное сообщение по содержимому и времени
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
                                    // Для текстовых сообщений: поиск оптимистичного сообщения
                                    optimisticIndex = prev.findIndex(msg => {
                                        const isOptimisticMessage = msg._isOptimistic === true;
                                        const isMyMessage = msg.sender_id === currentUserId;
                                        const isMatchingMessage = msg.message?.trim() === data.message?.trim();
                                        const isNotServerMessage = msg.id !== messageId;
                                        const isRecentMessage = typeof msg.id === 'number' && msg.id > currentTime - 300000; // 5 минут

                                        return isOptimisticMessage && isMyMessage && isMatchingMessage && isNotServerMessage && isRecentMessage;
                                    });
                                }

                                if (optimisticIndex !== -1) {
                                    // Обновляем оптимистичное сообщение данными с сервера
                                    const updatedMessages = [...prev];
                                    const originalMessage = updatedMessages[optimisticIndex];

                                    console.log('📤 [OPTIMISTIC] ✅ FOUND AND UPDATING optimistic message:', {
                                        originalId: originalMessage.id,
                                        serverId: messageId,
                                        optimisticId: originalMessage._optimisticId,
                                        originalMessage: originalMessage.message?.substring(0, 50),
                                        serverMessage: data.message?.substring(0, 50),
                                        originalTimestamp: originalMessage.timestamp,
                                        serverTimestamp: data.timestamp
                                    });

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
                                        // Удаляем оптимистичные поля
                                        _isOptimistic: false,
                                        _wasOptimistic: true,
                                        _serverConfirmed: true,
                                        _originalId: originalMessage.id
                                    };

                                    // ВАЖНО: Обновляем ID в списке непрочитанных отправленных сообщений
                                    const oldOptimisticId = originalMessage._optimisticId || originalMessage.id;
                                    setUnreadSentMessages(prevUnread => {
                                        const newSet = new Set(prevUnread);
                                        if (newSet.has(oldOptimisticId)) {
                                            newSet.delete(oldOptimisticId);
                                            newSet.add(messageId);
                                            console.log('📤 [OPTIMISTIC] Updated unread sent messages ID:', oldOptimisticId, '->', messageId);
                                        }
                                        return newSet;
                                    });

                                    // Переносим анимацию на новый ID
                                    if (unreadSentAnimations.current[oldOptimisticId]) {
                                        unreadSentAnimations.current[messageId] = unreadSentAnimations.current[oldOptimisticId];
                                        delete unreadSentAnimations.current[oldOptimisticId];
                                        console.log('📤 [OPTIMISTIC] Transferred animation to server ID:', messageId);
                                    }

                                    return updatedMessages;
                                }

                                // FALLBACK: Создаем новое сообщение если оптимистичное не найдено
                                console.log('📤 [FALLBACK] Creating new message since optimistic not found');

                                const isLargeFile = data.mediaSize ? (data.mediaSize / (1024 * 1024)) > 15 : false;

                                const newMessage: Message = {
                                    id: messageId,
                                    message: data.message,
                                    timestamp: data.timestamp || Math.floor(Date.now() / 1000),
                                    sender__username: data.sender__username || currentUsername,
                                    sender_id: data.sender_id || currentUserId,
                                    mediaType: data.mediaType,
                                    mediaUri: null,
                                    mediaBase64: data.mediaBase64,
                                    mediaHash: data.mediaHash,
                                    mediaFileName: data.mediaFileName,
                                    mediaSize: data.mediaSize,
                                    isUploading: false,
                                    uploadProgress: 100,
                                    needsReload: isLargeFile && !data.mediaBase64,
                                    _isOptimistic: false,
                                    _wasOptimistic: false,
                                    _serverConfirmed: true
                                };

                                console.log('📤 [FALLBACK] ✅ Created fallback message:', newMessage.id);
                                return [newMessage, ...prev];
                            }

                            // Добавляем новое сообщение от другого пользователя
                            console.log('💬 [NEW-MESSAGE] Adding new message from other user:', {
                                messageId: messageId,
                                sender: data.sender__username,
                                mediaType: data.mediaType,
                                mediaHash: data.mediaHash?.substring(0, 16) + '...'
                            });

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
                                needsReload: isLargeFile && !data.mediaBase64,
                                // НОВОЕ: Помечаем как непрочитанное для визуальной индикации
                                _isNewUnread: !isMyMessage
                            };
                            return [newMessage, ...prev];
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
            console.log('🎤 [AUDIO-PERMISSION] Requesting audio permission...');

            const {status: existingStatus} = await Audio.getPermissionsAsync();
            console.log('🎤 [AUDIO-PERMISSION] Existing status:', existingStatus);

            if (existingStatus === 'granted') {
                console.log('🎤 [AUDIO-PERMISSION] ✅ Permission already granted');
                setAudioPermissionGranted(true);
                return true;
            }

            console.log('🎤 [AUDIO-PERMISSION] Requesting new permission...');
            const {status} = await Audio.requestPermissionsAsync();
            console.log('🎤 [AUDIO-PERMISSION] New permission status:', status);

            if (status === 'granted') {
                console.log('🎤 [AUDIO-PERMISSION] ✅ Permission granted');
                setAudioPermissionGranted(true);
                return true;
            }

            console.log('🎤 [AUDIO-PERMISSION] ❌ Permission denied');
            Alert.alert(
                'Разрешение требуется',
                'Для записи голосовых сообщений необходим доступ к микрофону. Пожалуйста, включите его в настройках.',
                [
                    {text: 'Отмена', style: 'cancel'},
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
            const {status: currentStatus} = await ImagePicker.getMediaLibraryPermissionsAsync();
            console.log('📱 [PERMISSIONS] Current status:', currentStatus);

            if (currentStatus === 'granted') {

                return true;
            }

            // Запрашиваем разрешение
            const {status, canAskAgain} = await ImagePicker.requestMediaLibraryPermissionsAsync();

            if (status === 'granted') {
                return true;
            }

            // Разрешение не получено
            if (!canAskAgain) {
                Alert.alert(
                    'Разрешение требуется',
                    'Разрешение на доступ к медиабиблиотеке было отклонено. Пожалуйста, включите его в настройках приложения.',
                    [
                        {text: 'Отмена', style: 'cancel'},
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
                    [{text: 'OK'}]
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

            // Ограничиваем размер файла для загрузки (800MB максимальный размер)
            const maxSizeForUpload = 800 * 1024 * 1024; // 800MB
            if (fileInfo.size > maxSizeForUpload) {
                throw new Error(`Файл слишком большой: ${fileSizeInMB.toFixed(1)}MB > 800MB.`);
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
            const {recording} = await Audio.Recording.createAsync(
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

    // Функция для установки реплая
    const setReply = (message: Message) => {
        setReplyToMessage(message);
        console.log('💬 [REPLY] Set reply to message:', message.id, message.message?.substring(0, 50));
    };

    // Функция для отмены реплая
    const cancelReply = () => {
        setReplyToMessage(null);
        console.log('💬 [REPLY] Reply cancelled');
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
                    flatListRef.current.scrollToIndex({index: 0, animated: true});
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
                        [messageId]: {...currentState, isPlaying: false}
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
            const {sound} = await Audio.Sound.createAsync(
                {uri: audioUri},
                {shouldPlay: true},
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

    // ---------- NEW: Delete a message ----------
    /**
     * Sends a delete request to the server and removes the message locally.
     * Only the author of the message can delete it.
     */
    // ---------- NEW: Delete one or several messages ----------
    /**
     * Удаляет сообщение(я) для текущего пользователя (мягкое удаление).
     * Собеседник видит сообщения с пометкой об удалении.
     * Принимает один id или массив id.
     */
    const deleteMessage = async (messageIds: number | number[], deleteType: 'for_me' | 'for_everyone' = 'for_me') => {
        const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
        if (!isConnected || !isDataLoaded || !recipient?.id || !currentUserId) {
            Alert.alert('Ошибка', 'Невозможно удалить сообщение в данный момент');
            return;
        }

        try {
            // Показываем индикатор удаления (оптимистичное обновление UI)
            setMessages(prev => prev.map(msg => {
                if (ids.includes(Number(msg.id))) {
                    return {
                        ...msg,
                        isDeleting: true
                    };
                }
                return msg;
            }));

            console.log('🗑️ [DELETE] Starting delete process:', {
                ids,
                deleteType,
                userId: currentUserId,
                roomId
            });

            // ГЛАВНОЕ ИСПРАВЛЕНИЕ: Используем HTTP API для удаления
            const token = await getToken();
            if (!token) {
                throw new Error('Нет токена авторизации');
            }

            const response = await axios.post(
                `${API_CONFIG.BASE_URL}/chat/api/messages/delete/`,
                {
                    message_ids: ids,
                    room_id: roomId,
                    delete_type: deleteType
                },
                {
                    headers: {
                        'Authorization': `Token ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            console.log('🗑️ [DELETE] HTTP API response:', response.data);

            if (response.data.success) {
                // Удаляем сообщения из UI после успешного удаления на сервере
                if (deleteType === 'for_me' || deleteType === 'for_everyone') {
                    setMessages(prev => prev.filter(msg => !ids.includes(Number(msg.id))));
                }

                // Отправляем уведомление через WebSocket для других пользователей
                if (deleteType === 'for_everyone') {
                    const notificationPayload = {
                        type: 'messages_deleted_notification',
                        message_ids: ids,
                        room_id: roomId,
                        deleted_by_user_id: currentUserId,
                        deleted_by_username: currentUsername,
                        delete_type: deleteType
                    };

                    sendMessage(notificationPayload);
                }

                console.log('🗑️ [DELETE] ✅ Messages successfully deleted');
            } else {
                throw new Error(response.data.error || 'Сервер не подтвердил удаление');
            }

        } catch (error) {
            console.error('🗑️ [DELETE] ❌ Error deleting messages:', error);

            // Убираем индикатор удаления при ошибке
            setMessages(prev => prev.map(msg => {
                if (ids.includes(Number(msg.id))) {
                    const {isDeleting, ...msgWithoutDeleting} = msg;
                    return msgWithoutDeleting;
                }
                return msg;
            }));

            let errorMessage = 'Не удалось удалить сообщения';
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    errorMessage = 'Сессия истекла. Войдите снова';
                    router.replace('/(auth)/login');
                } else if (error.response?.status === 403) {
                    errorMessage = 'Недостаточно прав для удаления';
                } else if (error.response?.status === 404) {
                    errorMessage = 'Сообщения не найдены';
                } else if (error.response?.data?.error) {
                    errorMessage = error.response.data.error;
                }
            } else if (error.message) {
                errorMessage = error.message;
            }

            Alert.alert('Ошибка удаления', errorMessage);
        }
    };

    // Функции для управления выделением сообщений
    const toggleMessageSelection = (messageId: number) => {
        setSelectedMessages(prev => {
            const newSet = new Set(prev);
            if (newSet.has(messageId)) {
                newSet.delete(messageId);
            } else {
                newSet.add(messageId);
            }

            // Если больше нет выделенных сообщений, выходим из режима выделения
            if (newSet.size === 0) {
                setIsSelectionMode(false);
            }

            return newSet;
        });
    };

    const enterSelectionMode = (messageId: number) => {
        setIsSelectionMode(true);
        setSelectedMessages(new Set([messageId]));
    };

    const exitSelectionMode = () => {
        setIsSelectionMode(false);
        setSelectedMessages(new Set());
    };

    const selectAllMessages = () => {
        const allMessageIds = messages.map(msg => Number(msg.id));
        setSelectedMessages(new Set(allMessageIds));
    };

    const deleteSelectedMessages = () => {
        if (selectedMessages.size === 0) return;

        // Проверяем, есть ли среди выбранных мои собственные сообщения
        const selectedMessageObjects = messages.filter(msg => selectedMessages.has(Number(msg.id)));
        const hasMyMessages = selectedMessageObjects.some(msg => msg.sender_id === currentUserId);
        const hasOtherMessages = selectedMessageObjects.some(msg => msg.sender_id !== currentUserId);

        if (hasMyMessages && hasOtherMessages) {
            // Смешанный выбор - только удаление для себя
            Alert.alert(
                'Удалить сообщения',
                `Удалить ${selectedMessages.size} сообщений из своей переписки? Собеседник будет видеть ваши сообщения с пометкой "удалено из переписки".`,
                [
                    {text: 'Отмена', style: 'cancel'},
                    {
                        text: 'Удалить у себя',
                        style: 'destructive',
                        onPress: () => {
                            deleteMessage(Array.from(selectedMessages), 'for_me');
                            exitSelectionMode();
                        }
                    }
                ],
                {cancelable: true}
            );
        } else if (hasMyMessages) {
            // Только мои сообщения - можно удалить для всех
            Alert.alert(
                'Удалить сообщения',
                `Выберите тип удаления для ${selectedMessages.size} ваших сообщений:`,
                [
                    {text: 'Отмена', style: 'cancel'},
                    {
                        text: 'Удалить у себя',
                        onPress: () => {
                            deleteMessage(Array.from(selectedMessages), 'for_me');
                            exitSelectionMode();
                        }
                    },
                    {
                        text: 'Удалить у всех',
                        style: 'destructive',
                        onPress: () => {
                            deleteMessage(Array.from(selectedMessages), 'for_everyone');
                            exitSelectionMode();
                        }
                    }
                ],
                {cancelable: true}
            );
        } else {
            // Только чужие сообщения - удаление для себя
            Alert.alert(
                'Удалить сообщения',
                `Удалить ${selectedMessages.size} сообщений из своей переписки? Собеседник будет видеть свои сообщения с пометкой "удалено из переписки".`,
                [
                    {text: 'Отмена', style: 'cancel'},
                    {
                        text: 'Удалить у себя',
                        style: 'destructive',
                        onPress: () => {
                            deleteMessage(Array.from(selectedMessages), 'for_me');
                            exitSelectionMode();
                        }
                    }
                ],
                {cancelable: true}
            );
        }
    };

    const forwardSelectedMessages = () => {
        if (selectedMessages.size === 0) return;

        // Получаем выделенные сообщения
        const messagesToForward = messages.filter(msg => selectedMessages.has(Number(msg.id)));

        Alert.alert(
            'Переслать сообщения',
            `Функция пересылки ${selectedMessages.size} сообщений будет реализована позже`,
            [{text: 'OK'}]
        );

        // TODO: Реализовать логику пересылки
        // Например, можно открыть список контактов или чатов для выбора получателя

        exitSelectionMode();
    };

    // Выбор изображения (поддержка множественного выбора)
    const pickImage = async () => {
        try {
            const hasPermission = await requestPermissions();
            if (!hasPermission) {
                console.log('📷 [PICKER] ❌ No permission for media library');
                return;
            }

            console.log('📷 [PICKER] Launching image library with multiple selection...');
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: false,
                quality: 0.7,               // Уменьшаем качество для ускорения без значительной потери
                base64: true,
                exif: false,
                allowsMultipleSelection: true, // <‑‑ Включаем множественный выбор
                selectionLimit: 0,
            });

            console.log('📷 [PICKER] Image picker result:', {
                canceled: result.canceled,
                assetsCount: result.assets?.length || 0,
            });

            if (result.canceled || !result.assets?.length) {
                return;
            }

            // Обрабатываем каждый выбранный файл последовательно
            for (const asset of result.assets) {
                console.log('📷 [PICKER] Asset details:', {
                    hasBase64: !!asset.base64,
                    base64Length: asset.base64?.length || 0,
                    uri: asset.uri,
                    width: asset.width,
                    height: asset.height,
                    fileSize: asset.fileSize,
                    fileName: asset.fileName,
                });

                if (asset.base64) {
                    await sendMediaMessage(asset.base64, 'image');
                } else {
                    // Проверяем размер файла перед конвертацией
                    if (asset.fileSize) {
                        const fileSizeMB = asset.fileSize / (1024 * 1024);
                        console.log('📷 [PICKER] File size before conversion:', fileSizeMB.toFixed(1) + 'MB');

                        if (fileSizeMB > 100) {
                            Alert.alert(
                                'Изображение слишком большое',
                                `Размер: ${fileSizeMB.toFixed(1)} MB\nМаксимум для P2P‑передачи: 100 MB`,
                                [{text: 'Понятно'}]
                            );
                            continue; // переходим к следующему файлу
                        }
                    }

                    try {
                        console.log('📷 [PICKER] Converting URI to base64...');
                        const base64 = await convertToBase64(asset.uri);
                        console.log('📷 [PICKER] Base64 conversion successful, length:', base64.length);
                        await sendMediaMessage(base64, 'image');
                    } catch (convertError) {
                        console.error('📷 [PICKER] ❌ Conversion error:', convertError);
                        // Обрабатываем ошибки аналогично исходному коду
                        const errMsg = convertError.toString();

                        if (errMsg.includes('OutOfMemoryError') || errMsg.includes('allocation') || errMsg.includes('memory')) {
                            Alert.alert(
                                'Недостаточно памяти',
                                `Изображение слишком большое для обработки в памяти.\n\nРазмер: ${asset.fileSize ? Math.round(asset.fileSize / (1024 * 1024)) + 'MB' : 'неизвестно'}\n\nПопробуйте выбрать меньший файл или использовать прямую загрузку.`,
                                [
                                    {text: 'Понятно'},
                                    {
                                        text: 'Прямая загрузка',
                                        onPress: async () => {
                                            try {
                                                await sendMediaMessageDirect(asset.uri, 'image', asset.fileSize);
                                            } catch (e) {
                                                Alert.alert('Ошибка', 'Не удалось загрузить изображение напрямую.');
                                            }
                                        },
                                    },
                                ]
                            );
                        } else {
                            Alert.alert(
                                'Ошибка обработки изображения',
                                `Не удалось получить данные изображения.\n\n${errMsg}`,
                                [{text: 'OK'}]
                            );
                        }
                    }
                }
            }
        } catch (error) {
            console.error('📷 [PICKER] ❌ Error picking images:', error);
            Alert.alert('Ошибка', 'Не удалось выбрать изображения');
        }
    };

    // Выбор документов (поддержка множественного выбора)
    const pickDocument = async () => {
        console.log('📄 [PICKER] Starting document picker (multiple)...');
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: '*/*',
                copyToCacheDirectory: true,
                multiple: true,               // <‑‑ Позволяем выбрать несколько файлов
            });

            console.log('📄 [PICKER] Document picker result:', {
                canceled: result.canceled,
                assetsCount: result.assets?.length || 0,
            });

            if (result.canceled || !result.assets?.length) {
                return;
            }

            for (const asset of result.assets) {
                console.log('📄 [PICKER] Document details:', {
                    name: asset.name,
                    size: asset.size,
                    mimeType: asset.mimeType,
                    uri: asset.uri,
                });

                // Ограничиваем размер до 100 MB на один документ
                const maxSize = 100 * 1024 * 1024;
                if (asset.size && asset.size > maxSize) {
                    Alert.alert(
                        'Файл слишком большой',
                        `Размер: ${Math.round(asset.size / 1024 / 1024)} MB. Максимум: 100 MB.`,
                        [{text: 'OK'}]
                    );
                    continue; // переходим к следующему файлу
                }

                const fileSizeMB = asset.size ? asset.size / (1024 * 1024) : 0;

                try {
                    // Все документы загружаются напрямую (без base64)
                    console.log('📄 [PICKER] Direct upload for document');
                    await sendDocumentDirect(
                        asset.uri,
                        asset.name || `document_${Date.now()}`,
                        asset.mimeType || 'application/octet-stream',
                        asset.size
                    );
                } catch (fileError) {
                    console.error('📄 [PICKER] ❌ Ошибка обработки документа:', fileError);
                    Alert.alert(
                        'Ошибка',
                        `Не удалось обработать документ "${asset.name || 'без имени'}".`,
                        [{text: 'OK'}]
                    );
                }
            }
        } catch (error) {
            console.error('📄 [PICKER] ❌ Error picking documents:', error);
            Alert.alert('Ошибка', 'Не удалось открыть диалог выбора документов');
        }
    };

    // Диагностика видеофайла для проверки совместимости
    const diagnoseVideo = async (videoUri: string): Promise<{ compatible: boolean, info: any }> => {
        try {
            console.log('🎥 [DIAGNOSE] Analyzing video compatibility:', videoUri.substring(videoUri.lastIndexOf('/') + 1));

            const fileInfo = await FileSystem.getInfoAsync(videoUri);
            if (!fileInfo.exists) {
                return {compatible: false, info: {error: 'File does not exist'}};
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
            return {compatible: false, info: {error: error.message}};
        }
    };

    // Выбор видео с диагностикой
    const pickVideo = async () => {
        console.log('🎥 [PICKER] ========== STARTING VIDEO PICKER ==========');

        try {
            // Проверяем разрешения с более подробной обработкой
            const hasPermission = await requestPermissions();
            if (!hasPermission) {
                console.log('🎥 [PICKER] ❌ No permission for media library');
                Alert.alert(
                    'Разрешение требуется',
                    'Для выбора видео необходимо разрешение доступа к медиабиблиотеке. Предоставьте разрешение в настройках приложения.',
                    [{text: 'OK'}]
                );
                return;
            }

            console.log('🎥 [PICKER] Launching video picker...');

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['videos'],
                allowsEditing: false,
                quality: 0.5,
                videoMaxDuration: 180,
                allowsMultipleSelection: true, // Включаем множественный выбор
            });

            console.log('🎥 [PICKER] Video picker result:', {
                canceled: result.canceled,
                assetsCount: result.assets?.length || 0
            });

            if (result.canceled || !result.assets?.length) {
                console.log('🎥 [PICKER] User canceled or no assets selected');
                return;
            }

            // Создаем Set для отслеживания уже обработанных файлов (дедупликация)
            const processedUris = new Set<string>();
            const processedSizes = new Set<string>();

            console.log('🎥 [PICKER] Processing', result.assets.length, 'video assets...');

            // Обрабатываем каждый выбранный видео файл
            for (let i = 0; i < result.assets.length; i++) {
                const asset = result.assets[i];
                console.log(`🎥 [PICKER] Processing asset ${i + 1}/${result.assets.length}:`, {
                    uri: asset.uri?.substring(asset.uri.lastIndexOf('/') + 1),
                    fileSize: asset.fileSize,
                    duration: asset.duration,
                    width: asset.width,
                    height: asset.height
                });

                // ДЕДУПЛИКАЦИЯ: Проверяем дубликаты по URI и размеру
                const uniqueKey = `${asset.uri}_${asset.fileSize}_${asset.duration}`;
                if (processedUris.has(asset.uri) || processedSizes.has(uniqueKey)) {
                    console.warn('🎥 [PICKER] ⚠️ Duplicate video detected, skipping:', {
                        uri: asset.uri?.substring(asset.uri.lastIndexOf('/') + 1),
                        fileSize: asset.fileSize
                    });
                    continue;
                }

                // Добавляем в множества для отслеживания
                processedUris.add(asset.uri);
                processedSizes.add(uniqueKey);

                try {
                    // Проверяем размер файла
                    const maxVideoSize = 600 * 1024 * 1024; // 600MB
                    if (asset.fileSize && asset.fileSize > maxVideoSize) {
                        console.warn('🎥 [PICKER] File too large:', Math.round(asset.fileSize / 1024 / 1024) + 'MB');
                        Alert.alert(
                            'Файл слишком большой',
                            `Размер видео: ${Math.round(asset.fileSize / 1024 / 1024)}MB. Максимальный размер: 600MB.`
                        );
                        continue;
                    }

                    // Проверяем длительность видео
                    const maxDuration = 3000000; // 50 минут
                    if (asset.duration && asset.duration > maxDuration) {
                        console.warn('🎥 [PICKER] Video too long:', Math.round(asset.duration / 1000) + 's');
                        Alert.alert(
                            'Видео слишком длинное',
                            `Длительность: ${Math.round(asset.duration / 1000)}сек. Максимальная длительность: 50 минут.`
                        );
                        continue;
                    }

                    console.log(`🎥 [PICKER] ✅ Asset ${i + 1} validation passed, uploading...`);

                    // Загружаем видео
                    await sendMediaMessageDirect(asset.uri, 'video', asset.fileSize);

                    console.log(`🎥 [PICKER] ✅ Asset ${i + 1} uploaded successfully`);

                } catch (assetError) {
                    console.error(`🎥 [PICKER] ❌ Error processing asset ${i + 1}:`, assetError);
                    Alert.alert('Ошибка', `Не удалось загрузить видео ${i + 1}`);
                }
            }

            console.log('🎥 [PICKER] ✅ All video assets processed');

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
                [{text: 'OK'}]
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
            const mediaHash = generateMediaHash(base64Data, {timestamp, messageId, senderId: currentUserId});

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
            await FileSystem.deleteAsync(tempUri, {idempotent: true});

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
                uploadProgress: 0
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

    // Универсальная функция загрузки файлов с поддержкой фонового режима
    const uploadFileGeneric = async (
        fileUri: string,
        fileName: string,
        mimeType: string,
        messageId: number,
        onProgress?: (progress: number) => void,
        enableBackground: boolean = true
    ): Promise<string> => {
        const uploadId = `upload_${messageId}_${Date.now()}`;

        try {
            const token = await getToken();
            if (!token) {
                throw new Error('Нет токена авторизации');
            }

            // Создаем запись о фоновой загрузке
            if (enableBackground) {
                const backgroundUpload: BackgroundUpload = {
                    id: uploadId,
                    messageId: messageId,
                    roomId: String(roomId),
                    fileUri: fileUri,
                    fileName: fileName,
                    mimeType: mimeType,
                    fileSize: 0, // Будет обновлен ниже
                    mediaType: mimeType.startsWith('image/') ? 'image' :
                        mimeType.startsWith('video/') ? 'video' :
                            mimeType.startsWith('audio/') ? 'audio' : 'file',
                    status: 'pending',
                    progress: 0,
                    startTime: Date.now()
                };

                // Получаем размер файла
                try {
                    const fileInfo = await FileSystem.getInfoAsync(fileUri);
                    backgroundUpload.fileSize = fileInfo.size;
                } catch (sizeError) {
                    console.warn('📤 [BACKGROUND] Could not get file size:', sizeError);
                }

                await backgroundUploadManager.saveUpload(backgroundUpload);
                console.log('📤 [BACKGROUND] Created background upload:', uploadId);
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
                fileUri: fileUri.substring(fileUri.lastIndexOf('/') + 1),
                backgroundEnabled: enableBackground
            });

            // Добавляем публичный доступ для чатов
            formData.append('is_public', 'true');

            // Обновляем статус на "загружается"
            if (enableBackground) {
                await backgroundUploadManager.updateUpload(uploadId, {
                    status: 'uploading',
                    progress: 5
                });
            }

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
                    timeout: 1800000, // 30 минут для больших файлов
                    onUploadProgress: (progressEvent) => {
                        if (progressEvent.total) {
                            // Исправляем расчет: 10% начальная подготовка + 85% загрузка + 5% финализация
                            const uploadProgress = Math.round((progressEvent.loaded / progressEvent.total) * 85);
                            const totalProgress = Math.min(10 + uploadProgress, 95); // Максимум 95% до финализации

                            if (onProgress) {
                                onProgress(totalProgress);
                            }

                            // Обновляем прогресс в фоновой загрузке
                            if (enableBackground) {
                                backgroundUploadManager.updateUpload(uploadId, {
                                    progress: totalProgress
                                }).catch(() => {
                                }); // Игнорируем ошибки обновления прогресса
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

            const fileUrl = response.data.file.file_url;

            // Помечаем загрузку как завершенную
            if (enableBackground) {
                await backgroundUploadManager.updateUpload(uploadId, {
                    status: 'completed',
                    progress: 100,
                    serverUrl: fileUrl
                });
                console.log('📤 [BACKGROUND] Upload completed:', uploadId);
            }

            return fileUrl;

        } catch (error) {
            console.error('📤 [UPLOAD] Error uploading file:', error);

            // Помечаем загрузку как неудачную
            if (enableBackground) {
                await backgroundUploadManager.updateUpload(uploadId, {
                    status: 'failed',
                    error: error.message || 'Unknown error'
                });
            }

            throw error;
        }
    };

    // Отправка медиа сообщения напрямую через файл (без base64)
    const sendMediaMessageDirect = async (fileUri: string, mediaType: 'image' | 'video', fileSize?: number) => {
        console.log('📤 [DIRECT] ========== STARTING MEDIA UPLOAD ==========');
        console.log('📤 [DIRECT] URI:', fileUri?.substring(fileUri.lastIndexOf('/') + 1));
        console.log('📤 [DIRECT] Type:', mediaType);
        console.log('📤 [DIRECT] Size:', fileSize);

        if (!isConnected || !isDataLoaded || !recipient?.id || !currentUserId) {
            console.log('📤 [DIRECT] ❌ Cannot send - missing requirements');
            Alert.alert('Ошибка', 'Не удается отправить медиафайл');
            return;
        }

        // Проверяем файл
        const fileInfo = await FileSystem.getInfoAsync(fileUri);
        if (!fileInfo.exists) {
            console.log('📤 [DIRECT] ❌ File does not exist:', fileUri);
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
            console.log('📤 [DIRECT] ❌ File too large:', fileSizeMB.toFixed(1) + 'MB');
            Alert.alert('Файл слишком большой', `Размер: ${fileSizeMB.toFixed(1)}MB. Максимум: 2048MB`);
            return;
        }

        // ДЕДУПЛИКАЦИЯ: Создаем уникальный ключ файла для проверки дубликатов
        const fileUniqueKey = `${fileUri}_${actualFileSize}_${mediaType}`;

        // Проверяем, нет ли уже сообщения с таким же файлом в процессе загрузки
        const isDuplicate = messages.some(msg =>
            msg.mediaUri === fileUri &&
            msg.mediaSize === actualFileSize &&
            msg.mediaType === mediaType &&
            msg.isUploading === true
        );

        if (isDuplicate) {
            console.warn('📤 [DIRECT] ⚠️ Duplicate upload detected, skipping:', {
                fileUri: fileUri?.substring(fileUri.lastIndexOf('/') + 1),
                mediaType,
                actualFileSize
            });
            Alert.alert('Внимание', 'Этот файл уже загружается');
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
                mediaFileName: mediaFileName,
                uniqueKey: fileUniqueKey
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
                uploadProgress: 0
            };

            console.log('📤 [DIRECT] Creating optimistic message:', messageId);

            // Добавляем сообщение в UI с дополнительной проверкой дубликатов
            setMessages(prev => {
                // Финальная проверка на дубликаты перед добавлением
                const existingMessage = prev.find(msg =>
                    msg.mediaUri === fileUri &&
                    msg.mediaSize === actualFileSize &&
                    msg.mediaType === mediaType
                );

                if (existingMessage) {
                    console.warn('📤 [DIRECT] ⚠️ Message with same media already exists, not adding duplicate');
                    return prev;
                }

                console.log('📤 [DIRECT] ✅ Adding optimistic message to UI');
                return [optimisticMessage, ...prev];
            });

            // Прокручиваем к новому сообщению
            setTimeout(() => {
                if (flatListRef.current) {
                    flatListRef.current.scrollToIndex({index: 0, animated: true});
                }
            }, 100);

            // Единый метод загрузки для всех файлов
            let uploadSuccess = false;
            let serverFileUrl = '';

            console.log('📤 [DIRECT] Using unified upload for all files');

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
                console.log('📤 [DIRECT] Upload successful');
            } catch (uploadError) {
                console.error('📤 [DIRECT] Upload failed:', uploadError);
                uploadSuccess = false;
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
            const mediaHash = generateMediaHash(base64Data, {timestamp, messageId, senderId: currentUserId});

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
            await FileSystem.deleteAsync(tempUri, {idempotent: true});

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

            console.log('📜 [HISTORY-API] Response structure:', {
                hasMessages: !!response.data?.messages,
                messageCount: response.data?.messages?.length || 0,
                firstMessageKeys: response.data?.messages?.[0] ? Object.keys(response.data.messages[0]) : [],
                sampleReadFields: response.data?.messages?.[0] ? {
                    is_read_by_recipient: response.data.messages[0].is_read_by_recipient,
                    is_read: response.data.messages[0].is_read,
                    read_by_recipient: response.data.messages[0].read_by_recipient,
                    isRead: response.data.messages[0].isRead,
                    read_status: response.data.messages[0].read_status,
                } : null
            });
            if (response.data?.messages?.length > 0) {
                // Проверяем медиа-сообщения
                const mediaMessages = response.data.messages.filter(msg =>
                    msg.mediaType || msg.media_type ||
                    msg.mediaHash || msg.media_hash
                );

            }

            if (response.data?.messages) {
                console.log('📜 [HISTORY] Processing', response.data.messages.length, 'messages from history');

                const processedMessages = response.data.messages.map((msg: any) => {
                    const isMyMessage = msg.sender_id === currentUserId;

                    // НОВАЯ ЛОГИКА: Поскольку сервер не предоставляет статус прочтения,
                    // считаем все отправленные сообщения потенциально непрочитанными.
                    // Статус будет обновляться через WebSocket уведомления.

                    // Определяем возраст сообщения (в часах)
                    const messageTime = new Date(msg.timestamp * 1000);
                    const now = new Date();
                    const hoursAgo = (now.getTime() - messageTime.getTime()) / (1000 * 60 * 60);

                    // Помечаем как непрочитанные только относительно свежие отправленные сообщения
                    // (например, не старше 48 часов)
                    const isUnreadBySender = isMyMessage && hoursAgo <= 48;

                    // НОВОЕ: Помечаем полученные сообщения как потенциально непрочитанные
                    // для визуальной индикации при входе в чат
                    // Увеличиваем временное окно и добавляем дополнительные условия
                    const isReceivedUnread = !isMyMessage && hoursAgo <= 72; // сообщения не старше 72 часов

                    console.log('📜 [HISTORY] Message processing:', {
                        id: msg.id,
                        isMyMessage,
                        hoursAgo: Math.round(hoursAgo * 10) / 10,
                        isUnreadBySender,
                        isReceivedUnread,
                        messageTime: messageTime.toLocaleString(),
                        hasReply: !!(msg.reply_to_message_id || msg.replyToMessageId)
                    });

                    // ИСПРАВЛЕНИЕ: Унифицированная обработка полей реплая из API
                    const replyToMessageId = msg.reply_to_message_id || msg.replyToMessageId || null;
                    const replyToMessage = msg.reply_to_message || msg.replyToMessage || msg.reply_message || null;
                    const replyToSender = msg.reply_to_sender || msg.replyToSender || msg.reply_sender || null;
                    const replyToMediaType = msg.reply_to_media_type || msg.replyToMediaType || msg.reply_media_type || null;

                    return {
                        ...msg,
                        mediaType: msg.mediaType || msg.media_type || null,
                        mediaHash: msg.mediaHash || msg.media_hash || null,
                        mediaFileName: msg.mediaFileName || msg.media_filename || null,
                        mediaSize: msg.mediaSize || msg.media_size || null,
                        mediaBase64: null,
                        // Redis кэширует URL - загрузится через API при просмотре
                        serverFileUrl: null,
                        isLoadingServerUrl: false,
                        needsReload: false,
                        // Помечаем свежие отправленные сообщения как потенциально непрочитанные
                        _isUnreadBySender: isUnreadBySender,
                        // ИСПРАВЛЕНИЕ: Добавляем поля реплая с обработкой всех вариантов названий
                        reply_to_message_id: replyToMessageId,
                        reply_to_message: replyToMessage,
                        reply_to_sender: replyToSender,
                        reply_to_media_type: replyToMediaType
                    };
                });

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

                        // Инициализируем непрочитанные отправленные сообщения из истории
                        const unreadSentFromHistory = historyMessages
                            .filter(msg => msg._isUnreadBySender)
                            .map(msg => msg.id);

                        if (unreadSentFromHistory.length > 0) {
                            console.log('📜 [HISTORY] Found unread sent messages from history:', unreadSentFromHistory.length);

                            // Добавляем в состояние непрочитанных отправленных сообщений
                            setUnreadSentMessages(prev => {
                                const newSet = new Set([...prev, ...unreadSentFromHistory]);
                                console.log('📜 [HISTORY] Updated unread sent messages:', Array.from(newSet));
                                return newSet;
                            });

                            // Создаем анимации для непрочитанных отправленных сообщений
                            unreadSentFromHistory.forEach(messageId => {
                                if (!unreadSentAnimations.current[messageId]) {
                                    const AnimatedNative = require('react-native').Animated;
                                    unreadSentAnimations.current[messageId] = new AnimatedNative.Value(1);
                                    console.log('📜 [HISTORY] Created animation for unread sent message:', messageId);
                                }
                            });
                        }

                        // ИСПРАВЛЕНИЕ: НЕ добавляем все сообщения как непрочитанные
                        // Только действительно новые сообщения должны иметь анимацию
                        // Исторические сообщения помечаются как прочитанные сразу после загрузки
                        console.log('📜 [HISTORY] Messages loaded, will mark as read automatically');

                        return mergedMessages;
                    });
                    setPage(1);
                    // Отметка как прочитанных теперь выполняется через отдельный useEffect
                    // после полной инициализации чата (см. useEffect ниже)

                    // Ленивая загрузка: URL загружаются только при прокрутке к медиа

                    // Подсчитываем медиа для статистики
                    const imageCount = processedMessages.filter(msg => msg.mediaType === 'image').length;
                    const videoCount = processedMessages.filter(msg => msg.mediaType === 'video').length;
                } else {
                    // Загрузка дополнительных сообщений - добавляем в конец (старые сообщения)
                    setMessages(prev => {
                        const updatedMessages = [...prev, ...processedMessages];

                        // Инициализируем непрочитанные отправленные сообщения для дополнительных страниц
                        const unreadSentFromPage = processedMessages
                            .filter(msg => msg._isUnreadBySender)
                            .map(msg => msg.id);

                        if (unreadSentFromPage.length > 0) {
                            console.log('📜 [HISTORY-PAGE] Found', unreadSentFromPage.length, 'potentially unread sent messages on page');

                            // Добавляем в состояние непрочитанных отправленных сообщений
                            setUnreadSentMessages(prev => {
                                const newSet = new Set([...prev, ...unreadSentFromPage]);
                                return newSet;
                            });

                            // Создаем анимации для непрочитанных отправленных сообщений
                            unreadSentFromPage.forEach(messageId => {
                                if (!unreadSentAnimations.current[messageId]) {
                                    const AnimatedNative = require('react-native').Animated;
                                    unreadSentAnimations.current[messageId] = new AnimatedNative.Value(1);
                                }
                            });
                        }

                        return updatedMessages;
                    });
                }
                // Проверяем, есть ли еще сообщения
                // hasMore = true только если получили ровно столько, сколько запрашивали
                const hasMoreMessages = processedMessages.length === limit;
                setHasMore(hasMoreMessages);

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
                setAudioSessionReady(false);
                return;
            }

            try {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    staysActiveInBackground: false,
                    playsInSilentModeIOS: true,
                    shouldDuckAndroid: true,
                    playThroughEarpieceAndroid: false
                });
                setAudioSessionReady(true);
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
    }, [currentUserId]);

    useEffect(() => {
        isDataLoadedRef.current = isDataLoaded;
    }, [isDataLoaded]);

    useEffect(() => {
        isConnectedRef.current = isConnected;
    }, [isConnected]);

    useEffect(() => {
        isChatActiveRef.current = isChatActive;
    }, [isChatActive]);

    useEffect(() => {
        isColdStartRef.current = isColdStart;
    }, [isColdStart]);

    // Отслеживание активности чата с правильной инициализацией
    useEffect(() => {
        console.log('📖 [CHAT-ACTIVATION] ========== INITIALIZING CHAT ACTIVITY ==========');
        console.log('📖 [CHAT-ACTIVATION] Room ID:', roomId);
        console.log('📖 [CHAT-ACTIVATION] Current User ID:', currentUserId);
        console.log('📖 [CHAT-ACTIVATION] Is Connected:', isConnected);

        // Очищаем предыдущий таймер
        if (chatActivationTimer.current) {
            clearTimeout(chatActivationTimer.current);
        }

        // КРИТИЧНО: Задержка для правильной инициализации всех состояний
        // Особенно важно для "холодного старта" из уведомлений
        chatActivationTimer.current = setTimeout(() => {
            console.log('📖 [CHAT-ACTIVATION] ✅ Activating chat after initialization delay');
            setIsChatActive(true);

            // Дополнительная задержка для определения типа старта
            setTimeout(() => {
                console.log('📖 [CHAT-ACTIVATION] ✅ Setting cold start to false');
                setIsColdStart(false);
            }, 1000); // 1 секунда для определения холодного старта

        }, 500); // 500мс базовая задержка для инициализации состояний

        // При размонтировании помечаем чат как неактивный
        return () => {
            console.log('📖 [CHAT-ACTIVATION] ⚠️ Deactivating chat');

            if (chatActivationTimer.current) {
                clearTimeout(chatActivationTimer.current);
                chatActivationTimer.current = null;
            }

            setIsChatActive(false);
            setIsColdStart(true);

            // Очищаем кеш прочитанных сообщений
            markedAsReadCache.current.clear();
            // Очищаем анимации непрочитанных отправленных сообщений
            Object.keys(unreadSentAnimations.current).forEach(key => {
                delete unreadSentAnimations.current[Number(key)];
            });
            setUnreadSentMessages(new Set());
        };
    }, [roomId, currentUserId, isConnected]);

    // Упрощенный useEffect для массовой отметки сообщений из истории
    // Все исторические сообщения отмечаются как прочитанные БЕЗ анимации
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

            console.log('📜 [AUTO-MARK] ========== MARKING HISTORY AS READ (NO ANIMATION) ==========');
            console.log('📜 [AUTO-MARK] Total messages in history:', messages.length);

            // Фильтруем только чужие сообщения
            const otherUserMessages = messages
                .filter(msg => msg.sender_id && msg.sender_id !== currentUserId)
                .map(msg => msg.id);

            console.log('📜 [AUTO-MARK] Other user messages to mark:', otherUserMessages.length);

            if (otherUserMessages.length > 0) {
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
                    console.log('📜 [AUTO-MARK] ✅ Bulk read receipt sent for', otherUserMessages.length, 'messages');

                    // ИСПРАВЛЕНИЕ: Никакой анимации для исторических сообщений
                    // Просто убираем все из непрочитанных сразу
                    setUnreadMessages(prev => {
                        const newSet = new Set(prev);
                        otherUserMessages.forEach(id => newSet.delete(id));
                        return newSet;
                    });

                    // Очищаем анимации для исторических сообщений
                    otherUserMessages.forEach(messageId => {
                        if (unreadAnimations.current[messageId]) {
                            delete unreadAnimations.current[messageId];
                        }
                    });

                    console.log('📜 [AUTO-MARK] ✅ Historical messages marked as read without animation');

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
        const timeoutId = setTimeout(markHistoryAsRead, 500);

        return () => {
            clearTimeout(timeoutId);
        };
    }, [isDataLoaded, isConnected, currentUserId, isChatActive]);

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
        console.log('📨 [PENDING-QUEUE] Queue length:', pendingMessagesQueue.current.length);
        console.log('📨 [PENDING-QUEUE] Is Cold Start:', isColdStart);

        // Обрабатываем все отложенные сообщения
        const pendingMessages = [...pendingMessagesQueue.current];
        pendingMessagesQueue.current = []; // Очищаем очередь

        pendingMessages.forEach(({messageId, senderId}) => {
            // Проверяем что это не мое сообщение
            if (senderId !== currentUserId) {
                console.log('📨 [PENDING-QUEUE] Processing pending message:', messageId);

                // УЛУЧШЕНИЕ: Учитываем холодный старт при обработке отложенных сообщений
                const shouldShowAnimation = !isColdStart || AppState.currentState === 'active';

                if (shouldShowAnimation) {
                    // Добавляем в список непрочитанных для визуальной индикации
                    setUnreadMessages(prev => {
                        const newSet = new Set(prev);
                        newSet.add(messageId);
                        console.log('📨 [PENDING-QUEUE] ✅ Added pending message to unread:', messageId);
                        return newSet;
                    });

                    // Создаем анимацию для этого сообщения
                    if (!unreadAnimations.current[messageId]) {
                        const AnimatedNative = require('react-native').Animated;
                        unreadAnimations.current[messageId] = new AnimatedNative.Value(1);
                        console.log('📨 [PENDING-QUEUE] ✅ Created animation for pending message:', messageId);
                    }

                    // Адаптивная задержка для отложенных сообщений
                    const delay = isColdStart ? 1500 : 2000;

                    setTimeout(() => {
                        if (isConnected && currentUserId && isChatActive && isDataLoaded) {
                            console.log('📨 [PENDING-QUEUE] ✅ Marking pending message as read after', delay + 'ms:', messageId);
                            markMessageAsRead(messageId, senderId);
                            animateMessageAsRead(messageId);
                        }
                    }, delay);
                } else {
                    // Без анимации - сразу отмечаем как прочитанное
                    console.log('📨 [PENDING-QUEUE] Marking pending message as read without animation:', messageId);
                    markMessageAsRead(messageId, senderId);
                }
            } else {
                console.log('📨 [PENDING-QUEUE] ⚠️ Skipping own message:', messageId);
            }
        });

    }, [isDataLoaded, isConnected, currentUserId, isChatActive, isColdStart, markMessageAsRead, animateMessageAsRead]);

    // УЛУЧШЕННЫЙ useEffect для автоматической анимации непрочитанных сообщений
    useEffect(() => {
        // Проверяем что инициализация завершена
        if (!isDataLoaded || !isConnected || !currentUserId || !isChatActive) {
            return;
        }

        // Находим сообщения с флагом _isNewUnread, которые еще не в состоянии непрочитанных
        const newUnreadMessages = messages.filter(msg =>
            msg._isNewUnread &&
            msg.sender_id !== currentUserId &&
            !unreadMessages.has(msg.id)
        );

        if (newUnreadMessages.length > 0) {
            console.log('✨ [AUTO-ANIMATE] ========== FOUND NEW UNREAD MESSAGES ==========');
            console.log('✨ [AUTO-ANIMATE] Count:', newUnreadMessages.length);
            console.log('✨ [AUTO-ANIMATE] Is Cold Start:', isColdStart);

            newUnreadMessages.forEach(msg => {
                // КЛЮЧЕВОЕ УЛУЧШЕНИЕ: Учитываем холодный старт и состояние приложения
                const shouldAnimate = !isColdStart || (AppState.currentState === 'active' && isChatActive);

                console.log('✨ [AUTO-ANIMATE] Message:', msg.id, 'Should animate:', shouldAnimate);

                if (shouldAnimate) {
                    // Добавляем в список непрочитанных
                    setUnreadMessages(prev => {
                        const newSet = new Set(prev);
                        newSet.add(msg.id);
                        console.log('✨ [AUTO-ANIMATE] Added to unread messages:', msg.id);
                        return newSet;
                    });

                    // Создаем анимацию
                    if (!unreadAnimations.current[msg.id]) {
                        const AnimatedNative = require('react-native').Animated;
                        unreadAnimations.current[msg.id] = new AnimatedNative.Value(1);
                        console.log('✨ [AUTO-ANIMATE] Created animation for message:', msg.id);
                    }

                    // Адаптивная задержка для холодного старта
                    const animationDelay = isColdStart ? 1000 : 2000;

                    // Запускаем анимацию прочтения
                    setTimeout(() => {
                        if (currentUserIdRef.current && isConnectedRef.current && isChatActiveRef.current) {
                            console.log('✨ [AUTO-ANIMATE] ✅ Starting read animation for:', msg.id, 'after', animationDelay + 'ms');
                            markMessageAsRead(msg.id, msg.sender_id);
                            animateMessageAsRead(msg.id);
                        }
                    }, animationDelay);
                } else {
                    // Холодный старт - сразу отмечаем как прочитанное без анимации
                    console.log('✨ [AUTO-ANIMATE] Cold start - marking as read without animation:', msg.id);
                    setTimeout(() => {
                        if (currentUserIdRef.current && isConnectedRef.current) {
                            markMessageAsRead(msg.id, msg.sender_id);
                        }
                    }, 100);
                }
            });
        }
    }, [messages, isDataLoaded, isConnected, currentUserId, isChatActive, isColdStart, unreadMessages, markMessageAsRead, animateMessageAsRead]);

    // Отслеживание состояния приложения
    useEffect(() => {
        const subscription = AppState.addEventListener('change', async nextAppState => {
            console.log('🎥 [APP-STATE] App state changed:', appState, '->', nextAppState);
            setAppState(nextAppState);

            // Обновляем состояние активности чата в зависимости от состояния приложения
            if (nextAppState === 'active') {
                setIsChatActive(true);
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
            }
        });

        return () => {
            subscription?.remove();
        };
    }, [appState]);

    // Инициализация фоновых загрузок
    useEffect(() => {
        const initializeBackgroundUploads = async () => {
            await backgroundUploadManager.loadUploads();
            await backgroundUploadManager.cleanupOldUploads();

            // Подписываемся на обновления
            const handleUploadsUpdate = (uploads: BackgroundUpload[]) => {
                setBackgroundUploads(uploads);

                // Обновляем сообщения с завершенными загрузками
                const roomUploads = uploads.filter(upload => upload.roomId === String(roomId));
                roomUploads.forEach(upload => {
                    if (upload.status === 'completed' && upload.serverUrl) {
                        // Обновляем сообщение с URL сервера
                        updateMessageSafely(upload.messageId, {
                            isUploading: false,
                            uploadProgress: 100,
                            serverFileUrl: upload.serverUrl,
                            message: upload.mediaType === 'image' ? '📷 Изображение' :
                                upload.mediaType === 'video' ? '🎥 Видео' :
                                    upload.mediaType === 'audio' ? '🎤 Аудио' :
                                        upload.fileName
                        });

                        // Удаляем завершенную загрузку через некоторое время
                        setTimeout(() => {
                            backgroundUploadManager.removeUpload(upload.id);
                        }, 5000);
                    } else if (upload.status === 'failed') {
                        // Обновляем сообщение с ошибкой
                        updateMessageSafely(upload.messageId, {
                            isUploading: false,
                            uploadProgress: 0,
                            message: `❌ Ошибка загрузки ${upload.fileName}`
                        });
                    }
                });
            };

            backgroundUploadManager.addListener(handleUploadsUpdate);

            // Первоначальная загрузка состояния
            handleUploadsUpdate(backgroundUploadManager.getAllUploads());

            return () => {
                backgroundUploadManager.removeListener(handleUploadsUpdate);
            };
        };

        initializeBackgroundUploads();
    }, [roomId]);

    // Восстановление загрузок для текущей комнаты
    useEffect(() => {
        if (!roomId || !isDataLoaded) return;

        const roomUploads = backgroundUploadManager.getUploadsForRoom(String(roomId));
        const activeUploads = roomUploads.filter(upload =>
            upload.status === 'uploading' || upload.status === 'pending'
        );

        console.log('📤 [BACKGROUND] Found', activeUploads.length, 'active uploads for room');

        // Обновляем сообщения с активными загрузками
        activeUploads.forEach(upload => {
            updateMessageSafely(upload.messageId, {
                isUploading: true,
                uploadProgress: upload.progress,
                message: `📤 Продолжается загрузка... ${upload.progress}%`
            });

            // Если загрузка зависла, пытаемся возобновить
            if (upload.status === 'pending' ||
                (upload.status === 'uploading' && Date.now() - upload.startTime > 600000)) { // 10 минут

                console.log('📤 [BACKGROUND] Attempting to resume stalled upload:', upload.id);

                // Повторно запускаем загрузку
                uploadFileGeneric(
                    upload.fileUri,
                    upload.fileName,
                    upload.mimeType,
                    upload.messageId,
                    (progress) => {
                        updateMessageSafely(upload.messageId, {
                            uploadProgress: progress,
                            message: `📤 Возобновление загрузки... ${progress}%`
                        });
                    },
                    true // Включаем фоновый режим
                ).catch(error => {
                    console.error('📤 [BACKGROUND] Failed to resume upload:', error);
                });
            }
        });
    }, [roomId, isDataLoaded]);

    useEffect(() => {
        if (!roomId) {
            router.back();
            return;
        }

        const initializeChat = async () => {

            setIsLoading(true);
            try {
                // ШАГ 1: Сначала получаем данные текущего пользователя
                const currentUser = await fetchCurrentUser();

                if (!currentUser) {
                    throw new Error('Failed to load current user');
                }

                // ШАГ 2: Получаем информацию о собеседнике
                const recipientInfo = await fetchRecipientInfo();

                if (!recipientInfo) {
                    throw new Error('Failed to load recipient');
                }
                // ШАГ 3: Загружаем историю чата
                await fetchChatHistory(1, 15);
                // ШАГ 4: Помечаем данные как загруженные
                setIsDataLoaded(true);
                // ШАГ 5: КРИТИЧНО - Подключаемся к WebSocket только после полной инициализации
                // Увеличиваем задержку чтобы React гарантированно обновил все состояния
                setTimeout(() => {
                    // Дополнительная проверка перед подключением
                    if (currentUser.id && recipientInfo.id) {
                        connect();
                    } else {
                        console.error('📜 [INIT] ❌ Cannot connect - user data not ready');
                    }
                }, 500);


            } catch (error) {
                Alert.alert('Ошибка', 'Не удалось загрузить чат');
            } finally {
                setIsLoading(false);
            }
        };

        // КРИТИЧНО: Вызываем инициализацию только один раз при монтировании
        initializeChat();

        return () => {
            disconnect();
        };
    }, [roomId]); // ВАЖНО: Только roomId в зависимостях

    // Отправка сообщения
    const handleSend = () => {
        if (!messageText.trim() || !isConnected || !isDataLoaded || !recipient?.id || !currentUserId) {
            console.log('💬 [CHAT] ❌ Cannot send - missing requirements');
            return;
        }
        const timestamp = Math.floor(Date.now() / 1000);
        const optimisticMessageId = Date.now(); // Временный ID для отслеживания
        const messageContent = messageText.trim();

        console.log('📤 [SEND] Sending message with optimistic ID:', optimisticMessageId);
        if (replyToMessage) {
            console.log('📤 [SEND] Reply to message:', replyToMessage.id, 'text:', replyToMessage.message?.substring(0, 50));
        }

        // СНАЧАЛА создаем оптимистичное сообщение для немедленного отображения
        const optimisticMessage: Message = {
            id: optimisticMessageId,
            message: messageContent,
            timestamp: timestamp,
            sender__username: currentUsername,
            sender_id: currentUserId,
            mediaType: undefined,
            mediaUri: null,
            mediaBase64: undefined,
            mediaHash: undefined,
            mediaFileName: undefined,
            mediaSize: undefined,
            isUploading: false,
            uploadProgress: 100,
            needsReload: false,
            // Помечаем как оптимистичное сообщение
            _isOptimistic: true,
            _optimisticId: optimisticMessageId,
            // Добавляем данные реплая если есть
            reply_to_message_id: replyToMessage?.id,
            reply_to_message: replyToMessage?.message,
            reply_to_sender: replyToMessage?.sender__username,
            reply_to_media_type: replyToMessage?.mediaType
        };

        // Добавляем оптимистичное сообщение в список немедленно
        setMessages(prev => [optimisticMessage, ...prev]);

        // Прокручиваем к новому сообщению
        setTimeout(() => {
            if (flatListRef.current) {
                flatListRef.current.scrollToIndex({index: 0, animated: true});
            }
        }, 100);

        // Добавляем отправленное сообщение в список непрочитанных
        setUnreadSentMessages(prev => {
            const newSet = new Set(prev);
            newSet.add(optimisticMessageId);
            console.log('📤 [SEND] Added to unread sent messages:', optimisticMessageId);
            return newSet;
        });

        // Создаем анимацию для отправленного сообщения
        if (!unreadSentAnimations.current[optimisticMessageId]) {
            const AnimatedNative = require('react-native').Animated;
            unreadSentAnimations.current[optimisticMessageId] = new AnimatedNative.Value(1);
            console.log('📤 [SEND] Created animation for sent message:', optimisticMessageId);
        }

        // Помечаем оптимистичное сообщение как непрочитанное
        optimisticMessage._isUnreadBySender = true;

        // ИСПРАВЛЕНИЕ: Отправляем через WebSocket с правильными данными реплая
        const messageData = {
            type: 'chat_message',
            message: messageContent,
            timestamp: timestamp,
            user1: currentUserId,
            user2: recipient.id,
            // КРИТИЧНО: Передаём правильный текст сообщения, а не строку 'text'
            reply_to_message_id: replyToMessage?.id,
            reply_to_message: replyToMessage?.message || null,  // ИСПРАВЛЕНО: текст сообщения
            reply_to_sender: replyToMessage?.sender__username || null,  // ИСПРАВЛЕНО: имя отправителя
            reply_to_media_type: replyToMessage?.mediaType || null
        };

        console.log('📤 [SEND] Message data being sent:', {
            type: messageData.type,
            message: messageData.message.substring(0, 30),
            hasReply: !!messageData.reply_to_message_id,
            replyText: messageData.reply_to_message?.substring(0, 30),
            replySender: messageData.reply_to_sender
        });

        try {
            sendMessage(messageData);
            setMessageText('');
            // Очищаем реплай после отправки
            cancelReply();

            console.log('📤 [SEND] ✅ Message sent to server, waiting for confirmation...');

            // Добавляем таймаут для проверки и возможной очистки оптимистичного сообщения
            setTimeout(() => {
                setMessages(prevMessages => {
                    const optimisticMessage = prevMessages.find(msg =>
                        msg._isOptimistic && msg._optimisticId === optimisticMessageId
                    );

                    if (optimisticMessage) {
                        console.log('📤 [TIMEOUT] ⚠️ Optimistic message still not confirmed after 60s:', optimisticMessageId);
                        console.log('📤 [TIMEOUT] Message content:', optimisticMessage.message?.substring(0, 50));

                        // Пробуем найти подтверждение среди других сообщений
                        const confirmedMessage = prevMessages.find(msg =>
                            !msg._isOptimistic &&
                            msg.sender_id === currentUserId &&
                            msg.message?.trim() === optimisticMessage.message?.trim() &&
                            Math.abs(Number(msg.timestamp) - Number(optimisticMessage.timestamp)) < 300 // 5 минут
                        );

                        if (confirmedMessage) {
                            console.log('📤 [TIMEOUT] ✅ Found confirmed version, removing optimistic');
                            // Найдено подтвержденное сообщение - убираем оптимистичное
                            setUnreadSentMessages(prev => {
                                const newSet = new Set(prev);
                                newSet.delete(optimisticMessageId);
                                return newSet;
                            });
                            delete unreadSentAnimations.current[optimisticMessageId];
                            return prevMessages.filter(msg => msg.id !== optimisticMessageId);
                        } else {
                            console.log('📤 [TIMEOUT] ⚠️ No confirmed version found, keeping optimistic message');
                            // Не найдено подтверждение - оставляем оптимистичное сообщение
                            return prevMessages;
                        }
                    }

                    return prevMessages;
                });
            }, 60000); // 60 секунд на подтверждение

        } catch (error) {
            console.error('📤 [SEND] ❌ Error sending message:', error);

            // При ошибке убираем оптимистичное сообщение
            setMessages(prev => prev.filter(msg => msg.id !== optimisticMessageId));

            // И убираем из непрочитанных отправленных
            setUnreadSentMessages(prev => {
                const newSet = new Set(prev);
                newSet.delete(optimisticMessageId);
                return newSet;
            });
            delete unreadSentAnimations.current[optimisticMessageId];

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

        // Получаем активные загрузки для текущей комнаты
        const activeUploads = backgroundUploads.filter(upload =>
            upload.roomId === String(roomId) &&
            (upload.status === 'uploading' || upload.status === 'pending')
        );

        if (isSelectionMode) {
            // Панель действий при выделении сообщений
            return (
                <View style={styles.selectionHeader}>
                    <TouchableOpacity
                        style={styles.selectionBackButton}
                        onPress={exitSelectionMode}
                    >
                        <MaterialIcons name="close" size={24} color={theme.primary}/>
                    </TouchableOpacity>

                    <View style={styles.selectionInfo}>
                        <Text style={[styles.selectionCount, {color: theme.text}]}>
                            {selectedMessages.size} выбрано
                        </Text>
                    </View>

                    <View style={styles.selectionActions}>
                        {messages.length > 0 && selectedMessages.size < messages.length && (
                            <TouchableOpacity
                                style={styles.selectionActionButton}
                                onPress={selectAllMessages}
                            >
                                <MaterialIcons name="select-all" size={24} color={theme.primary}/>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity
                            style={styles.selectionActionButton}
                            onPress={forwardSelectedMessages}
                        >
                            <MaterialIcons name="forward" size={24} color={theme.primary}/>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.selectionActionButton}
                            onPress={deleteSelectedMessages}
                        >
                            <MaterialIcons name="delete" size={24} color={theme.error || '#ff4444'}/>
                        </TouchableOpacity>
                    </View>
                </View>
            );
        }

        return (
            <TouchableOpacity
                style={styles.headerUserInfo}
                onPress={navigateToProfile}
                activeOpacity={0.7}
            >
                <View style={styles.userInfo}>
                    <Text style={[styles.username, {color: theme.text}]}>{recipient?.username || 'Пользователь'}</Text>
                    <View style={styles.statusRow}>
                        <Text style={[
                            styles.onlineStatus,
                            {color: userStatus ? theme.online : theme.offline}
                        ]}>
                            {userStatus ? 'в сети' : 'не в сети'}
                        </Text>
                        {activeUploads.length > 0 && (
                            <View style={styles.uploadIndicator}>
                                <ActivityIndicator size="small" color={theme.primary}/>
                                <Text style={[styles.uploadIndicatorText, {color: theme.primary}]}>
                                    {activeUploads.length} загр.
                                </Text>
                            </View>
                        )}
                    </View>
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
    };

    // Функция для получения пути к кешированному видео
    const getCachedVideoPath = (messageId: number): string => {
        return `${FileSystem.documentDirectory}cached_video_${messageId}.mp4`;
    };
    // Функция для проверки существования и целостности видео в кеше
    const checkVideoCacheExists = async (messageId: number): Promise<boolean> => {
        try {
            const cachedPath = getCachedVideoPath(messageId);
            const fileInfo = await FileSystem.getInfoAsync(cachedPath);

            if (fileInfo.exists && fileInfo.size && fileInfo.size > 1024) { // Минимум 1KB для валидного видео
                console.log('📹 [VIDEO-CACHE] Cache exists:', {
                    messageId,
                    size: Math.round(fileInfo.size / 1024) + 'KB',
                    path: cachedPath.substring(cachedPath.lastIndexOf('/') + 1)
                });
                return true;
            } else {
                if (fileInfo.exists && (!fileInfo.size || fileInfo.size <= 1024)) {
                    console.warn('📹 [VIDEO-CACHE] ⚠️ Corrupted cache detected (too small), deleting:', {
                        messageId,
                        size: fileInfo.size,
                        path: cachedPath.substring(cachedPath.lastIndexOf('/') + 1)
                    });
                    // Удаляем поврежденный кеш
                    try {
                        await FileSystem.deleteAsync(cachedPath, {idempotent: true});
                    } catch (deleteError) {
                        console.error('📹 [VIDEO-CACHE] Failed to delete corrupted cache:', deleteError);
                    }
                }
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
            const cachedPath = getCachedVideoPath(messageId);

            // Проверяем, не закеширован ли уже файл
            const exists = await checkVideoCacheExists(messageId);
            if (exists) {
                console.log('📹 [VIDEO-CACHE] ✅ Video already cached');
                return cachedPath;
            }

            // Загружаем видео с сервера и сохраняем локально
            if (videoUri.startsWith('http')) {

                const downloadResult = await FileSystem.downloadAsync(
                    videoUri,
                    cachedPath,
                    {
                        sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
                    }
                );

                if (downloadResult.status === 200) {
                    // Проверяем целостность скачанного файла
                    const fileInfo = await FileSystem.getInfoAsync(cachedPath);
                    const minFileSize = 10 * 1024; // Минимум 10KB для видеофайла

                    if (fileInfo.exists && fileInfo.size && fileInfo.size > minFileSize) {
                        console.log('📹 [VIDEO-CACHE] ✅ File cached successfully:', {
                            messageId,
                            size: Math.round(fileInfo.size / 1024) + 'KB',
                            downloadStatus: downloadResult.status
                        });
                        return cachedPath;
                    } else {
                        console.error('📹 [VIDEO-CACHE] ❌ Downloaded file is corrupted or too small:', {
                            exists: fileInfo.exists,
                            size: fileInfo.size,
                            minRequired: minFileSize,
                            downloadStatus: downloadResult.status
                        });

                        // Удаляем поврежденный файл
                        try {
                            if (fileInfo.exists) {
                                await FileSystem.deleteAsync(cachedPath, {idempotent: true});
                                console.log('📹 [VIDEO-CACHE] Corrupted file deleted');
                            }
                        } catch (e) {
                            console.error('📹 [VIDEO-CACHE] Failed to delete corrupted download:', e);
                        }
                        throw new Error(`Downloaded file is corrupted (size: ${fileInfo.size || 0} bytes)`);
                    }
                } else {
                    throw new Error(`Download failed with status ${downloadResult.status}`);
                }
            } else if (videoUri.startsWith('file://')) {
                // Копируем локальный файл в кеш

                await FileSystem.copyAsync({
                    from: videoUri,
                    to: cachedPath
                });

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
        if (!message.serverFileUrl && !message.mediaUri) {
            console.log('📄 [DOC-DOWNLOAD] ❌ No URL available, requesting from API...');

            // Попытка загрузить URL через API если его нет
            const serverUrl = await getMediaServerUrl(message.id);
            if (serverUrl) {
                updateMessageSafely(message.id, {serverFileUrl: serverUrl, mediaUri: serverUrl});
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

                return;
            }

            // Помечаем как загружающийся
            setDownloadingDocuments(prev => ({...prev, [messageId]: true}));
            setDocumentDownloadProgress(prev => ({...prev, [messageId]: 0}));

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
                    await openDocument(localFilePath, fileName);
                    setDownloadingDocuments(prev => ({...prev, [messageId]: false}));
                    return;
                }
                const downloadResult = await FileSystem.downloadAsync(
                    sourceUri,
                    localFilePath,
                    {
                        sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
                    }
                );

                if (downloadResult.status === 200) {
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
                    {text: 'OK', style: 'default'},
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
            setDownloadingDocuments(prev => ({...prev, [messageId]: false}));
            setDocumentDownloadProgress(prev => ({...prev, [messageId]: 0}));
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
                    [{text: 'OK'}]
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
                    [{text: 'OK'}]
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
                const mimeTypes: { [key: string]: string } = {
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
                    {text: 'OK', style: 'default'},
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
        // Получаем все ID видео которые сейчас воспроизводятся
        const playingVideoIds = Object.keys(inlineVideoStates).filter(
            id => inlineVideoStates[id]?.isPlaying && String(id) !== String(exceptMessageId)
        );

        // Останавливаем каждое видео
        for (const videoId of playingVideoIds) {
            try {
                const videoRef = inlineVideoRefs.current[videoId];
                if (videoRef) {
                    await videoRef.pauseAsync();

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
                // Игнорируем ошибки остановки видео
            }
        }
    };

    // Функции управления встроенным видео
    const toggleInlineVideo = async (messageId: string | number, videoUri: string) => {
        const currentState = inlineVideoStates[messageId] || {
            isPlaying: false,
            isMuted: false,
            isExpanded: false,
            duration: 0,
            position: 0,
            isLoaded: false,
            isFullscreen: false
        };
        const newPlayingState = !currentState.isPlaying;

        // Если видео не загружено, но мы хотим его воспроизвести - играем с сервера
        if (!currentState.isLoaded && newPlayingState) {
            const message = messages.find(msg => String(msg.id) === String(messageId));
            if (message) {
                // Получаем серверный URL если его нет
                let serverUrl = message.serverFileUrl || videoUri;
                if (!serverUrl?.startsWith('http')) {
                    serverUrl = await getMediaServerUrl(Number(messageId));
                    if (serverUrl) {
                        updateMessageSafely(message.id, {
                            serverFileUrl: serverUrl
                        });
                    }
                }

                if (serverUrl?.startsWith('http')) {
                    // Обновляем URI на серверный для немедленного воспроизведения
                    updateMessageSafely(message.id, {
                        mediaUri: serverUrl
                    });
                    videoUri = serverUrl;

                    // ФОНОВОЕ КЕШИРОВАНИЕ: запускаем кеширование в фоне
                    cacheVideoToDevice(serverUrl, Number(messageId)).then(cachedPath => {
                        if (cachedPath) {
                            // При следующем воспроизведении будет использован кеш
                        }
                    }).catch(() => {
                        // Игнорируем ошибки кеширования
                    });
                } else {
                    return;
                }
            }
        }

        // Проверяем кеш и доступность видео для уже загруженных компонентов
        const message = messages.find(msg => String(msg.id) === String(messageId));
        if (message && currentState.isLoaded) {
            // Проверяем кеш только для загруженных компонентов
            const cacheExists = await checkVideoCacheExists(Number(messageId));

            if (cacheExists) {
                // Используем кешированную версию
                const cachedPath = getCachedVideoPath(Number(messageId));

                if (videoUri !== cachedPath) {
                    // Обновляем URI если он отличается
                    updateMessageSafely(message.id, {
                        mediaUri: cachedPath
                    });
                    videoUri = cachedPath;
                }
            } else if (!videoUri.startsWith('http')) {
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
                    videoUri = message.serverFileUrl;
                } else {
                    // Запрашиваем URL с сервера
                    await requestVideoLoad(message);
                    return;
                }
            } else if (videoUri.startsWith('http')) {
                // Кешируем в фоновом режиме при воспроизведении
                cacheVideoToDevice(videoUri, Number(messageId)).then(cachedPath => {
                    if (cachedPath) {
                        // Обновляем URI на следующее воспроизведение
                        updateMessageSafely(message.id, {
                            mediaUri: cachedPath
                        });
                    }
                }).catch(() => {
                    // Игнорируем ошибки кеширования
                });
            }
        }

        try {
            const videoRef = inlineVideoRefs.current[messageId];

            if (!videoRef) {
                return;
            }

            if (newPlayingState) {
                // При запуске видео сначала останавливаем все другие видео
                await pauseAllOtherVideos(messageId);

                // Проверяем состояние приложения
                if (appState !== 'active') {
                    return;
                }

                // При запуске видео сначала убеждаемся что оно отключено (для избежания ошибок аудио)
                await videoRef.setIsMutedAsync(true); // Начинаем без звука
                await videoRef.playAsync();
            } else {
                await videoRef.pauseAsync();
            }

            // Обновляем состояние
            setInlineVideoStates(prev => ({
                ...prev,
                [messageId]: {...currentState, isPlaying: newPlayingState}
            }));

        } catch (error: any) {
            // Специальная обработка ошибки незагруженного компонента
            if (error.message?.includes('has not yet loaded') ||
                error.message?.includes('not yet loaded')) {
                return;
            }

            if (error.message?.includes('AudioFocusNotAcquiredException') ||
                error.message?.includes('background')) {
                // Просто игнорируем ошибки фонового режима
                return;
            }
        }
    };

    const toggleInlineVideoSound = async (messageId: string | number) => {
        // Проверяем, что приложение активно
        if (appState !== 'active') {
            return;
        }

        const currentState = inlineVideoStates[messageId] || {
            isPlaying: false,
            isMuted: false,
            isExpanded: false,
            duration: 0,
            position: 0,
            isLoaded: false,
            isFullscreen: false,
            isResetting: false
        };

        // Проверяем, что видео компонент загружен
        if (!currentState.isLoaded) {
            return;
        }

        const newMutedState = !currentState.isMuted;

        try {
            const videoRef = inlineVideoRefs.current[messageId];
            if (videoRef) {
                await videoRef.setIsMutedAsync(newMutedState);
                setInlineVideoStates(prev => ({
                    ...prev,
                    [messageId]: {...currentState, isMuted: newMutedState}
                }));
            }
        } catch (error: any) {
            // Специальная обработка ошибки незагруженного компонента
            if (error.message?.includes('has not yet loaded') ||
                error.message?.includes('not yet loaded')) {
                return;
            }

            // Обрабатываем специфичные ошибки
            if (error.message?.includes('AudioFocusNotAcquiredException') ||
                error.message?.includes('background')) {
                // Просто игнорируем ошибки звука в фоновом режиме
                return;
            }
        }
    };


    // Улучшенная функция переключения полноэкранного режима
    const toggleVideoFullscreen = async (messageId: string | number, videoUri: string) => {
        const currentState = inlineVideoStates[messageId] || {
            isPlaying: false,
            isMuted: false,
            isExpanded: false,
            duration: 0,
            position: 0,
            isLoaded: false,
            isFullscreen: false
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

        if (!currentState.isFullscreen) {
            // ОСТАНАВЛИВАЕМ поток видео в миниатюре перед открытием полноэкранного режима
            const videoRef = inlineVideoRefs.current[messageId];
            if (videoRef && currentState.isPlaying) {
                try {
                    await videoRef.pauseAsync();
                } catch (error) {
                    // Игнорируем ошибки остановки видео
                }
            }

            // Включаем полноэкранный режим через модальное окно
            setFullscreenModalVideoUri(finalVideoUri);
            setSelectedVideo(finalVideoUri);
            setSelectedMessageId(Number(messageId));
            setIsFullscreenModalVisible(true);
            setInlineVideoStates(prev => ({
                ...prev,
                [messageId]: {
                    ...currentState,
                    isFullscreen: true,
                    isPlaying: false
                }
            }));
        } else {
            // ИСПРАВЛЕНИЕ: Правильный выход из полноэкранного режима
            setIsFullscreenModalVisible(false);
            setFullscreenModalVideoUri(null);
            setSelectedVideo(null);
            setSelectedMessageId(null);

            // КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Сбрасываем ВСЕ состояния к нормальным значениям
            setInlineVideoStates(prev => ({
                ...prev,
                [messageId]: {
                    ...currentState,
                    isFullscreen: false,
                    isExpanded: false,  // ВАЖНО: сбрасываем isExpanded
                    isPlaying: false    // Останавливаем воспроизведение
                }
            }));
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
            const currentState = inlineVideoStates[messageId];

            if (videoRef && currentState) {
                // Сначала останавливаем воспроизведение
                if (currentState.isPlaying) {
                    await videoRef.pauseAsync();
                }

                // Затем перематываем в начало
                await videoRef.setPositionAsync(0);

                // Обновляем состояние
                setInlineVideoStates(prev => ({
                    ...prev,
                    [messageId]: {
                        ...currentState,
                        position: 0,
                        isPlaying: false
                    }
                }));
            }
        } catch (error) {
            console.error('🎥 [INLINE] Error resetting video:', error);
            // При ошибке просто обновляем состояние
            const currentState = inlineVideoStates[messageId];
            if (currentState) {
                setInlineVideoStates(prev => ({
                    ...prev,
                    [messageId]: {
                        ...currentState,
                        position: 0,
                        isPlaying: false
                    }
                }));
            }
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
                            {text: 'Отмена', style: 'cancel'},
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
                    {text: 'Отмена', style: 'cancel'},
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
        // ИСПРАВЛЕНИЕ: Только динамические непрочитанные сообщения (из состояния)
        const isUnread = unreadMessages.has(item.id);
        const animatedValue = unreadAnimations.current[item.id];

        // Проверяем, является ли отправленное сообщение непрочитанным получателем
        // Учитываем как динамические непрочитанные, так и из истории
        const isSentUnread = unreadSentMessages.has(item.id) || (isMyMessage && item._isUnreadBySender);
        const sentAnimatedValue = unreadSentAnimations.current[item.id];

        const renderMediaContent = () => {
            // Показываем индикатор загрузки если файл загружается
            if (item.isUploading) {
                return (
                    <View style={styles.uploadingContainer}>
                        <View style={styles.uploadingContent}>
                            <ActivityIndicator size="small" color={theme.primary}/>
                            <Text style={[styles.uploadingText, {color: theme.textSecondary}]}>
                                {item.mediaType === 'image' ? 'Загрузка изображения...' : 'Загрузка видео...'}
                            </Text>
                            {item.uploadProgress !== undefined && item.uploadProgress > 0 && (
                                <View style={styles.progressContainer}>
                                    <View style={[styles.progressBar, {backgroundColor: theme.border}]}>
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
                                    <Text style={[styles.progressText, {color: theme.textSecondary}]}>
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
                            <ActivityIndicator size="small" color={theme.primary}/>
                            <Text style={[styles.uploadingText, {color: theme.textSecondary}]}>
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
                                    {text: 'Понятно', style: 'default'},
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
                            <Text style={[styles.reloadText, {color: theme.textSecondary}]}>
                                {item.mediaType === 'image'
                                    ? `📷 Изображение ${fileSizeMB}MB`
                                    : `🎥 Видео ${fileSizeMB}MB`
                                }
                            </Text>
                            <Text style={[styles.reloadSubtext, {color: theme.placeholder}]}>
                                Большой файл удален из кэша
                            </Text>
                            <Text style={[styles.reloadHint, {color: theme.primary}]}>
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

                                if (!item.isLoadingServerUrl && !item.serverFileUrl) {
                                    updateMessageSafely(item.id, {isLoadingServerUrl: true});

                                    // ТОТ ЖЕ API ЧТО И ДЛЯ ВИДЕО
                                    const serverUrl = await getMediaServerUrl(item.id);
                                    if (serverUrl) {
                                        updateMessageSafely(item.id, {
                                            serverFileUrl: serverUrl,
                                            isLoadingServerUrl: false
                                        });
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
                            <MaterialIcons name="image" size={48} color={theme.textSecondary}/>
                            <Text style={[styles.missingMediaText, {color: theme.textSecondary}]}>
                                Изображение {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + 'MB' : ''}
                            </Text>
                            <Text style={[styles.missingMediaSubtext, {color: theme.placeholder}]}>
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
                                    updateMessageSafely(item.id, {isLoadingServerUrl: true});

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

                                // СНАЧАЛА ПРОВЕРЯЕМ КЕШ
                                const cacheExists = await checkVideoCacheExists(item.id);
                                if (cacheExists) {
                                    const cachedPath = getCachedVideoPath(item.id);
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
                                    <MaterialIcons name="play-circle-filled" size={64} color={theme.primary}/>
                                    <Text style={[styles.videoPreviewTitle, {color: theme.text}]}>
                                        🎥 Видео
                                    </Text>
                                    <Text style={[styles.videoPreviewSize, {color: theme.textSecondary}]}>
                                        {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + ' MB' : 'Размер неизвестен'}
                                    </Text>
                                    <Text style={[styles.videoPreviewHint, {color: theme.primary}]}>
                                        Нажмите ▶ для воспроизведения
                                    </Text>
                                    <Text style={[styles.videoPreviewNote, {color: theme.placeholder}]}>
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
                            <ActivityIndicator size="large" color={theme.primary}/>
                            <Text style={[styles.videoLoadingText, {color: theme.textSecondary}]}>
                                Загрузка видео...
                            </Text>
                            <Text style={[styles.videoLoadingSize, {color: theme.placeholder}]}>
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
                            <MaterialIcons name="videocam-off" size={48} color={theme.textSecondary}/>
                            <Text style={[styles.missingMediaText, {color: theme.textSecondary}]}>
                                Видео {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + 'MB' : ''}
                            </Text>
                            <Text style={[styles.missingMediaSubtext, {color: theme.placeholder}]}>
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
                    isPlaying: false,
                    isMuted: false,
                    isExpanded: false,
                    duration: 0,
                    position: 0,
                    isLoaded: false,
                    isResetting: false
                };

                // ИСПРАВЛЕНИЕ: Упрощенная логика без промежуточного expanded состояния
                const containerStyle = videoState.isFullscreen
                    ? styles.deviceFullscreenVideoContainer
                    : styles.inlineVideoContainer;

                const videoStyle = videoState.isFullscreen
                    ? styles.deviceFullscreenVideo
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
                            videoStyle={{backgroundColor: 'black'}} // Оптимизация рендеринга
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
                                            error?.error?.includes('FileNotFound') || error?.error?.includes('failed to load') ? 'cache' :
                                                error?.error?.includes('UnrecognizedInputFormatException') ? 'format' :
                                                    error?.error?.includes('extractors') ? 'format' :
                                                        error?.error?.includes('FileDataSourceException') ? 'file_access' : 'unknown'
                                });

                                // Проверяем, является ли это ошибкой кэша или доступа к файлу
                                const isCacheError = error?.error?.includes('FileNotFound') ||
                                    error?.error?.includes('failed to load') ||
                                    error?.error?.includes('unable to read file') ||
                                    error?.error?.includes('FileDataSourceException');

                                const isFormatError = error?.error?.includes('UnrecognizedInputFormatException') ||
                                    error?.error?.includes('None of the available extractors') ||
                                    error?.error?.includes('could read the stream');

                                const isLocalFileError = !videoUri?.startsWith('http') && (isCacheError || isFormatError);

                                if (isLocalFileError || isFormatError) {
                                    const errorType = isCacheError ? 'cache/file_access' : 'format';
                                    console.log('🎥 [AUTO-FALLBACK] ========== HANDLING VIDEO ERROR ==========');
                                    console.log('🎥 [AUTO-FALLBACK] Error type:', errorType);
                                    console.log('🎥 [AUTO-FALLBACK] Original error:', error?.error?.substring(0, 200));
                                    console.log('🎥 [AUTO-FALLBACK] Video URI:', videoUri);
                                    console.log('🎥 [AUTO-FALLBACK] Is local file:', !videoUri?.startsWith('http'));

                                    // Удаляем поврежденный кеш если это локальный файл
                                    if (videoUri?.startsWith('file://')) {
                                        console.log('🎥 [AUTO-FALLBACK] Deleting corrupted cache file...');
                                        try {
                                            // Проверяем существование файла перед удалением
                                            const fileInfo = await FileSystem.getInfoAsync(videoUri);
                                            if (fileInfo.exists) {
                                                await FileSystem.deleteAsync(videoUri, {idempotent: true});
                                                console.log('🎥 [AUTO-FALLBACK] ✅ Corrupted cache file deleted');
                                            } else {
                                                console.log('🎥 [AUTO-FALLBACK] File already does not exist');
                                            }
                                        } catch (deleteError) {
                                            console.warn('🎥 [AUTO-FALLBACK] Failed to delete corrupted cache:', deleteError);
                                        }
                                    }

                                    console.log('🎥 [AUTO-FALLBACK] Switching to server URL...');
                                    updateMessageSafely(item.id, {
                                        videoIsLoading: true
                                    });

                                    try {
                                        // Получаем серверный URL и используем его напрямую (без кеширования)
                                        let serverUrl = item.serverFileUrl;
                                        if (!serverUrl) {
                                            console.log('🎥 [AUTO-FALLBACK] No cached server URL, requesting from API...');
                                            serverUrl = await getMediaServerUrl(item.id);
                                        } else {
                                            console.log('🎥 [AUTO-FALLBACK] Using cached server URL');
                                        }

                                        if (serverUrl) {
                                            console.log('🎥 [AUTO-FALLBACK] ✅ Using server URL directly (bypassing cache)');
                                            console.log('🎥 [AUTO-FALLBACK] Server URL:', serverUrl.substring(0, 100) + '...');
                                            updateMessageSafely(item.id, {
                                                serverFileUrl: serverUrl,
                                                mediaUri: serverUrl, // Используем серверный URL напрямую
                                                videoLoadRequested: true,
                                                videoIsLoading: false,
                                                needsReload: false
                                            });
                                        } else {
                                            throw new Error('No server URL available');
                                        }
                                    } catch (serverError) {
                                        console.error('🎥 [AUTO-FALLBACK] ❌ Failed to get server URL:', serverError);
                                        updateMessageSafely(item.id, {
                                            videoIsLoading: false,
                                            needsReload: true
                                        });

                                        // Показываем пользователю информативное сообщение
                                        Alert.alert(
                                            'Проблема с видео',
                                            'Не удалось загрузить видео. Возможно, файл поврежден или удален с сервера.',
                                            [{text: 'OK'}]
                                        );
                                    }

                                    return;
                                }

                                // Определяем тип ошибки и показываем соответствующее решение
                                const isCodecError = error?.error?.includes('MediaCodecRenderer') ||
                                    error?.error?.includes('Decoder init failed');

                                if (isCodecError) {
                                    // Ошибка кодека - автоматически открываем в браузере
                                    console.log('🎥 [AUTO-FALLBACK] Codec error detected, opening in browser');

                                    // Получаем серверный URL для открытия в браузере
                                    let browserUrl = videoUri;
                                    if (!browserUrl?.startsWith('http')) {
                                        browserUrl = item.serverFileUrl;
                                        if (!browserUrl) {
                                            try {
                                                browserUrl = await getMediaServerUrl(item.id);
                                            } catch (e) {
                                                console.error('Failed to get server URL for browser:', e);
                                            }
                                        }
                                    }

                                    if (browserUrl?.startsWith('http')) {
                                        // Для HTTP видео - сразу открываем в браузере
                                        Alert.alert(
                                            'Несовместимый кодек',
                                            'Видео использует кодек, который не поддерживается устройством. Открыть в браузере?',
                                            [
                                                {text: 'Отмена', style: 'cancel'},
                                                {
                                                    text: 'Открыть в браузере',
                                                    onPress: async () => {
                                                        try {
                                                            await WebBrowser.openBrowserAsync(browserUrl, {
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
                                            'Встроенный плеер не может воспроизвести это видео.\n\nПопробовать системный плеер?',
                                            [
                                                {text: 'Отмена', style: 'cancel'},
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
                                    console.log('🎥 [AUTO-FALLBACK] Unknown video error, marking for reload');
                                    updateMessageSafely(item.id, {needsReload: true});
                                }
                            }}
                            onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                                if ('error' in status) {
                                    // Обрабатываем ошибки воспроизведения
                                    const playbackError = status.error?.toString() || '';
                                    if (playbackError.includes('FileDataSourceException') ||
                                        playbackError.includes('FileNotFound') ||
                                        playbackError.includes('UnrecognizedInputFormatException')) {
                                        // Ошибка будет обработана в onError выше
                                    }
                                } else if ('durationMillis' in status && status.isLoaded && status.durationMillis > 0) {
                                    const currentState = inlineVideoStates[messageId] || {
                                        isPlaying: false,
                                        isMuted: false,
                                        isExpanded: false,
                                        duration: 0,
                                        position: 0,
                                        isLoaded: false,
                                        isResetting: false
                                    };

                                    // Проверяем, закончилось ли видео
                                    const isNearEnd = status.positionMillis >= status.durationMillis - 200; // 200ms до конца
                                    const isAtEnd = status.positionMillis >= status.durationMillis - 100; // 100ms до конца

                                    if (isAtEnd && currentState.isPlaying && !currentState.isResetting) {
                                        console.log('🎥 [VIDEO-END] Video reached end, resetting to beginning:', messageId);

                                        // Помечаем что видео сбрасывается, чтобы избежать повторных вызовов
                                        setInlineVideoStates(prev => ({
                                            ...prev,
                                            [messageId]: {
                                                ...currentState,
                                                isResetting: true,
                                                isPlaying: false
                                            }
                                        }));

                                        // Перематываем в начало с небольшой задержкой
                                        setTimeout(async () => {
                                            try {
                                                const videoRef = inlineVideoRefs.current[messageId];
                                                if (videoRef) {
                                                    await videoRef.setPositionAsync(0);
                                                    // Снимаем флаг сброса и готовы к новому воспроизведению
                                                    setInlineVideoStates(prev => ({
                                                        ...prev,
                                                        [messageId]: {
                                                            ...prev[messageId],
                                                            position: 0,
                                                            isResetting: false,
                                                            isPlaying: false
                                                        }
                                                    }));
                                                }
                                            } catch (error) {
                                                console.error('🎥 [VIDEO-END] Error resetting video:', error);
                                                // Снимаем флаг даже при ошибке
                                                setInlineVideoStates(prev => ({
                                                    ...prev,
                                                    [messageId]: {
                                                        ...prev[messageId],
                                                        isResetting: false,
                                                        isPlaying: false
                                                    }
                                                }));
                                            }
                                        }, 150);
                                        return;
                                    }

                                    // Обычное обновление состояния (не во время сброса)
                                    if (!currentState.isResetting) {
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
                                }
                            }}
                        />


                        {/* Контролы видео - только для инлайн режима */}
                        {!videoState.isFullscreen && (
                            <View style={styles.inlineVideoControls}>
                                <TouchableOpacity
                                    style={styles.inlineVideoButton}
                                    onPress={() => toggleVideoFullscreen(messageId, videoUri)}
                                >
                                    <MaterialIcons
                                        name="fullscreen"
                                        size={20}
                                        color="white"
                                    />
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Прогресс-бар (перемещён под кнопки) */}
                        {videoState.isLoaded && videoState.duration > 0 && (
                            <View style={styles.videoProgressContainer}>
                                <View style={styles.videoProgressBar}>
                                    <View
                                        style={[
                                            styles.videoProgressFill,
                                            {width: `${(videoState.position / videoState.duration) * 100}%`}
                                        ]}
                                    />
                                </View>
                                <TouchableOpacity
                                    style={styles.videoProgressTouch}
                                    onPress={(event) => {
                                        if (videoState.duration > 0) {
                                            const {locationX} = event.nativeEvent;
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
                                    {Math.floor(videoState.position / 1000)}s
                                    / {Math.floor((videoState.duration ?? 0) / 1000)}s
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
                                if (!item.isLoadingServerUrl && !item.serverFileUrl) {
                                    updateMessageSafely(item.id, {isLoadingServerUrl: true});

                                    const serverUrl = await getMediaServerUrl(item.id);
                                    if (serverUrl) {
                                        updateMessageSafely(item.id, {
                                            serverFileUrl: serverUrl,
                                            mediaUri: serverUrl,
                                            isLoadingServerUrl: false
                                        });
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
                                    <ActivityIndicator size="small" color={theme.primary}/>
                                    <Text style={[styles.audioLoadingText, {color: theme.textSecondary}]}>
                                        Загрузка аудио...
                                    </Text>
                                </View>
                            ) : (
                                <View style={styles.audioPlayerContainer}>
                                    <MaterialIcons name="mic" size={24} color={theme.textSecondary}/>
                                    <Text style={[styles.audioLoadingText, {color: theme.textSecondary}]}>
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
                        <View style={[styles.audioPlayButton, {backgroundColor: theme.primary}]}>
                            <MaterialIcons
                                name={isPlaying ? "pause" : "play-arrow"}
                                size={24}
                                color="white"
                            />
                        </View>

                        <View style={styles.audioWaveform}>
                            <View style={[styles.audioProgressBar, {backgroundColor: theme.border}]}>
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
                            <Text style={[styles.audioDuration, {color: theme.textSecondary}]}>
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
                                if (!item.isLoadingServerUrl && !item.serverFileUrl) {
                                    updateMessageSafely(item.id, {isLoadingServerUrl: true});

                                    // ЗАГРУЖАЕМ URL ЧЕРЕЗ API (как для изображений и видео)
                                    const serverUrl = await getMediaServerUrl(item.id);
                                    if (serverUrl) {
                                        updateMessageSafely(item.id, {
                                            serverFileUrl: serverUrl,
                                            mediaUri: serverUrl,
                                            isLoadingServerUrl: false
                                        });
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
                                    <ActivityIndicator size="small" color={theme.primary}/>
                                    <Text style={[styles.missingMediaText, {color: theme.textSecondary, marginTop: 8}]}>
                                        Загрузка документа...
                                    </Text>
                                </>
                            ) : (
                                <>
                                    <MaterialIcons name="description" size={48} color={theme.textSecondary}/>
                                    <Text style={[styles.missingMediaText, {color: theme.textSecondary}]}>
                                        {item.mediaFileName || 'Документ'} {item.mediaSize ? Math.round(item.mediaSize / (1024 * 1024)) + 'MB' : ''}
                                    </Text>
                                    <Text style={[styles.missingMediaSubtext, {color: theme.placeholder}]}>
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
                                <ActivityIndicator size="small" color={theme.primary}/>
                            ) : (
                                <MaterialIcons
                                    name={fileIcon as any}
                                    size={32}
                                    color={theme.primary}
                                />
                            )}
                        </View>
                        <View style={styles.fileInfo}>
                            <Text style={[styles.fileName, {color: theme.text}]} numberOfLines={5}>
                                {item.mediaFileName || 'Документ'}
                            </Text>
                            <Text style={[styles.fileSize, {color: theme.textSecondary}]}>
                                {item.mediaSize ? `${Math.round(item.mediaSize / 1024)} КБ` : 'Размер неизвестен'}
                            </Text>
                            {item.mimeType && (
                                <Text style={[styles.fileMimeType, {color: theme.placeholder}]}>
                                    {item.mimeType}
                                </Text>
                            )}
                            {isDownloading && (
                                <View style={styles.downloadProgressContainer}>
                                    <View style={[styles.downloadProgressBar, {backgroundColor: theme.border}]}>
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
                                    <Text style={[styles.downloadProgressText, {color: theme.textSecondary}]}>
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
        // ИСПРАВЛЕНИЕ: Используем исходную структуру с AnimatedView
        const AnimatedNative = require('react-native').Animated;
        const AnimatedView = AnimatedNative.View;

        // Создаем анимированный стиль для непрочитанных сообщений
        const getBackgroundStyle = () => {
            // Для моих сообщений, непрочитанных получателем
            if (isMyMessage && (isSentUnread || !item.read) && sentAnimatedValue) {
                return {
                    backgroundColor: sentAnimatedValue.interpolate({
                        inputRange: [0, 1],
                        outputRange: [
                            theme.primary, // Обычный цвет после прочтения
                            'rgba(255, 152, 0, 0.9)' // Яркий оранжевый для непрочитанных отправленных
                        ]
                    })
                };
            }

            // Статичная индикация для непрочитанных отправленных сообщений без анимации
            if (isMyMessage && (isSentUnread || !item.read) && !sentAnimatedValue) {
                return {
                    backgroundColor: 'rgba(255, 152, 0, 0.9)' // Яркий оранжевый для непрочитанных отправленных
                };
            }

            // Для полученных сообщений, которые я еще не прочитал
            if (!isMyMessage && (isUnread || item._isNewUnread) && animatedValue) {
                return {
                    backgroundColor: animatedValue.interpolate({
                        inputRange: [0, 1],
                        outputRange: [
                            theme.surface, // Обычный цвет после прочтения
                            'rgba(76, 175, 80, 0.8)' // Зеленый оттенок для непрочитанных полученных
                        ]
                    })
                };
            }

            // Для новых непрочитанных сообщений без анимации (статичное отображение)
            if (!isMyMessage && (isUnread || item._isNewUnread)) {
                return {
                    backgroundColor: 'rgba(76, 175, 80, 0.8)' // Зеленый для новых непрочитанных
                };
            }

            // Обычный статичный стиль для прочитанных сообщений
            return {
                backgroundColor: isMyMessage ? theme.primary : theme.surface
            };
        };

        const backgroundStyle = getBackgroundStyle();
        const isSelected = selectedMessages.has(Number(item.id));

        // Создаем обработчики событий
        const handlePress = () => {
            if (isSelectionMode) {
                toggleMessageSelection(Number(item.id));
            }
        };

        const handleLongPress = () => {
            if (isSelectionMode) {
                toggleMessageSelection(Number(item.id));
            } else {
                // Сразу входим в режим выделения при долгом нажатии
                enterSelectionMode(Number(item.id));
            }
        };

        // Обработчик двойного нажатия для контекстного меню
        const handleDoublePress = () => {
            if (isSelectionMode) return;

            if (isMyMessage) {
                Alert.alert(
                    'Действия с сообщением',
                    'Выберите действие:',
                    [
                        {text: 'Отмена', style: 'cancel'},
                        {
                            text: 'Выделить',
                            onPress: () => enterSelectionMode(Number(item.id))
                        },
                        {
                            text: 'Удалить у себя',
                            onPress: () => deleteMessage(Number(item.id), 'for_me')
                        },
                        {
                            text: 'Удалить у всех',
                            style: 'destructive',
                            onPress: () => deleteMessage(Number(item.id), 'for_everyone')
                        }
                    ],
                    {cancelable: true}
                );
            } else {
                // Для чужих сообщений
                Alert.alert(
                    'Действия с сообщением',
                    'Выберите действие:',
                    [
                        {text: 'Отмена', style: 'cancel'},
                        {
                            text: 'Выделить',
                            onPress: () => enterSelectionMode(Number(item.id))
                        },
                        {
                            text: 'Удалить из переписки',
                            style: 'destructive',
                            onPress: () => deleteMessage(Number(item.id), 'for_me')
                        }
                    ],
                    {cancelable: true}
                );
            }
        };

        // Простой жест свайпа без анимации (для избежания хук-ошибок)
        const swipeGesture = Gesture.Pan()
            .activeOffsetX([-10, 10])
            .onEnd((event) => {
                const threshold = 60; // Порог для активации реплая
                const shouldReply = isMyMessage
                    ? event.translationX < -threshold
                    : event.translationX > threshold;

                if (shouldReply && !isSelectionMode) {
                    // Активируем реплай
                    runOnJS(setReply)(item);
                }
            });

        return (
            <View style={styles.messageWithReplyIndicator}>
                {/* Индикатор возможности реплая */}
                <View style={[
                    styles.replyIndicator,
                    isMyMessage ? styles.replyIndicatorRight : styles.replyIndicatorLeft
                ]}>
                    <MaterialIcons
                        name="reply"
                        size={16}
                        color={theme.textSecondary}
                        style={styles.replyIndicatorIcon}
                    />
                </View>

                <GestureDetector gesture={swipeGesture}>
                    <TouchableOpacity
                        onPress={handlePress}
                        onLongPress={handleLongPress}
                        delayLongPress={500}
                        activeOpacity={0.7}
                    >
                        <AnimatedView
                            style={[
                                styles.messageContainer,
                                isMyMessage ? styles.myMessage : styles.otherMessage,
                                item.mediaType ? styles.mediaMessage : null,
                                backgroundStyle,
                                isSelected ? styles.selectedMessage : null,
                                item.isDeleting ? styles.deletingMessage : null,
                                item.isDeletedByOther ? styles.deletedByOtherMessage : null
                            ]}
                        >
                            {/* Индикатор удаления */}
                            {item.isDeleting && (
                                <View style={styles.deletingIndicator}>
                                    <ActivityIndicator size="small" color={theme.error || '#ff4444'}/>
                                    <Text style={[styles.deletingText, {color: theme.error || '#ff4444'}]}>
                                        Удаление...
                                    </Text>
                                </View>
                            )}

                            {/* Индикатор выделения */}
                            {isSelectionMode && (
                                <View style={styles.selectionIndicator}>
                                    <MaterialIcons
                                        name={isSelected ? "check-circle" : "radio-button-unchecked"}
                                        size={20}
                                        color={isSelected ? theme.primary : theme.placeholder}
                                    />
                                </View>
                            )}

                            {!isMyMessage && (
                                <Text
                                    style={[styles.senderName, {color: theme.textSecondary}]}>{item.sender__username}</Text>
                            )}

                            {/* Отображение реплая */}
                            {item.reply_to_message_id && (
                                <TouchableOpacity
                                    style={[styles.replyContainer, {borderLeftColor: theme.primary}]}
                                    onPress={() => {
                                        console.log('💬 [REPLY-TAP] User tapped on reply, scrolling to:', item.reply_to_message_id);
                                        scrollToMessage(item.reply_to_message_id);
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.replyHeader}>
                                        <MaterialIcons name="reply" size={16} color={theme.primary}/>
                                        <Text style={[styles.replySender, {color: theme.primary}]}>
                                            {item.reply_to_sender || 'Пользователь'}
                                        </Text>
                                    </View>
                                    <Text
                                        style={[styles.replyMessage, {color: theme.textSecondary}]}
                                        numberOfLines={2}
                                    >
                                        {/* ИСПРАВЛЕНИЕ: Проверяем медиа тип, но игнорируем "text" */}
                                        {item.reply_to_media_type && item.reply_to_media_type !== 'text' ? (
                                            `${item.reply_to_media_type === 'image' ? '📷 Изображение' :
                                                item.reply_to_media_type === 'video' ? '🎥 Видео' :
                                                    item.reply_to_media_type === 'audio' ? '🎤 Аудио' :
                                                        item.reply_to_media_type === 'file' ? '📄 Файл' :
                                                            `📎 ${item.reply_to_media_type}`}`
                                        ) : (
                                            item.reply_to_message || 'Сообщение'
                                        )}
                                    </Text>
                                </TouchableOpacity>
                            )}

                            {/* Медиа контент - БЕЗ overlay для сохранения взаимодействия */}
                            <View style={item.mediaType ? styles.mediaContentWrapper : null}>
                                {renderMediaContent()}
                            </View>

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

                            {/* Показываем пометку об удалении для собеседника */}
                            {item.isDeletedByOther && !isMyMessage && (
                                <View style={styles.deletionNotice}>
                                    <MaterialIcons name="visibility-off" size={14} color={theme.textSecondary}/>
                                    <Text style={[styles.deletionNoticeText, {color: theme.textSecondary}]}>
                                        {item.deletedByUsername || 'Собеседник'} удалил это сообщение из своей переписки
                                    </Text>
                                </View>
                            )}

                            <View style={styles.messageFooter}>
                                <Text style={[
                                    styles.timestamp,
                                    isMyMessage ? styles.myTimestamp : styles.otherTimestamp
                                ]}>
                                    {formatTimestamp(item.timestamp)}
                                </Text>
                                {isMyMessage && !item.isDeletedByOther && (
                                    <View style={styles.readStatusContainer}>
                                        <MaterialIcons
                                            name={item.read ? "done-all" : "done"}
                                            size={16}
                                            color={item.read ? theme.success || '#4CAF50' : 'rgba(255, 255, 255, 0.6)'}
                                            style={styles.readStatusIcon}
                                        />
                                    </View>
                                )}
                            </View>
                            </AnimatedView>
                    </TouchableOpacity>

            </GestureDetector>
          </View>
        );
    };

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary}/>
                <Text style={[styles.loadingText, {color: theme.textSecondary}]}>Загрузка чата...</Text>
            </View>
        );
    }

    return (
        <GestureHandlerRootView style={styles.container}>
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
                            <MaterialIcons name="arrow-back" size={24} color={theme.primary}/>
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
                        onScrollToIndexFailed={(info) => {
                            console.log('📜 [SCROLL-FAILED] Scroll to index failed:', info);
                            // Пробуем прокрутить к ближайшему доступному индексу
                            const offset = info.averageItemLength * info.index;
                            flatListRef.current?.scrollToOffset({
                                offset,
                                animated: true,
                            });
                            // Затем пробуем снова прокрутить к целевому индексу
                            setTimeout(() => {
                                flatListRef.current?.scrollToIndex({
                                    index: info.index,
                                    animated: true,
                                    viewPosition: 0.5,
                                });
                            }, 100);
                        }}
                        ListFooterComponent={
                            isLoadingMore ? (
                                <View style={styles.loadingMoreContainer}>
                                    <ActivityIndicator size="small" color={theme.primary}/>
                                    <Text style={[styles.loadingMoreText, {color: theme.textSecondary}]}>
                                        Загрузка сообщений...
                                    </Text>
                                </View>
                            ) : null
                        }
                        ListEmptyComponent={
                            <View style={styles.emptyContainer}>
                                <Text style={[styles.emptyText, {color: theme.textSecondary}]}>Нет сообщений</Text>
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

                    {/* Индикатор загрузки сообщения для реплая */}
                    {isLoadingReplyMessage && (
                        <View style={[styles.loadingReplyContainer, {backgroundColor: theme.surface, borderTopColor: theme.border}]}>
                            <ActivityIndicator size="small" color={theme.primary} />
                            <Text style={[styles.loadingReplyText, {color: theme.textSecondary}]}>
                                Загрузка сообщения...
                            </Text>
                        </View>
                    )}

                    {/* Панель реплая */}
                    {replyToMessage && (
                        <View
                            style={[styles.replyPanel, {backgroundColor: theme.surface, borderTopColor: theme.border}]}>
                            <View style={styles.replyPanelContent}>
                                <MaterialIcons name="reply" size={18} color={theme.primary}/>
                                <View style={styles.replyInfo}>
                                    <Text style={[styles.replyToSender, {color: theme.primary}]}>
                                        Ответ для {replyToMessage.sender__username}
                                    </Text>
                                    <Text
                                        style={[styles.replyToMessage, {color: theme.textSecondary}]}
                                        numberOfLines={1}
                                    >
                                        {replyToMessage.mediaType && replyToMessage.mediaType !== 'text' ?
                                            `${replyToMessage.mediaType === 'image' ? '📷 Изображение' :
                                                replyToMessage.mediaType === 'video' ? '🎥 Видео' :
                                                    replyToMessage.mediaType === 'audio' ? '🎤 Аудио' :
                                                        replyToMessage.mediaType === 'file' ? '📄 Файл' :
                                                            '📎 Медиа'}`
                                            : replyToMessage.message || 'Сообщение'}
                                    </Text>
                                </View>
                                <TouchableOpacity
                                    onPress={cancelReply}
                                    style={styles.cancelReplyButton}
                                >
                                    <MaterialIcons name="close" size={18} color={theme.textSecondary}/>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    <View style={styles.inputContainer}>
                        {isRecordingAudio ? (
                            /* Панель записи аудио */
                            <View style={styles.recordingContainer}>
                                <TouchableOpacity
                                    style={[styles.cancelRecordButton, {backgroundColor: theme.error || '#ff4444'}]}
                                    onPress={cancelAudioRecording}
                                >
                                    <MaterialIcons name="close" size={24} color="white"/>
                                </TouchableOpacity>

                                <View style={styles.recordingIndicator}>
                                    <View style={styles.recordingDot}/>
                                    <Text style={[styles.recordingText, {color: theme.text}]}>
                                        {Math.floor(recordingDuration / 60)}:{String(recordingDuration % 60).padStart(2, '0')}
                                    </Text>
                                </View>

                                <TouchableOpacity
                                    style={[styles.sendRecordButton, {backgroundColor: theme.primary}]}
                                    onPress={stopAndSendAudio}
                                >
                                    <MaterialIcons name="send" size={24} color="white"/>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            /* Обычная панель ввода */
                            <>
                                <View style={styles.mediaButtonsContainer}>
                                    <TouchableOpacity
                                        style={[styles.mediaButton, {backgroundColor: theme.surface}]}
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
                                        style={[styles.mediaButton, {backgroundColor: theme.surface}]}
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
                                        style={[styles.mediaButton, {backgroundColor: theme.surface}]}
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
                                            style={[styles.mediaButton, {backgroundColor: '#ff9800'}]}
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
                                    style={[styles.input, {backgroundColor: theme.surface, color: theme.text}]}
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
                                    <MaterialIcons name="close" size={32} color="white"/>
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
                                        <MaterialIcons name="ios-share" size={32} color="white"/>
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

                            // ИСПРАВЛЕНИЕ: Сбрасываем состояние видео при закрытии модального окна
                            const activeVideoId = Object.keys(inlineVideoStates).find(id =>
                                inlineVideoStates[id]?.isFullscreen
                            );
                            if (activeVideoId) {
                                setInlineVideoStates(prev => ({
                                    ...prev,
                                    [activeVideoId]: {
                                        ...prev[activeVideoId],
                                        isFullscreen: false,
                                        isExpanded: false,
                                        isPlaying: false
                                    }
                                }));
                            }
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

                                    // ИСПРАВЛЕНИЕ: Сбрасываем состояние видео при закрытии
                                    const activeVideoId = Object.keys(inlineVideoStates).find(id =>
                                        inlineVideoStates[id]?.isFullscreen
                                    );
                                    if (activeVideoId) {
                                        setInlineVideoStates(prev => ({
                                            ...prev,
                                            [activeVideoId]: {
                                                ...prev[activeVideoId],
                                                isFullscreen: false,
                                                isExpanded: false,
                                                isPlaying: false
                                            }
                                        }));
                                    }
                                }}
                            >
                                <MaterialIcons name="close" size={32} color="white"/>
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
                                        <MaterialIcons name="ios-share" size={32} color="white"/>
                                    </TouchableOpacity>


                                </>
                            )}

                            {fullscreenModalVideoUri && (
                                <Video
                                    source={{uri: fullscreenModalVideoUri}}
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
                                <MaterialIcons name="ios-share" size={32} color="white"/>
                            </TouchableOpacity>


                            {/* Отображение ошибки */}
                            {videoError && (
                                <View style={styles.videoErrorContainer}>
                                    <MaterialIcons name="error" size={48} color="red"/>
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
                                            style={[styles.retryButton, {backgroundColor: 'rgba(0, 123, 255, 0.3)'}]}
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
        </GestureHandlerRootView>
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
            statusRow: {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
            },
            uploadIndicator: {
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: `${theme.primary}15`,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 10,
                marginLeft: 8,
            },
            uploadIndicatorText: {
                fontSize: 10,
                fontWeight: '600',
                marginLeft: 4,
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
                borderRadius: 0,
                overflow: 'hidden',
            },
            messageImage: {
                width: 200,
                minHeight: 150,
                maxHeight: 300,

            },
            messageVideo: {
                width: 200,
                height: 150,

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
                shadowOffset: {width: 0, height: 2},
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
                shadowOffset: {width: 0, height: 2},
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
                shadowOffset: {width: 0, height: 2},
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
                shadowOffset: {width: 0, height: 2},
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
            videoErrorContainer: {
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: [{translateX: -100}, {translateY: -100}],
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
                top: 50,
                left: 200,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                padding: 10,
                borderRadius: 25,
                zIndex: 1000,
                elevation: 10,
                shadowColor: '#000',
                shadowOffset: {width: 0, height: 2},
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
                backgroundColor: 'rgba(0, 0, 0, 0)',
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

            // Стили для превью видео (ленивая загрузка)
            videoPreviewContainer: {
                marginBottom: 8,
                borderRadius: 12,
                backgroundColor: theme.surface,
                borderWidth: 0.3,           // почти незаметная граница
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
                width: 240, // Соответствует ширине инлайн видео
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
            // Стили для выделения сообщений
            selectionHeader: {
                flexDirection: 'row',
                alignItems: 'center',
                flex: 1,
                justifyContent: 'space-between',
            },
            selectionBackButton: {
                padding: 8,
            },
            selectionInfo: {
                flex: 1,
                marginLeft: 8,
            },
            selectionCount: {
                fontSize: 16,
                fontWeight: 'bold',
            },
            selectionActions: {
                flexDirection: 'row',
                alignItems: 'center',
            },
            selectionActionButton: {
                padding: 8,
                marginLeft: 4,
            },
            selectedMessage: {
                backgroundColor: theme.primary ? `${theme.primary}20` : 'rgba(0, 123, 255, 0.1)',
                borderColor: theme.primary,
                borderWidth: 2,
                transform: [{scale: 0.98}],
            },
            selectionIndicator: {
                position: 'absolute',
                top: 4,
                left: 4,
                zIndex: 10,
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                borderRadius: 12,
                padding: 2,
            },
            mediaContentWrapper: {
                position: 'relative',
                // Медиа контент остается интерактивным
            },
            // Стили для пометки об удалении
            deletionNotice: {
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 4,
                paddingTop: 4,
                borderTopWidth: 1,
                borderTopColor: 'rgba(128, 128, 128, 0.2)',
            },
            deletionNoticeText: {
                fontSize: 11,
                fontStyle: 'italic',
                marginLeft: 4,
                opacity: 0.7,
            },
            // Стили для процесса удаления
            deletingMessage: {
                opacity: 0.6,
                backgroundColor: 'rgba(255, 68, 68, 0.1)',
                borderColor: '#ff4444',
                borderWidth: 1,
            },
            deletingIndicator: {
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 4,
                paddingHorizontal: 8,
                paddingVertical: 4,
                backgroundColor: 'rgba(255, 68, 68, 0.1)',
                borderRadius: 12,
            },
            deletingText: {
                fontSize: 12,
                fontStyle: 'italic',
                marginLeft: 4,
            },
            // Стили для сообщений удаленных собеседником
            deletedByOtherMessage: {
                opacity: 0.7,
                borderColor: 'rgba(255, 152, 0, 0.5)',
                borderWidth: 1,
                borderStyle: 'dashed',
                backgroundColor: 'rgba(255, 152, 0, 0.1)',
            },
            // Стили для статуса прочтения
            messageFooter: {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-end',
                marginTop: 2,
            },
            readStatusContainer: {
                marginLeft: 4,
            },
            readStatusIcon: {
                opacity: 0.8,
            },
            unreadMessageBorder: {
                borderLeftWidth: 3,
                borderLeftColor: theme.primary,
                paddingLeft: 8,
            },
            // Стили для реплаев
            replyContainer: {
                marginBottom: 6,
                padding: 8,
                backgroundColor: 'rgba(128, 128, 128, 0.1)',
                borderLeftWidth: 3,
                borderRadius: 6,
                marginHorizontal: 4,
                // Добавляем визуальную подсказку что это кликабельно
                shadowColor: theme.primary,
                shadowOffset: {width: 0, height: 1},
                shadowOpacity: 0.1,
                shadowRadius: 2,
                elevation: 1,
            },
            replyHeader: {
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 2,
            },
            replySender: {
                fontSize: 12,
                fontWeight: 'bold',
                marginLeft: 4,
            },
            replyMessage: {
                fontSize: 13,
                fontStyle: 'italic',
                lineHeight: 16,
            },
            replyPanel: {
                borderTopWidth: 1,
                paddingHorizontal: 16,
                paddingVertical: 8,
            },
            replyPanelContent: {
                flexDirection: 'row',
                alignItems: 'center',
            },
            replyInfo: {
                flex: 1,
                marginLeft: 8,
            },
            replyToSender: {
                fontSize: 12,
                fontWeight: 'bold',
            },
            replyToMessage: {
                fontSize: 13,
                marginTop: 1,
            },
            cancelReplyButton: {
                padding: 4,
            },
            // Стили для индикатора реплая
            messageWithReplyIndicator: {
                position: 'relative',
            },
            replyIndicator: {
                position: 'absolute',
                top: '50%',
                zIndex: 1,
                opacity: 0.3,
                backgroundColor: 'rgba(128, 128, 128, 0.1)',
                borderRadius: 12,
                padding: 4,
                transform: [{translateY: -12}],
            },
            replyIndicatorLeft: {
                left: -30,
            },
            replyIndicatorRight: {
                right: -30,
            },
            replyIndicatorIcon: {
                opacity: 0.6,
            },
            // Стили для индикатора загрузки сообщения реплая
            loadingReplyContainer: {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderTopWidth: 1,
            },
            loadingReplyText: {
                fontSize: 14,
                marginLeft: 8,
            },
        });
    };