import { Stack } from 'expo-router';
import { View, StyleSheet } from 'react-native';

export default function Layout() {
  return (
    <View style={styles.container}>
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5' // 全局背景色
  }
});