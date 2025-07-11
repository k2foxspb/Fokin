import { View, Text, StyleSheet } from "react-native";

export default function Feed() {
  return (
    <View style={styles.container}>
      <Text>Новостная лента</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});