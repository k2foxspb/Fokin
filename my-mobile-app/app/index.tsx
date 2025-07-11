import { StyleSheet } from "react-native";
import { Text, View } from "react-native";
import { Link } from "expo-router";

export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Добро пожаловать</Text>
      <Link href="/(auth)/login" style={styles.link}>
        Войти
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
  link: {
    color: "#007AFF",
    fontSize: 16,
  },
});