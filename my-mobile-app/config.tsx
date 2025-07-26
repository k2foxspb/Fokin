
const DEV = process.env.NODE_ENV === 'development';

export const API_CONFIG = {
  // Базовый URL для HTTP запросов
  BASE_URL: DEV ? 'https://fokin.fun' : 'https://fokin.fun',

  // Базовый URL для WebSocket соединений
  WS_URL: DEV ? 'wss://fokin.fun' : 'wss://fokin.fun',
};