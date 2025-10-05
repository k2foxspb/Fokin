import React, { useState } from 'react';
import { Image, ImageProps, ActivityIndicator, View, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface DirectImageProps extends Omit<ImageProps, 'source'> {
  uri: string;
  showLoader?: boolean;
  fallbackSource?: ImageProps['source'];
}

const DirectImage: React.FC<DirectImageProps> = ({
  uri,
  style,
  showLoader = true,
  fallbackSource,
  ...props
}) => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const hasBorderRadius = Array.isArray(style) 
    ? style.some(s => s && typeof s === 'object' && 'borderRadius' in s)
    : style && typeof style === 'object' && 'borderRadius' in style;

  const handleLoadStart = () => {
    setLoading(true);
    setError(false);
  };

  const handleLoadEnd = () => {
    setLoading(false);
  };

  const handleError = () => {
    setError(true);
    setLoading(false);
  };

  if (!uri || uri.trim() === '') {
    if (fallbackSource) {
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
    return (
      <View style={[
        style, 
        styles.placeholderContainer,
        hasBorderRadius ? { borderRadius: 9999 } : undefined
      ]}>
        {showLoader && (
          <ActivityIndicator size="small" color={theme.primary} />
        )}
      </View>
    );
  }

  return (
    <View style={style}>
      <Image
        source={{ uri }}
        style={[
          StyleSheet.absoluteFill,
          hasBorderRadius ? { borderRadius: 9999 } : undefined
        ]}
        onLoadStart={handleLoadStart}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        {...props}
      />

      {loading && showLoader && (
        <View style={[
          styles.loaderContainer,
          hasBorderRadius ? { borderRadius: 9999 } : undefined
        ]}>
          <ActivityIndicator size="small" color={theme.primary} />
        </View>
      )}

      {error && fallbackSource && (
        <Image
          source={fallbackSource}
          style={[
            StyleSheet.absoluteFill,
            hasBorderRadius ? { borderRadius: 9999 } : undefined
          ]}
        />
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

export default DirectImage;
