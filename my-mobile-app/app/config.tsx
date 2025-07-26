
const DEV = process.env.NODE_ENV === 'development';

export const API_CONFIG = {
  // Базовый URL для HTTP запросов
  BASE_URL: DEV ? 'http://localhost:8000' : 'http://localhost:8000',

  // Базовый URL для WebSocket соединений
  WS_URL: DEV ? 'ws://127.0.0.1:8000' : 'ws://127.0.0.1:8000',
};