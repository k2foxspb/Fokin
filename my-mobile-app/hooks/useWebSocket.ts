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
    const isConnectedRef = useRef<boolean>(false);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isConnectingRef = useRef<boolean>(false);
    const connectionAttempts = useRef<number>(0);

    const connect = async () => {
        try {
            // Предотвращаем множественные одновременные попытки подключения
            if (isConnectingRef.current) {
                return;
            }

            connectionAttempts.current += 1;
            isConnectingRef.current = true;

            // Если уже подключен, закрываем предыдущее соединение
            if (wsRef.current) {
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
            } else {
                // Подключаемся без токена (для веб-приложения)
                wsUrl = `${API_CONFIG.WS_URL}${url}`;
            }

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            // Дополнительная проверка через небольшую задержку
            setTimeout(() => {
                if (!wsRef.current && ws.readyState !== WebSocket.CLOSED) {
                    wsRef.current = ws; // Восстанавливаем
                }
            }, 50);

            ws.onopen = (event) => {
                // КРИТИЧЕСКАЯ ПРОВЕРКА: убеждаемся что ссылка не потеряна
                if (!wsRef.current) {
                    wsRef.current = ws; // Восстанавливаем ссылку
                }

                if (wsRef.current !== ws) {
                    wsRef.current = ws; // Исправляем ссылку
                }

                isConnectedRef.current = true;
                isConnectingRef.current = false;
                connectionAttempts.current = 0; // Reset counter on success

                // Очищаем таймаут переподключения
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = null;
                }

                if (options.onOpen) options.onOpen(event);

                // Проверка состояния после callback
                setTimeout(() => {
                    if (!wsRef.current) {
                        // Пытаемся восстановить
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            wsRef.current = ws;
                        }
                    }
                }, 100);
            };

            ws.onmessage = (event) => {
                try {
                    // Парсим сообщение из event.data
                    const message = JSON.parse(event.data);
                    const messageType = message.type;

                    // Обрабатываем сообщение через дедупликатор
                    const processed = processWebSocketMessage(messageType, message);

                    // Вызываем оригинальный обработчик, если он есть
                    if (options.onMessage) {
                        options.onMessage(event);
                    }
                } catch (error) {
                    // Вызываем оригинальный обработчик даже при ошибке
                    if (options.onMessage) options.onMessage(event);
                }
            };

            ws.onclose = (event) => {
                isConnectedRef.current = false;
                wsRef.current = null;
                isConnectingRef.current = false;

                // Автоматическое переподключение только для неожиданных отключений
                const shouldReconnect = event.code !== 1000 && event.code !== 1001 && !reconnectTimeoutRef.current;

                if (shouldReconnect) {
                    const delay = Math.min(3000 * Math.pow(2, Math.min(connectionAttempts.current, 5)), 30000);

                    reconnectTimeoutRef.current = setTimeout(() => {
                        connect();
                    }, delay);
                }

                if (options.onClose) options.onClose(event);
            };

            ws.onerror = (error) => {
                isConnectedRef.current = false;
                if (options.onError) options.onError(error);
            };

        } catch (error) {
            isConnectedRef.current = false;
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
            try {
                wsRef.current.close(1000, 'User disconnected');
            } catch (error) {
            }

            // Небольшая задержка перед очисткой ссылки
            setTimeout(() => {
                wsRef.current = null;
            }, 100);
        }

        isConnectedRef.current = false;
        isConnectingRef.current = false;
    };

    const sendMessage = (message: any) => {
        // Валидация сообщения
        if (!message || typeof message !== 'object') {
            return;
        }

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            try {
                const messageStr = JSON.stringify(message);
                wsRef.current.send(messageStr);
            } catch (error) {
            }
        }
    };

    const reconnect = () => {
        // Принудительная очистка состояния
        isConnectedRef.current = false;
        isConnectingRef.current = false;

        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        // Закрываем существующее соединение
        if (wsRef.current) {
            try {
                wsRef.current.close();
            } catch (error) {
            }
            wsRef.current = null;
        }

        setTimeout(() => {
            connect();
        }, 1000);
    };

    const isConnectedState = () => {
        const result = isConnectedRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
        return result;
    };

    return {
        connect,
        disconnect,
        sendMessage,
        isConnected: isConnectedState,
        reconnect
    };
};