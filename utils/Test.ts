  //test
  import AsyncStorage from '@react-native-async-storage/async-storage';

  export const checkStoredIdToken = async () => {
  const stored = await AsyncStorage.getItem('user');
  if (!stored) {
    console.log("❌ AsyncStorage 裡沒有 user");
    return;
  }

  const user = JSON.parse(stored);
  console.log("🟡 user from AsyncStorage:", user);

  if (user.idToken) {
    console.log("🟢 存在的 idToken：", user.idToken);
  } else {
    console.log("🔴 user 裡沒有 idToken 欄位");
  }
};