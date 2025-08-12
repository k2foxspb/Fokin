import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';

export type ThemeType = 'light' | 'dark';

interface ThemeColors {
  // Основные цвета
    surfacePressed: any;
  primary: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  placeholder: string;

  // Статусы
  online: string;
  offline: string;
  success: string;
  error: string;
  warning: string;

  // UI элементы
  card: string;
  shadow: string;
  overlay: string;

  // TabBar специфичные цвета
  tabBarBackground: string;
  tabBarBorder: string;
  tabBarActive: string;
  tabBarInactive: string;
  tabBarBadge: string;

  // Header специфичные цвета
  headerBackground: string;
  headerText: string;
  headerBorder: string;
}

interface ThemeContextType {
  theme: ThemeColors;
  themeType: ThemeType;
  toggleTheme: () => void;
  setTheme: (theme: ThemeType) => void;
}

const lightTheme: {
    primary: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    placeholder: string;
    online: string;
    offline: string;
    success: string;
    error: string;
    warning: string;
    card: string;
    shadow: string;
    overlay: string;
    tabBarBackground: string;
    tabBarBorder: string;
    tabBarActive: string;
    tabBarInactive: string;
    tabBarBadge: string;
    headerBackground: string;
    headerText: string;
    headerBorder: string
} = {
  primary: '#007AFF',
  background: '#F2F2F7',
  surface: '#FFFFFF',
  text: '#000000',
  textSecondary: '#6D6D80',
  border: '#E5E5EA',
  placeholder: '#C7C7CC',

  online: '#34C759',
  offline: '#FF3B30',
  success: '#34C759',
  error: '#FF3B30',
  warning: '#FF9500',

  card: '#FFFFFF',
  shadow: '#000000',
  overlay: 'rgba(0, 0, 0, 0.5)',

  tabBarBackground: '#FFFFFF',
  tabBarBorder: '#E0E0E0',
  tabBarActive: '#007AFF',
  tabBarInactive: '#8E8E93',
  tabBarBadge: '#FF3B30',

  headerBackground: '#FFFFFF',
  headerText: '#000000',
  headerBorder: '#E0E0E0',
};

const darkTheme: {
    primary: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    placeholder: string;
    online: string;
    offline: string;
    success: string;
    error: string;
    warning: string;
    card: string;
    shadow: string;
    overlay: string;
    tabBarBackground: string;
    tabBarBorder: string;
    tabBarActive: string;
    tabBarInactive: string;
    tabBarBadge: string;
    headerBackground: string;
    headerText: string;
    headerBorder: string
} = {
  primary: '#0A84FF',
  background: '#000000',
  surface: '#1C1C1E',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  border: '#38383A',
  placeholder: '#48484A',

  online: '#30D158',
  offline: '#FF453A',
  success: '#30D158',
  error: '#FF453A',
  warning: '#FF9F0A',

  card: '#1C1C1E',
  shadow: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.7)',

  tabBarBackground: '#1C1C1E',
  tabBarBorder: '#38383A',
  tabBarActive: '#0A84FF',
  tabBarInactive: '#8E8E93',
  tabBarBadge: '#FF453A',

  headerBackground: '#1C1C1E',
  headerText: '#FFFFFF',
  headerBorder: '#38383A',
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeType, setThemeType] = useState<ThemeType>('light');

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem('userTheme');
      if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
        setThemeType(savedTheme);
      }
    } catch (error) {
      console.error('Error loading theme:', error);
    }
  };

  const saveTheme = async (theme: ThemeType) => {
    try {
      await AsyncStorage.setItem('userTheme', theme);
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  };

  const toggleTheme = () => {
    const newTheme = themeType === 'light' ? 'dark' : 'light';
    setThemeType(newTheme);
    saveTheme(newTheme);
  };

  const setTheme = (theme: ThemeType) => {
    setThemeType(theme);
    saveTheme(theme);
  };

  const theme = themeType === 'light' ? lightTheme : darkTheme;

  return (
    <ThemeContext.Provider value={{ theme, themeType, toggleTheme, setTheme }}>
      <StatusBar style={themeType === 'light' ? 'dark' : 'light'} />
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};