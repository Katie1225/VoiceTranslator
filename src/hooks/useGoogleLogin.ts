import { useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { logCoinUsage, fetchUserInfo } from '../../utils/googleSheetAPI';

export function useGoogleLogin() {
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const loginWithGoogle = async (): Promise<boolean> => {
    setIsLoggingIn(true);
    try {
      const result = await GoogleSignin.signIn();
      const user = (result as any)?.data?.user || {};

      if (!user.id || !user.email) {
        throw new Error('無法取得使用者資訊');
      }

      const postResult = await logCoinUsage({
        id: user.id,
        action: 'signup',
        value: 0,
        note: '首次登入（不給點，純登入記錄）',
        email: user.email,
        name: user.name || user.email.split('@')[0],
      });

      if (!postResult.success) throw new Error(postResult.message || '註冊失敗');

      const getResult = await fetchUserInfo(user.id);
      if (!getResult.success) throw new Error(getResult.message || '讀取資料失敗');

      const mergedUser = {
        ...user,
        coins: getResult.data?.coins || 0,
      };

      await AsyncStorage.setItem('user', JSON.stringify(mergedUser));

      Alert.alert(
        '登入成功',
        `你好，${mergedUser.name || mergedUser.email}\n目前金幣：${mergedUser.coins}`
      );

      return true;
    } catch (err) {
      Alert.alert('登入失敗', err instanceof Error ? err.message : '未知錯誤');
      return false;
    } finally {
      setIsLoggingIn(false);
    }
  };

  return { isLoggingIn, loginWithGoogle };
}
