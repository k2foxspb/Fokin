import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const CACHE_DIR = FileSystem.cacheDirectory + 'images/';
const CACHE_METADATA_KEY = 'image_cache_metadata';
const CACHE_EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 часа
const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB

interface CacheMetadata {
  [key: string]: {
    localPath: string;
    timestamp: number;
    size: number;
    url: string;
  };
}

export class ImageCache {
  private static instance: ImageCache;
  private metadata: CacheMetadata = {};
  private isInitialized = false;

  static getInstance(): ImageCache {
    if (!ImageCache.instance) {
      ImageCache.instance = new ImageCache();
    }
    return ImageCache.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Создаем директорию для кэша если её нет
      const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
      }

      // Загружаем метаданные кэша
      const storedMetadata = await AsyncStorage.getItem(CACHE_METADATA_KEY);
      if (storedMetadata) {
        this.metadata = JSON.parse(storedMetadata);
      }

      // Очищаем устаревший кэш при инициализации
      await this.cleanExpiredCache();

      this.isInitialized = true;
    } catch (error) {
      // Ошибка инициализации кэша
    }
  }

  private generateCacheKey(url: string): string {
    // Создаем уникальный ключ на основе URL
    return url.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now().toString(36);
  }

  private async saveMetadata(): Promise<void> {
    try {
      await AsyncStorage.setItem(CACHE_METADATA_KEY, JSON.stringify(this.metadata));
    } catch (error) {
      // Ошибка сохранения метаданных
    }
  }

  private async cleanExpiredCache(): Promise<void> {
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (const [key, meta] of Object.entries(this.metadata)) {
      if (now - meta.timestamp > CACHE_EXPIRY_TIME) {
        keysToRemove.push(key);

        try {
          const fileInfo = await FileSystem.getInfoAsync(meta.localPath);
          if (fileInfo.exists) {
            await FileSystem.deleteAsync(meta.localPath);
          }
        } catch (error) {
          // Ошибка удаления файла
        }
      }
    }

    // Удаляем из метаданных
    keysToRemove.forEach(key => delete this.metadata[key]);

    if (keysToRemove.length > 0) {
      await this.saveMetadata();
    }
  }

  private async ensureCacheSize(): Promise<void> {
    const totalSize = Object.values(this.metadata).reduce((sum, meta) => sum + meta.size, 0);

    if (totalSize <= MAX_CACHE_SIZE) return;

    // Сортируем по времени (старые первыми)
    const sortedEntries = Object.entries(this.metadata)
      .sort(([, a], [, b]) => a.timestamp - b.timestamp);

    let currentSize = totalSize;

    for (const [key, meta] of sortedEntries) {
      if (currentSize <= MAX_CACHE_SIZE * 0.8) break; // Удаляем до 80% лимита

      try {
        const fileInfo = await FileSystem.getInfoAsync(meta.localPath);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(meta.localPath);
          currentSize -= meta.size;
        }
        delete this.metadata[key];
      } catch (error) {
        // Ошибка удаления файла
      }
    }

    await this.saveMetadata();
  }

  async getCachedImage(url: string): Promise<string | null> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Ищем в кэше по URL
    const cacheEntry = Object.values(this.metadata).find(meta => meta.url === url);

    if (cacheEntry) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(cacheEntry.localPath);
        if (fileInfo.exists) {
          // Проверяем не устарел ли файл
          if (Date.now() - cacheEntry.timestamp < CACHE_EXPIRY_TIME) {
            return cacheEntry.localPath;
          }
        }
      } catch (error) {
        // Ошибка проверки файла
      }
    }

    return null;
  }

  async cacheImage(url: string): Promise<string | null> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Проверяем, может уже есть в кэше
      const cached = await this.getCachedImage(url);
      if (cached) return cached;

      // Генерируем уникальное имя файла
      const cacheKey = this.generateCacheKey(url);
      const fileExtension = url.split('.').pop()?.split('?')[0] || 'jpg';
      const localPath = CACHE_DIR + cacheKey + '.' + fileExtension;

      // Скачиваем файл
      const downloadResult = await FileSystem.downloadAsync(url, localPath);

      if (downloadResult.status === 200) {
        // Получаем размер файла
        const fileInfo = await FileSystem.getInfoAsync(localPath);
        const fileSize = fileInfo.size || 0;

        // Сохраняем метаданные
        this.metadata[cacheKey] = {
          localPath,
          timestamp: Date.now(),
          size: fileSize,
          url
        };

        await this.saveMetadata();
        await this.ensureCacheSize();

        return localPath;
      }
    } catch (error) {
      // Ошибка кэширования изображения
    }

    return null;
  }

  async clearCache(): Promise<void> {
    try {
      // Удаляем все файлы
      for (const meta of Object.values(this.metadata)) {
        try {
          const fileInfo = await FileSystem.getInfoAsync(meta.localPath);
          if (fileInfo.exists) {
            await FileSystem.deleteAsync(meta.localPath);
          }
        } catch (error) {
          // Ошибка удаления файла
        }
      }

      // Очищаем метаданные
      this.metadata = {};
      await AsyncStorage.removeItem(CACHE_METADATA_KEY);
    } catch (error) {
      // Ошибка очистки кэша
    }
  }

  async getCacheStats(): Promise<{ count: number; size: number }> {
    const count = Object.keys(this.metadata).length;
    const size = Object.values(this.metadata).reduce((sum, meta) => sum + meta.size, 0);

    return { count, size };
  }
}

export default ImageCache.getInstance();
