import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useNotifications } from '../contexts/NotificationContext';

export default function TabBar() {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();

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

  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = pathname === tab.path;

        return (
          <TouchableOpacity
            key={tab.name}
            style={styles.tab}
            onPress={() => router.push(tab.path)}
          >
            <View style={styles.iconContainer}>
              <Ionicons
                name={isActive ? tab.activeIcon : tab.icon}
                size={24}
                color={isActive ? '#007AFF' : 'gray'}
              />
              {tab.name === 'messages' && unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[
              styles.label,
              { color: isActive ? '#007AFF' : 'gray' }
            ]}>
              {tab.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingBottom: 20,
    paddingTop: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    elevation: 8,
    shadowColor: '#000',
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
  },
  iconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
  },
  badge: {
    position: 'absolute',
    top: -8,
    right: -12,
    backgroundColor: '#ff3b30',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
});