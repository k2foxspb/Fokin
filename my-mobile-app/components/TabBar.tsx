import React, { useEffect } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useNotifications } from '../contexts/NotificationContext';
import { useTheme } from '../contexts/ThemeContext';

export default function TabBar() {
  const pathname = usePathname();
  const { unreadCount, requestPermissions, debugInfo } = useNotifications();
  const { theme } = useTheme();

  // Запрашиваем разрешения при первом рендере TabBar
  useEffect(() => {
    const checkAndRequestPermissions = async () => {
      if (!debugInfo.hasPermission) {
        console.log('🔔 [TabBar] No notification permissions detected, requesting...');
        try {
          const granted = await requestPermissions();
          if (!granted) {
            // Показываем пользователю информацию о необходимости разрешений
            setTimeout(() => {
              Alert.alert(
                'Уведомления отключены',
                'Для получения уведомлений о новых сообщениях разрешите приложению отправлять уведомления в настройках устройства.',
                [
                  { text: 'Понятно', style: 'default' }
                ]
              );
            }, 2000);
          }
        } catch (error) {
          console.error('❌ [TabBar] Error requesting permissions:', error);
        }
      }
    };

    checkAndRequestPermissions();
  }, [debugInfo.hasPermission, requestPermissions]);

  const tabs = [
    {
      name: 'feed',
      title: 'Лента',
      icon: 'home-outline',
      activeIcon: 'home',
      path: '/(main)/feed'
    },
    {
      name: 'messages',
      title: 'Сообщения',
      icon: 'chatbubbles-outline',
      activeIcon: 'chatbubbles',
      path: '/(main)/messages'
    },
    {
      name: 'search',
      title: 'Поиск',
      icon: 'search-outline',
      activeIcon: 'search',
      path: '/(main)/search'
    },
    {
      name: 'profile',
      title: 'Профиль',
      icon: 'person-outline',
      activeIcon: 'person',
      path: '/(main)/profile'
    }
  ];

  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = pathname === tab.path;

        return (
          <TouchableOpacity
            key={tab.name}
            style={styles.tab}
            onPress={() => router.push(tab.path)}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <Ionicons
                name={isActive ? tab.activeIcon : tab.icon}
                size={22}
                color={isActive ? theme.tabBarActive : theme.tabBarInactive}
              />
              {tab.name === 'messages' && unreadCount > 0 && (
                <View style={[styles.badge, {
                  // Делаем значок менее ярким если нет разрешений на уведомления
                  backgroundColor: debugInfo.hasPermission ? theme.tabBarBadge : theme.tabBarInactive,
                  opacity: debugInfo.hasPermission ? 1 : 0.7
                }]}>
                  <Text style={styles.badgeText}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[
              styles.label,
              { color: isActive ? theme.tabBarActive : theme.tabBarInactive }
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
    backgroundColor: theme.tabBarBackground,
    paddingBottom: 6,
    paddingTop: 6,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: theme.tabBarBorder,
    elevation: 8,
    shadowColor: theme.shadow,
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  iconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
  },
  badge: {
    position: 'absolute',
    top: -8,
    right: -12,
    backgroundColor: theme.tabBarBadge,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    borderWidth: 2,
    borderColor: theme.tabBarBackground,
    elevation: 3,
    shadowColor: theme.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
});