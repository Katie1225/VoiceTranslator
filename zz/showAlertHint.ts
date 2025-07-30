// utils/showAlertHint.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { useTranslation } from '../constants/i18n';
import { useLanguage } from '../constants/LanguageContext';

/**
 * 顯示一次性 Alert 提示訊息。
 * 若使用者點選「不再顯示」，將記錄於 AsyncStorage，未來不再顯示。
 * 
 * @param key 唯一識別鍵（儲存在 AsyncStorage 的 key）
 * @param title Alert 標題
 * @param message Alert 訊息內容
 * @returns true = 繼續執行，false = 中斷
 */
export const showAlertHint = async (
  key: string,
  title: string,
  message: string, 
    t: (key: string, params?: Record<string, string | number>) => string = (k) => k
): Promise<boolean> => {
  const disabled = await AsyncStorage.getItem(key);
const { setAppLocale } = useLanguage();
  if (disabled === 'true') return false;

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        {
          //text: '不再顯示',
           text: t('doNotShowAgain'), 
          onPress: async () => {
            await AsyncStorage.setItem(key, 'true');
            resolve(false);
          },
          style: 'destructive',
        },
        {
          text: 'OK',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: false }
    );
  });
};
