// authToken.ts
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { debugLog, debugWarn, debugError } from './debugLog';

// 定義翻譯函數類型
type TranslationFunction = (key: string, params?: Record<string, string | number>) => string;

export const ensureFreshIdToken = async (t?: TranslationFunction): Promise<string> => {
  // 提供默認的英文翻譯
  const defaultT = (key: string) => {
    const translations: Record<string, string> = {
      'silentLoginNoToken': 'Silent login failed - no ID token',
      'interactiveLoginNoToken': 'Interactive login also failed - no ID token',
      'pleaseLoginAgain': 'Please log in again and try',
    };
    return translations[key] || key;
  };
  
  const translate = t || defaultT;

  try {
    // ✅ GoogleSignin SDK 內部有幫你判斷 token 是否有效, 無效就進行 嘗試靜默登入 
    const silentUser = await GoogleSignin.signInSilently();
    const tokens = await GoogleSignin.getTokens();
    if (!tokens.idToken) throw new Error(translate('silentLoginNoToken'));
    return tokens.idToken;
  } catch (err) {
    debugWarn('⚠️ 靜默登入失敗，轉為互動登入:', err);

    try {
      await GoogleSignin.signOut(); // 乾淨重新登入
      const user = await GoogleSignin.signIn();
      const tokens = await GoogleSignin.getTokens();
      if (!tokens.idToken) throw new Error(translate('interactiveLoginNoToken'));
      return tokens.idToken;
    } catch (err2) {
      debugError('❌ 強制登入也失敗:', err2);
      throw new Error(translate('pleaseLoginAgain'));
    }
  }
};