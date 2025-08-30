import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import ImageCache from '../utils/imageCache';
import { Ionicons } from '@expo/vector-icons';

interface CacheStats {
  count: number;
  size: number;
}

export const CacheManager: React.FC = () => {
  const { theme } = useTheme();
  const [stats, setStats] = useState<CacheStats>({ count: 0, size: 0 });
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const loadStats = async () => {
    try {
      setLoading(true);
      const cacheStats = await ImageCache.getCacheStats();
      setStats(cacheStats);
    } catch (error) {
      // Ошибка загрузки статистики
    } finally {
      setLoading(false);
    }
  };

  const clearCache = async () => {
    Alert.alert(
      'Очистить кэш',
      'Вы уверены, что хотите очистить кэш изображений? Это освободит место, но изображения будут загружаться заново.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Очистить',
          style: 'destructive',
          onPress: async () => {
            try {
              setClearing(true);
              await ImageCache.clearCache();
              await loadStats();
              Alert.alert('Успех', 'Кэш изображений очищен');
            } catch (error) {
              Alert.alert('Ошибка', 'Не удалось очистить кэш');
            } finally {
              setClearing(false);
            }
          },
        },
      ]
    );
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Б';

    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  useEffect(() => {
    loadStats();
  }, []);

  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="image" size={24} color={theme.primary} />
        <Text style={styles.title}>Кэш изображений</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={theme.primary} />
        </View>
      ) : (
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Файлов в кэше:</Text>
            <Text style={styles.statValue}>{stats.count}</Text>
          </View>

          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Размер кэша:</Text>
            <Text style={styles.statValue}>{formatBytes(stats.size)}</Text>
          </View>

          <TouchableOpacity
            style={[styles.clearButton, clearing && styles.clearButtonDisabled]}
            onPress={clearCache}
            disabled={clearing || stats.count === 0}
          >
            {clearing ? (
              <ActivityIndicator size="small" color={theme.surface} />
            ) : (
              <>
                <Ionicons name="trash" size={20} color={theme.surface} />
                <Text style={styles.clearButtonText}>Очистить кэш</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.refreshButton} onPress={loadStats}>
            <Ionicons name="refresh" size={20} color={theme.primary} />
            <Text style={styles.refreshButtonText}>Обновить</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      padding: 16,
      marginVertical: 8,
      marginHorizontal: 16,
      borderWidth: 1,
      borderColor: theme.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    title: {
      fontSize: 18,
      fontWeight: 'bold',
      color: theme.text,
      marginLeft: 12,
    },
    loadingContainer: {
      alignItems: 'center',
      padding: 20,
    },
    statsContainer: {
      gap: 12,
    },
    statItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    statLabel: {
      fontSize: 16,
      color: theme.textSecondary,
    },
    statValue: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.text,
    },
    clearButton: {
      backgroundColor: theme.error,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 12,
      borderRadius: 8,
      marginTop: 8,
      gap: 8,
    },
    clearButtonDisabled: {
      backgroundColor: theme.textSecondary,
    },
    clearButtonText: {
      color: theme.surface,
      fontWeight: '600',
      fontSize: 16,
    },
    refreshButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.primary,
      gap: 8,
    },
    refreshButtonText: {
      color: theme.primary,
      fontWeight: '600',
      fontSize: 16,
    },
  });

export default CacheManager;
