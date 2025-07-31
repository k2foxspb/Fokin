import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';
import { useNotifications } from '../contexts/NotificationContext';

export default function TabBar() {
  const pathname = usePathname();
  const { theme } = useTheme();
  const { unreadCount } = useNotifications();

  const tabs = [
    {
      name: 'feed',
      title: 'Лента',
      icon: 'home-outline' as const,
      activeIcon: 'home' as const,
      path: '/(main)/feed'
    },
    {
      name: 'messages',
      title: 'Сообщения',
      icon: 'chatbubbles-outline' as const,
      activeIcon: 'chatbubbles' as const,
      path: '/(main)/messages'
    },
    {
      name: 'search',
      title: 'Поиск',
      icon: 'search-outline' as const,
      activeIcon: 'search' as const,
      path: '/(main)/search'
    },
    {
      name: 'profile',
      title: 'Профиль',
      icon: 'person-outline' as const,
      activeIcon: 'person' as const,
      path: '/(main)/profile'
    }
  ];

  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = pathname === tab.path || pathname.startsWith(tab.path);

        return (
          <TouchableOpacity
            key={tab.name}
            style={[styles.tab, isActive && styles.activeTab]}
            onPress={() => router.push(tab.path as any)}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <Ionicons
                name={isActive ? tab.activeIcon : tab.icon}
                size={24}
                color={isActive ? theme.primary : theme.textSecondary}
              />
              {tab.name === 'messages' && unreadCount > 0 && (
                <View style={[styles.badge, { backgroundColor: theme.error || '#ff3b30' }]}>
                  <Text style={styles.badgeText}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[
              styles.label,
              {
                color: isActive ? theme.primary : theme.textSecondary,
                fontWeight: isActive ? '600' : '400'
              }
            ]}>
              {tab.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingTop: 4,
    paddingHorizontal: 4,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    elevation: 8,
    shadowColor: theme.shadowColor,
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 0,
    paddingHorizontal: 0,
    borderRadius: 1,
    marginHorizontal: 2,
  },
  activeTab: {
    backgroundColor: theme.primary + '10',
  },
  iconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    padding: 2,
  },
  label: {
    fontSize: 11,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: theme.surface,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});