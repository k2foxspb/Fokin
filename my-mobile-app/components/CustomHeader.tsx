import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CustomHeaderProps {
  title: string;
  onBack?: () => void;
  rightButton?: {
    icon: string;
    onPress: () => void;
  };
  subtitle?: string;
}

export default function CustomHeader({
  title,
  onBack,
  rightButton,
  subtitle
}: CustomHeaderProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const styles = createStyles(theme);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar
        barStyle={theme.background === '#000000' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBackground}
      />

      <View style={styles.header}>
        {/* Левая кнопка (назад) */}
        <View style={styles.leftContainer}>
          {onBack && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={onBack}
              activeOpacity={0.7}
            >
              <Ionicons
                name="arrow-back-outline"
                size={24}
                color={theme.headerText}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Центральная часть */}
        <View style={styles.centerContainer}>
          <Text style={[styles.title, { color: theme.headerText }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle && (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>

        {/* Правая кнопка */}
        <View style={styles.rightContainer}>
          {rightButton && (
            <TouchableOpacity
              style={styles.rightButton}
              onPress={rightButton.onPress}
              activeOpacity={0.7}
            >
              <Ionicons
                name={rightButton.icon as any}
                size={24}
                color={theme.headerText}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: {
    backgroundColor: theme.headerBackground,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.headerBorder,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: 16,
  },
  leftContainer: {
    width: 40,
    alignItems: 'flex-start',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  rightContainer: {
    width: 40,
    alignItems: 'flex-end',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.primary + '15',
  },
  rightButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.primary + '15',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
    marginTop: 2,
  },
});