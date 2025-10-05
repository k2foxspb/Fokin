import React, { useState, useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface LazyMediaProps {
  children: React.ReactNode;
  onVisible?: () => void;
  style?: ViewStyle;
  threshold?: number;
  showLoader?: boolean;
}

const LazyMedia: React.FC<LazyMediaProps> = ({
  children,
  onVisible,
  style,
  threshold = 100,
  showLoader = true
}) => {
  const { theme } = useTheme();
  const [isVisible, setIsVisible] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const viewRef = useRef<View>(null);

  useEffect(() => {
    // Простая реализация видимости для React Native
    // В реальном приложении можно использовать более сложную логику
    const timer = setTimeout(() => {
      setIsVisible(true);
      setHasLoaded(true);
      if (onVisible) {
        onVisible();
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [onVisible]);

  if (!isVisible && !hasLoaded) {
    return (
      <View ref={viewRef} style={[styles.container, style]}>
        {showLoader && (
          <ActivityIndicator size="small" color={theme.primary} />
        )}
      </View>
    );
  }

  return (
    <View ref={viewRef} style={style}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 100,
  },
});

export default LazyMedia;
