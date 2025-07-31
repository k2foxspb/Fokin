import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Theme {
  // Background colors
  background: string;
  surface: string;
  surfacePressed: string;

  // Text colors
  text: string;
  textSecondary: string;
  textError: string;

  // Border colors
  border: string;
  borderLight: string;

  // Accent colors
  primary: string;
  success: string;
  warning: string;
  error: string;

  // Status colors
  online: string;
  offline: string;

  // Placeholder colors
  placeholder: string;

  // Header colors
  headerBackground: string;
  headerText: string;
}

export const lightTheme: Theme = {
  // Background colors
  background: '#fff',
  surface: '#fff',
  surfacePressed: '#f5f5f5',

  // Text colors
  text: '#000',
  textSecondary: '#666',
  textError: '#ff3b30',

  // Border colors
  border: '#eee',
  borderLight: '#fff',

  // Accent colors
  primary: '#007AFF',
  success: '#4CAF50',
  warning: '#FF9500',
  error: '#ff3b30',

  // Status colors
  online: '#4CAF50',
  offline: '#9E9E9E',

  // Placeholder colors
  placeholder: '#e1e1e1',

  // Header colors
  headerBackground: '#fff',
  headerText: '#000',
};

export const darkTheme: Theme = {
  // Background colors
  background: '#000',
  surface: '#1c1c1e',
  surfacePressed: '#2c2c2e',

  // Text colors
  text: '#fff',
  textSecondary: '#8e8e93',
  textError: '#ff453a',

  // Border colors
  border: '#38383a',
  borderLight: '#1c1c1e',

  // Accent colors
  primary: '#0a84ff',
  success: '#30d158',
  warning: '#ff9f0a',
  error: '#ff453a',

  // Status colors
  online: '#30d158',
  offline: '#8e8e93',

  // Placeholder colors
  placeholder: '#48484a',

  // Header colors
  headerBackground: '#1c1c1e',
  headerText: '#fff',
};

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (isDark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: lightTheme,
  isDark: false,
  toggleTheme: () => {},
  setTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDark, setIsDark] = useState<boolean>(false);

  // Load theme preference from storage on app start
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem('theme');
        if (savedTheme !== null) {
          setIsDark(savedTheme === 'dark');
        }
      } catch (error) {
        console.error('Error loading theme preference:', error);
      }
    };
    loadTheme();
  }, []);

  // Save theme preference to storage when it changes
  const setTheme = async (dark: boolean) => {
    try {
      setIsDark(dark);
      await AsyncStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch (error) {
      console.error('Error saving theme preference:', error);
    }
  };

  const toggleTheme = () => {
    setTheme(!isDark);
  };

  const theme = isDark ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};