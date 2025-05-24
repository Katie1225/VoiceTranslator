// googleSheetAPI.ts

import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debugError, debugLog, debugWarn } from './debugLog';
import { ensureFreshIdToken } from './authToken';
import { nginxVersion } from '../constants/variant';


let BASE_URL: string;

if (nginxVersion === 'blue') {
  BASE_URL = 'https://katielab.com/iap-redeem/';
} else if (nginxVersion === 'green') {
  BASE_URL = 'https://katielab.com/v1/iap-redeem/';
} else {
  throw new Error('未知的 nginxVersion');
}

type UserInfo = {
  coins?: number;
  gifted?: boolean;
  giftNoticeShown?: boolean;
};

// 確認金額不同發送信件
export const checkCoinMismatchAndNotify = async (cloudUser: any) => {
  try {
    const stored = await AsyncStorage.getItem('user');
    if (!stored) return;

    const localUser = JSON.parse(stored);
    const localCoins = localUser?.coins ?? null;
    const cloudCoins = cloudUser?.coins ?? null;
    const userId = cloudUser?.id ?? localUser?.id ?? null;
    let cachedUser: UserInfo | null = null;

    if (localCoins !== null && cloudCoins !== null && localCoins !== cloudCoins) {
      const note = `⚠️ 金幣不一致：本地=${localCoins}，雲端=${cloudCoins}`;

      
      // ✅ 通報錯誤（非 logCoinUsage，改用 reportError）
      await reportError({
        id: userId,
        action: 'coin-mismatch',
        value: 0,
        note,
      });

      // ✅ 同步本地使用者資訊
      const updatedUser = {
        ...cloudUser,
        coins: cloudCoins,
      };
      await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
      cachedUser = updatedUser;
      debugLog('同步資料', cachedUser);

      // ✅ 通知使用者
      alert(`⚠️ 金幣不一致\n已同步雲端金幣並登記差異：${note}`);
    }
  } catch (err) {
    debugError('❌ checkCoinMismatchAndNotify 發生錯誤:', err);
  }
};

// ✅ 取得使用者資料（GET）
export async function fetchUserInfo(id: string) {
  debugLog('fetchUserInfo');
  try {
    const response = await fetch(`${BASE_URL}?id=${id}`, {
      headers: {
        'Accept': 'application/json', // 明確要求 JSON 回應
      },
    });
    debugLog(`${BASE_URL}?id=${id}`);

    // 檢查回應的 Content-Type 是否是 JSON
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      const text = await response.text();
      throw new Error(`非 JSON 回應: ${text.substring(0, 100)}`);
    }

    const json = await response.json();
    if (json.success && json.data) {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) {
          const user = JSON.parse(stored);
          const updatedUser = { ...user, coins: json.data.coins };
          await checkCoinMismatchAndNotify(user);
          await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
          debugLog('💰 fetchUserInfo：已更新本地 coins =', json.data.coins);
        }
      } catch (err) {
        debugWarn('⚠️ fetchUserInfo：更新本地金幣失敗:', err);
      }
      return json;
    }
    return { success: false, data: null, message: json.message };
  } catch (err) {
    return { success: false, data: null, message: (err as Error).message };
  }

}

export async function logCoinUsage({
  id,
    email,
  name,
  action,
  value,
  note,
}: {
  id: string;
    email?: string;
  name?: string;
  action: string;
  value: number;
  note?: string;
}) {
  try {
    debugLog('logCoinUsage');

    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, email, name, action, value, note }),
    });
    const result = await res.json();
    debugLog('logCoinUsage 從雲端取回資訊', result);
    // ✅ 本地 coins 加減
    const stored = await AsyncStorage.getItem('user');
    const localUser = stored ? JSON.parse(stored) : null;

    if (localUser?.id === id) {
      localUser.coins = (localUser.coins || 0) + value;
      await AsyncStorage.setItem('user', JSON.stringify(localUser));
    }

    // ✅ 比對與寄信
    await checkCoinMismatchAndNotify(result.user);
    return result;

  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}


export async function checkCoinUsage({
  id,
    email,
  name,
  action,
  value,
  note,
}: {
  id: string;
    email?: string;
  name?: string;
  action: string;
  value: number;
  note?: string;
}) {
  try {
    debugLog('chekCoinUsage1');
    

    // 非強制取得
    const idToken = await ensureFreshIdToken(); // 這裡才驗證





    debugLog('chekCoinUsage2', JSON.stringify({ id, email, name, action, value, note, idToken }),);

    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, email, name, action, value, note, idToken }),
    });

    // 
    const result = await res.json();
    debugLog('checkCoinUsage 從雲端取回資訊', result);

    // ✅ 本地 coins 加減
    const stored = await AsyncStorage.getItem('user');
    const localUser = stored ? JSON.parse(stored) : null;

    if (localUser?.id === id) {
      localUser.coins = (localUser.coins || 0) + value;
      await AsyncStorage.setItem('user', JSON.stringify(localUser));
    }
      debugLog('同步資料2', result.user);
            debugLog('同步資料3', result);
    // ✅ 比對與寄信
    // ✅ 只有當不是 signup 才進行比對與寄信
    if (action !== 'signup') {
      await checkCoinMismatchAndNotify(result.user);
    }
//
    // 不寫會顯示雲端紀錄登記失敗(?) 但寫了錯誤更新的金額不會寫入本地 (?)

if (result.user) {
  await AsyncStorage.setItem('user', JSON.stringify(result.user));
}
    debugLog('chekCoinUsage3', result);
  const savedUser = await AsyncStorage.getItem('user');
  debugLog('✅ 儲存後讀出本地使用者資訊：', JSON.parse(savedUser || '{}'));

    return result;

  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function reportError({
  id,
  action,
  value,
  note,
}: {
  id: string;
  action: string;
  value: number;
  note?: string;
}) {
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, value, note }),
    });

    const result = await res.json();
    return result;

  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

