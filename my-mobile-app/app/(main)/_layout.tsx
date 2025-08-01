
import { Stack } from "expo-router";
import TabBar from "../../components/TabBar";
import { View, StyleSheet } from "react-native";
import { useTheme } from "../../contexts/ThemeContext";

export default function MainLayout() {
  const { theme } = useTheme();

  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: theme.headerBackground,
            borderBottomWidth: 1,
            borderBottomColor: theme.headerBorder,
            elevation: 4,
            shadowColor: theme.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
          },
          headerTitleStyle: {
            fontWeight: "bold",
            color: theme.headerText,
            fontSize: 18,
          },
          headerTintColor: theme.primary,
          headerBackTitleVisible: false,
        }}
      >
        <Stack.Screen
          name="feed"
          options={{
            title: "Новостная лента",
            headerTitleStyle: {
              fontWeight: "bold",
              color: theme.headerText,
              fontSize: 18,
            },
          }}
        />
        <Stack.Screen
          name="messages"
          options={{
            title: "Сообщения",
            headerTitleStyle: {
              fontWeight: "bold",
              color: theme.headerText,
              fontSize: 18,
            },
          }}
        />
        <Stack.Screen
          name="search"
          options={{
            title: "Поиск пользователей",
            headerTitleStyle: {
              fontWeight: "bold",
              color: theme.headerText,
              fontSize: 18,
            },
          }}
        />
        <Stack.Screen
          name="profile"
          options={{
            title: "Мой профиль",
            headerTitleStyle: {
              fontWeight: "bold",
              color: theme.headerText,
              fontSize: 18,
            },
          }}
        />
      </Stack>
      <TabBar />
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
});