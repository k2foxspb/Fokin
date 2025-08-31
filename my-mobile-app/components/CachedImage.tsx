import React, { useState, useEffect } from 'react';
import { Image, ImageProps, ActivityIndicator, View, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import ImageCache from '../utils/imageCache';

interface CachedImageProps extends Omit<ImageProps, 'source'> {
  uri: string;
  showLoader?: boolean;
  fallbackSource?: ImageProps['source'];
  cacheKey?: string;
}

const CachedImage: React.FC<CachedImageProps> = ({
  uri,
  style,
  showLoader = true,
  fallbackSource,
  cacheKey,
  ...props
}) => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [imageSource, setImageSource] = useState<ImageProps['source'] | null>(null);
  const [error, setError] = useState(false);

  // Проверяем, содержит ли стиль borderRadius
  const hasBorderRadius = Array.isArray(style) 
    ? style.some(s => s && typeof s === 'object' && 'borderRadius' in s)
    : style && typeof style === 'object' && 'borderRadius' in style;

  useEffect(() => {
    let mounted = true;

    const loadImage = async () => {
      // Если нет URI или URI пустой, используем fallback
      if (!uri || uri.trim() === '') {
        if (mounted) {
          setImageSource(fallbackSource || null);
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);
        setError(false);

        // Проверяем, что это валидный HTTP/HTTPS URL
        if (uri.startsWith('http://') || uri.startsWith('https://')) {
          // Сначала проверяем кэш
          const cached = await ImageCache.getCachedImage(uri);

          if (cached && mounted) {
            setImageSource({ uri: cached });
            setLoading(false);
            return;
          }

          // Если нет в кэше, кэшируем
          const newCached = await ImageCache.cacheImage(uri);

          if (newCached && mounted) {
            setImageSource({ uri: newCached });
          } else if (mounted) {
            // Если кэширование не удалось, используем оригинальный URL
            setImageSource({ uri: uri });
          }
        } else {
          // Если это не HTTP URL, используем как есть (может быть file:// или другой схема)
          if (mounted) {
            setImageSource({ uri: uri });
          }
        }
      } catch (err) {
        if (mounted) {
          setError(true);
          // В случае ошибки используем fallback или оригинальный URI
          setImageSource(fallbackSource || { uri: uri });
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      mounted = false;
    };
  }, [uri, fallbackSource]);

  const handleLoadEnd = () => {
    setLoading(false);
  };

  const handleError = () => {
    setError(true);
    setLoading(false);
    // При ошибке загрузки показываем fallback, если он есть
    if (fallbackSource) {
      setImageSource(fallbackSource);
    }
  };

  // Если есть fallback и нет основного источника
  if (!imageSource && fallbackSource) {
    return (
      <Image
        source={fallbackSource}
        style={style}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        {...props}
      />
    );
  }

  // Если нет источника изображения вообще
  if (!imageSource) {
    return (
      <View style={[
        style, 
        styles.placeholderContainer,
        hasBorderRadius ? { borderRadius: 9999 } : undefined
      ]}>
        {loading && showLoader && (
          <ActivityIndicator 
            size="small" 
            color={theme.primary} 
          />
        )}
      </View>
    );
  }

  return (
    <View style={style}>
      <Image
        source={imageSource}
        style={[
          StyleSheet.absoluteFill,
          hasBorderRadius ? { borderRadius: 9999 } : undefined
        ]}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        {...props}
      />

      {loading && showLoader && (
        <View style={[
          styles.loaderContainer,
          hasBorderRadius ? { borderRadius: 9999 } : undefined
        ]}>
          <ActivityIndicator 
            size="small" 
            color={theme.primary} 
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  loaderContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  placeholderContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
});

export default CachedImage;
