import { Stack } from "expo-router";
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NotificationProvider } from '../contexts/NotificationContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { StyleSheet } from 'react-native';
import AuthGuard from '../components/AuthGuard';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider>
        <NotificationProvider>
          <AuthGuard>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(main)" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="chat/[id]" />
              {/* Другие экраны */}
            </Stack>
          </AuthGuard>
        </NotificationProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});