import { GoogleSignin } from '@react-native-google-signin/google-signin';

export const ensureFreshIdToken = async (): Promise<string> => {
  try {
    // ✅ GoogleSignin SDK 內部有幫你判斷 token 是否有效, 無效就進行 嘗試靜默登入 
    const silentUser = await GoogleSignin.signInSilently();
    const tokens = await GoogleSignin.getTokens();
    if (!tokens.idToken) throw new Error('靜默登入無 idToken');
    return tokens.idToken;
  } catch (err) {
    console.warn('⚠️ 靜默登入失敗，轉為互動登入:', err);

    try {
      await GoogleSignin.signOut(); // 乾淨重新登入
      const user = await GoogleSignin.signIn();
      const tokens = await GoogleSignin.getTokens();
      if (!tokens.idToken) throw new Error('互動登入也無 idToken');
      return tokens.idToken;
    } catch (err2) {
      console.error('❌ 強制登入也失敗:', err2);
      throw new Error('請重新登入後再試');
    }
  }
};
