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
    const connectionAttempts = useRef<number>(0);

    const connect = async () => {
        try {
            // Предотвращаем множественные одновременные попытки подключения
            if (isConnectingRef.current) {
                console.log('🔌 [WS] ⚠️ Connection already in progress, skipping...');
                return;
            }

            connectionAttempts.current += 1;
            isConnectingRef.current = true;

            console.log('🔌 [WS] 🚀 Starting connection attempt #' + connectionAttempts.current);
            console.log('🔌 [WS] 📊 Current state:', {
                isConnected: isConnected,
                existingConnection: !!wsRef.current,
                connectionState: wsRef.current?.readyState,
                url: url
            });

            // Если уже подключен, закрываем предыдущее соединение
            if (wsRef.current) {
                console.log('🔌 [WS] 🔄 Closing existing connection state:', wsRef.current.readyState);
                wsRef.current.close();
                wsRef.current = null;
            }

            // Получаем токен
            console.log('🔌 [WS] 🔑 Getting user token...');
            const token = await AsyncStorage.getItem('userToken');
            console.log('🔌 [WS] 🔑 Token status:', token ? 'Present (length: ' + token.length + ')' : 'Missing');

            // Формируем WebSocket URL
            let wsUrl;
            if (token) {
                // Добавляем токен в query string
                const separator = url.includes('?') ? '&' : '?';
                wsUrl = `${API_CONFIG.WS_URL}${url}${separator}token=${token}`;
                console.log('🔌 [WS] 🌐 Connecting with auth to:', wsUrl.replace(token, '***TOKEN***'));
            } else {
                // Подключаемся без токена (для веб-приложения)
                wsUrl = `${API_CONFIG.WS_URL}${url}`;
                console.log('🔌 [WS] 🌐 Connecting without token to:', wsUrl);
            }

            console.log('🔌 [WS] 🔗 Creating WebSocket connection...');
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            console.log('🔌 [WS] 📝 WebSocket created, initial state:', ws.readyState);
            console.log('🔌 [WS] 🔍 Reference integrity check:', {
                wsExists: !!ws,
                wsRefExists: !!wsRef.current,
                sameObject: wsRef.current === ws,
                wsType: typeof ws,
                wsConstructor: ws.constructor.name
            });

            // Дополнительная проверка через небольшую задержку
            setTimeout(() => {
                console.log('🔌 [WS] 🔍 Delayed integrity check:', {
                    wsRefExists: !!wsRef.current,
                    wsRefReadyState: wsRef.current?.readyState,
                    originalWsReadyState: ws.readyState,
                    stillSameObject: wsRef.current === ws
                });

                if (!wsRef.current && ws.readyState !== WebSocket.CLOSED) {
                    console.error('🔌 [WS] ❌ CRITICAL: wsRef lost during setup!');
                    wsRef.current = ws; // Восстанавливаем
                }
            }, 50);

            ws.onopen = (event) => {
                console.log('🔌 [WS] ✅ WebSocket connected successfully!');
                console.log('🔌 [WS] 📊 Connection details:', {
                    attempt: connectionAttempts.current,
                    readyState: ws.readyState,
                    protocol: ws.protocol,
                    extensions: ws.extensions,
                    wsRefExists: !!wsRef.current,
                    wsRefSameObject: wsRef.current === ws
                });

                // КРИТИЧЕСКАЯ ПРОВЕРКА: убеждаемся что ссылка не потеряна
                if (!wsRef.current) {
                    console.error('🔌 [WS] ❌ CRITICAL: wsRef.current is null on open!');
                    wsRef.current = ws; // Восстанавливаем ссылку
                }

                if (wsRef.current !== ws) {
                    console.error('🔌 [WS] ❌ CRITICAL: wsRef.current points to different object!');
                    wsRef.current = ws; // Исправляем ссылку
                }

                setIsConnected(true);
                isConnectingRef.current = false;
                connectionAttempts.current = 0; // Reset counter on success

                // Очищаем таймаут переподключения
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = null;
                    console.log('🔌 [WS] 🧹 Cleared reconnect timeout');
                }

                console.log('🔌 [WS] 🎉 Calling onOpen callback...');
                console.log('🔌 [WS] 🔍 Pre-callback state check:', {
                    wsRefExists: !!wsRef.current,
                    wsRefReadyState: wsRef.current?.readyState,
                    isConnectedFlag: isConnected
                });

                if (options.onOpen) options.onOpen(event);

                // Проверка состояния после callback
                setTimeout(() => {
                    console.log('🔌 [WS] 🔍 Post-callback state check:', {
                        wsRefExists: !!wsRef.current,
                        wsRefReadyState: wsRef.current?.readyState,
                        isConnectedFlag: isConnected
                    });

                    if (!wsRef.current) {
                        console.error('🔌 [WS] ❌ CRITICAL: wsRef.current was cleared during onOpen callback!');
                        // Пытаемся восстановить
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            console.log('🔌 [WS] 🔧 Attempting to restore wsRef...');
                            wsRef.current = ws;
                        }
                    }
                }, 100);
            };

            ws.onmessage = (event) => {
                try {
                    console.log('🔌 [WS] 📨 Raw message received:', event.data);

                    // Парсим сообщение из event.data
                    const message = JSON.parse(event.data);
                    const messageType = message.type;

                    console.log('🔌 [WS] 📨 Parsed message:', {
                        type: messageType,
                        dataSize: JSON.stringify(message).length,
                        timestamp: new Date().toISOString()
                    });

                    // Обрабатываем сообщение через дедупликатор
                    const processed = processWebSocketMessage(messageType, message);
                    console.log('🔌 [WS] 🔄 Message processing result:', processed);

                    // Вызываем оригинальный обработчик, если он есть
                    if (options.onMessage) {
                        console.log('🔌 [WS] 📤 Calling onMessage callback...');
                        options.onMessage(event);
                    }
                } catch (error) {
                    console.error('🔌 [WS] ❌ Error processing WebSocket message:', error);
                    console.error('🔌 [WS] ❌ Raw data that failed:', event.data);
                    // Вызываем оригинальный обработчик даже при ошибке
                    if (options.onMessage) options.onMessage(event);
                }
            };

            ws.onclose = (event) => {
                console.log('🔌 [WS] ❌ WebSocket disconnected');
                console.log('🔌 [WS] 📊 Disconnect details:', {
                    code: event.code,
                    reason: event.reason,
                    wasClean: event.wasClean,
                    attempt: connectionAttempts.current
                });

                setIsConnected(false);
                wsRef.current = null;
                isConnectingRef.current = false;

                // Автоматическое переподключение только для неожиданных отключений
                const shouldReconnect = event.code !== 1000 && event.code !== 1001 && !reconnectTimeoutRef.current;
                console.log('🔌 [WS] 🤔 Should reconnect?', shouldReconnect);

                if (shouldReconnect) {
                    const delay = Math.min(3000 * Math.pow(2, Math.min(connectionAttempts.current, 5)), 30000);
                    console.log('🔌 [WS] 🔄 Scheduling reconnect in', delay, 'ms...');

                    reconnectTimeoutRef.current = setTimeout(() => {
                        console.log('🔌 [WS] 🔄 Executing reconnect attempt...');
                        connect();
                    }, delay);
                }

                console.log('🔌 [WS] 📤 Calling onClose callback...');
                if (options.onClose) options.onClose(event);
            };

            ws.onerror = (error) => {
                console.error('🔌 [WS] 💥 WebSocket error occurred:', error);
                console.error('🔌 [WS] 📊 Error context:', {
                    readyState: ws?.readyState,
                    isConnecting: isConnectingRef.current,
                    attempt: connectionAttempts.current
                });

                setIsConnected(false);
                console.log('🔌 [WS] 📤 Calling onError callback...');
                if (options.onError) options.onError(error);
            };

        } catch (error) {
            console.error('Error connecting to WebSocket:', error);
            setIsConnected(false);
            if (options.onError) options.onError(error as Event);
        }
    };

    const disconnect = () => {
        console.log('🔌 [WS] 🔌 Disconnect requested');
        console.log('🔌 [WS] 📊 Pre-disconnect state:', {
            wsRefExists: !!wsRef.current,
            wsRefReadyState: wsRef.current?.readyState,
            isConnectedFlag: isConnected,
            hasReconnectTimeout: !!reconnectTimeoutRef.current
        });

        // Очищаем таймаут переподключения
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
            console.log('🔌 [WS] 🧹 Cleared reconnect timeout');
        }

        if (wsRef.current) {
            console.log('🔌 [WS] 🔌 Closing WebSocket connection...');
            try {
                wsRef.current.close(1000, 'User disconnected');
                console.log('🔌 [WS] ✅ WebSocket.close() called successfully');
            } catch (error) {
                console.error('🔌 [WS] ❌ Error calling WebSocket.close():', error);
            }

            // Небольшая задержка перед очисткой ссылки
            setTimeout(() => {
                wsRef.current = null;
                console.log('🔌 [WS] 🧹 wsRef cleared after close');
            }, 100);
        } else {
            console.log('🔌 [WS] 📝 No WebSocket to disconnect');
        }

        setIsConnected(false);
        isConnectingRef.current = false;
        console.log('🔌 [WS] ✅ Disconnect completed');
    };

    const sendMessage = (message: any) => {
        // Валидация сообщения
        if (!message || typeof message !== 'object') {
            console.error('🔌 [WS] ❌ Invalid message object:', message);
            return;
        }

        // Проверяем обязательное поле type
        if (!message.type) {
            console.error('🔌 [WS] ❌ Message missing required "type" field:', message);
            console.error('🔌 [WS] ❌ This message will likely be ignored by server');
            // НЕ возвращаем - отправляем все равно для отладки
        }

        console.log('🔌 [WS] 📤 Attempting to send message:', {
            messageObject: message,
            type: message.type,
            hasType: !!message.type,
            messageSize: JSON.stringify(message).length,
            wsState: wsRef.current?.readyState,
            isConnected: isConnected
        });

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            try {
                const messageStr = JSON.stringify(message);
                console.log('🔌 [WS] 📝 Serialized message:', messageStr);
                wsRef.current.send(messageStr);
                console.log('🔌 [WS] ✅ Message sent successfully. Type:', message.type);
            } catch (error) {
                console.error('🔌 [WS] ❌ Error sending message:', error);
                console.error('🔌 [WS] ❌ Message that failed:', message);
            }
        } else {
            console.warn('🔌 [WS] ⚠️ Cannot send message - WebSocket not connected');
            console.warn('🔌 [WS] ⚠️ Message that was not sent:', message);
            console.warn('🔌 [WS] 📊 Connection state:', {
                wsExists: !!wsRef.current,
                readyState: wsRef.current?.readyState ?? 'null',
                isConnectedFlag: isConnected,
                stateNames: {
                    0: 'CONNECTING',
                    1: 'OPEN', 
                    2: 'CLOSING',
                    3: 'CLOSED'
                }
            });
        }
    };

    const reconnect = () => {
        console.log('🔄 [WS] ========== RECONNECT INITIATED ==========');
        console.log('🔄 [WS] Current state before reconnect:', {
            isConnected: isConnected,
            wsExists: !!wsRef.current,
            wsReadyState: wsRef.current?.readyState,
            isConnecting: isConnectingRef.current,
            connectionAttempts: connectionAttempts.current
        });

        // Принудительная очистка состояния
        console.log('🔄 [WS] 🧹 Forcing state cleanup...');
        setIsConnected(false);
        isConnectingRef.current = false;

        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
            console.log('🔄 [WS] 🧹 Cleared reconnect timeout');
        }

        // Закрываем существующее соединение
        if (wsRef.current) {
            console.log('🔄 [WS] 🔌 Forcing WebSocket close...');
            try {
                wsRef.current.close();
            } catch (error) {
                console.log('🔄 [WS] Error closing WebSocket:', error);
            }
            wsRef.current = null;
        }

        console.log('🔄 [WS] ⏰ Scheduling reconnect in 1 second...');
        setTimeout(() => {
            console.log('🔄 [WS] 🚀 Executing delayed reconnect...');
            connect();
        }, 1000);
    };

    const isConnectedState = () => {
        const result = isConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN;

        // Подробная диагностика для отладки
        const diagnostics = {
            isConnectedFlag: isConnected,
            wsExists: !!wsRef.current,
            wsReadyState: wsRef.current?.readyState,
            wsReadyStateString: wsRef.current ? {
                0: 'CONNECTING',
                1: 'OPEN',
                2: 'CLOSING', 
                3: 'CLOSED'
            }[wsRef.current.readyState] : 'NO_WEBSOCKET',
            finalResult: result
        };

        if (!result) {
            console.log('🔌 [WS] ❌ Connection check failed:', diagnostics);
        }

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