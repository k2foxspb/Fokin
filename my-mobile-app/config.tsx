const DEV = process.env.NODE_ENV === 'development';

export const API_CONFIG = {
  // Базовый URL для HTTP запросов
  BASE_URL: DEV ? 'http://localhost:8000' : 'https://fokin.fun',

  // Базовый URL для WebSocket соединений
  WS_URL: DEV ? 'ws://127.0.0.1:8000' : 'wss://fokin.fun',
  WS_PROTOCOL: DEV ? 'ws' : 'wss',
};

// Добавьте отладку для продакшена
console.log('Environment:', process.env.NODE_ENV);
console.log('API Config:', API_CONFIG);
