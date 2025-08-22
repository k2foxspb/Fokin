import { useState, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_CONFIG } from '../config';
import { processWebSocketMessage } from '../services/notificationService';

interface WebSocketOptions {
    onOpen?: (event: Event) => void;
    onMessage?: (event: MessageEvent) => void;
    onClose?: (event: CloseEvent) => void;
    onError?: (error: Event) => void;
}

export const useWebSocket = (url: string | string[], options: WebSocketOptions = {}) => {
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isConnectingRef = useRef<boolean>(false);

    const connect = async () => {
        try {
            // Предотвращаем множественные одновременные попытки подключения
            if (isConnectingRef.current) {
                console.log('🔌 [WS] Connection already in progress, skipping...');
                return;
            }

            isConnectingRef.current = true;
            console.log('🔌 [WS] Starting connection...');

            // Если уже подключен, закрываем предыдущее соединение
            if (wsRef.current) {
                console.log('🔌 [WS] Closing existing connection...');
                wsRef.current.close();
                wsRef.current = null;
            }

            // Получаем токен
            const token = await AsyncStorage.getItem('userToken');

            // Формируем WebSocket URL
            let wsUrl;
            if (token) {
                // Добавляем токен в query string
                const separator = url.includes('?') ? '&' : '?';
                wsUrl = `${API_CONFIG.WS_URL}${url}${separator}token=${token}`;
                console.log('Connecting with token to:', wsUrl);
            } else {
                // Подключаемся без токена (для веб-приложения)
                wsUrl = `${API_CONFIG.WS_URL}${url}`;
                console.log('Connecting without token to:', wsUrl);
            }

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = (event) => {
                console.log('🔌 [WS] ✅ WebSocket connected successfully');
                setIsConnected(true);
                isConnectingRef.current = false;

                // Очищаем таймаут переподключения
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = null;
                }

                if (options.onOpen) options.onOpen(event);
            };

            ws.onmessage = (event) => {
                try {
                    // Парсим сообщение из event.data
                    const message = JSON.parse(event.data);
                    const messageType = message.type;

                    // Обрабатываем сообщение через дедупликатор
                    processWebSocketMessage(messageType, message);

                    // Вызываем оригинальный обработчик, если он есть
                    if (options.onMessage) options.onMessage(event);
                } catch (error) {
                    console.error('Error processing WebSocket message:', error);
                    // Вызываем оригинальный обработчик даже при ошибке
                    if (options.onMessage) options.onMessage(event);
                }
            };

            ws.onclose = (event) => {
                console.log('🔌 [WS] ❌ WebSocket disconnected, code:', event.code, 'reason:', event.reason);
                setIsConnected(false);
                wsRef.current = null;
                isConnectingRef.current = false;

                // Автоматическое переподключение только для неожиданных отключений
                if (event.code !== 1000 && event.code !== 1001 && !reconnectTimeoutRef.current) {
                    console.log('🔌 [WS] 🔄 Scheduling reconnect in 3 seconds...');
                    reconnectTimeoutRef.current = setTimeout(() => {
                        console.log('🔌 [WS] 🔄 Attempting to reconnect...');
                        connect();
                    }, 3000);
                }

                if (options.onClose) options.onClose(event);
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                setIsConnected(false);
                if (options.onError) options.onError(error);
            };

        } catch (error) {
            console.error('Error connecting to WebSocket:', error);
            setIsConnected(false);
            if (options.onError) options.onError(error as Event);
        }
    };

    const disconnect = () => {
        // Очищаем таймаут переподключения
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        if (wsRef.current) {
            wsRef.current.close(1000, 'User disconnected');
            wsRef.current = null;
        }
        setIsConnected(false);
    };

    const sendMessage = (message: any) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(message));
        } else {
            console.warn('🔌 [WS] ⚠️ Cannot send message - WebSocket not connected (state:', 
                wsRef.current?.readyState ?? 'null', ')');
        }
    };

    const reconnect = () => {
        disconnect();
        setTimeout(connect, 1000);
    };

    const isConnectedState = () => {
        return isConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
    };

    return {
        connect,
        disconnect,
        sendMessage,
        isConnected: isConnectedState,
        reconnect
    };
};