import { useState, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_CONFIG } from '../app/config';


export const useWebSocket = (url: string | string[], options = {}) => {
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);

    const connect = async () => {
        try {
            // Если уже подключен, закрываем предыдущее соединение
            if (wsRef.current) {
                wsRef.current.close();
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
                console.log('WebSocket connected');
                setIsConnected(true);

                // Очищаем таймаут переподключения
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = null;
                }

                if (options.onOpen) options.onOpen(event);
            };

            ws.onmessage = (event) => {
                if (options.onMessage) options.onMessage(event);
            };

            ws.onclose = (event) => {
                console.log('WebSocket disconnected, code:', event.code, 'reason:', event.reason);
                setIsConnected(false);
                wsRef.current = null;

                // Автоматическое переподключение, если не было намеренного закрытия
                if (event.code !== 1000 && event.code !== 1001) {
                    console.log('Scheduling reconnect...');
                    reconnectTimeoutRef.current = setTimeout(() => {
                        console.log('Attempting to reconnect...');
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
            if (options.onError) options.onError(error);
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

    const sendMessage = (message) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(message));
        } else {
            console.warn('WebSocket is not connected');
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
} ;