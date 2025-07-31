import { Stack } from 'expo-router';
import { NotificationProvider } from '../contexts/NotificationContext';
import { ThemeProvider } from '../contexts/ThemeContext';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <NotificationProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(main)" />
          {/* Эти страницы вне табов но с сохранением нижней панели */}
          <Stack.Screen
            name="user"
            options={{
              presentation: 'card',
              headerShown: false
            }}
          />
          <Stack.Screen
            name="albums"
            options={{
              presentation: 'card',
              headerShown: false
            }}
          />
          <Stack.Screen
            name="album"
            options={{
              presentation: 'card',
              headerShown: false
            }}
          />
          <Stack.Screen
            name="chat"
            options={{
              presentation: 'card',
              headerShown: false
            }}
          />
          <Stack.Screen
            name="avatar-view"
            options={{
              presentation: 'modal',
              headerShown: false
            }}
          />
        </Stack>
      </NotificationProvider>
    </ThemeProvider>
  );
}