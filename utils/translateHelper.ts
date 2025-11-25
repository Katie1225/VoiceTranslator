// utils/translateHelper.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nginxVersion } from '../constants/variant';
import { debugLog, debugWarn, debugError } from '../utils/debugLog';
import { getInitialFreeCoins } from '../constants/variant';

const FREE_CHAR_LIMIT = getInitialFreeCoins;

// 🔹 HTML 解碼
function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// 翻譯扣款
export async function translateText(text: string, targetLang: string): Promise<any> {
  try {
    const trimmed = text.trim();
    const len = trimmed.length;

    // ✅ 先檢查金幣是否足夠
    const coinsStr = await AsyncStorage.getItem('coins');
    const currentCoins = coinsStr ? parseInt(coinsStr, 10) : 0;
    
    debugLog(`💰 翻譯前金幣檢查: 需要 ${len} 金幣，目前有 ${currentCoins} 金幣`);
    
    if (currentCoins < len) {
      debugWarn(`🚫 金幣不足: 需要 ${len} 金幣，目前只有 ${currentCoins}`);
      return { error: 'insufficientCoins' };
    }

    // 實際呼叫翻譯 API
    const baseUrl = 
      nginxVersion === 'green'
        ? 'https://katielab.com/v1/translate/'
        : 'https://katielab.com/translate/';

    debugLog('🌐 開始呼叫翻譯 API...');
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, target: targetLang }),
    });

    const data = await response.json();
    const rawText = data.translatedText || data?.data?.translations?.[0]?.translatedText || '';
    const decoded = decodeHtmlEntities(rawText);

    // ✅ 重要：成功後扣除金幣
    const newCoins = currentCoins - len;
    await AsyncStorage.setItem('coins', newCoins.toString());
    
    debugLog(`✅ 扣款成功: 扣除 ${len} 金幣，剩餘 ${newCoins} 金幣`);

    // 同時更新用戶物件（如果已登入）
// ✅ 同時更新用戶物件（如果已登入）
try {
  const userStr = await AsyncStorage.getItem('user');
  if (userStr) {
    const user = JSON.parse(userStr);
    const updatedUser = { ...user, coins: newCoins };
    await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
    debugLog('✅ 同時更新使用者金幣物件');
  }
} catch (userError) {
  debugWarn('更新用戶金幣失敗:', userError);
}

debugLog(`✅ 扣款成功: 扣除 ${len} 金幣，剩餘 ${newCoins} 金幣`);

    return decoded || '(Translation failed)';
  } catch (err) {
    debugError('Translation error:', err);
    return '(Network error)';
  }
}

// 🔹 重置免費試用（方便測試）
export async function resetFreeTrial() {
  await AsyncStorage.removeItem('usedChars');
  debugLog('🔄 免費試用字數已重置');
}
