import { Stack } from "expo-router";
import TabBar from "../../components/TabBar";
import { View, StyleSheet } from "react-native";

export default function MainLayout() {
  return (
    <View style={styles.container}>
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: "#fff",
          },
          headerTitleStyle: {
            fontWeight: "bold",
          },
        }}
      >
        <Stack.Screen
          name="feed"
          options={{
            title: "Новостная лента"
          }}
        />
        <Stack.Screen
          name="messages"
          options={{
            title: "Сообщения"
          }}
        />
        <Stack.Screen
          name="search"
          options={{
            title: "Поиск пользователей"
          }}
        />
        <Stack.Screen
          name="profile"
          options={{
            title: "Мой профиль"
          }}
        />
      </Stack>
      <TabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});