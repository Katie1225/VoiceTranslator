// googleSheetAPI.ts

import { ensureFreshIdToken } from './authToken';
import { nginxVersion } from '../constants/variant';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';


let BASE_URL: string;

if (nginxVersion === 'blue') {
  BASE_URL = 'https://katielab.com/iap-redeem/';
} else if (nginxVersion === 'green') {
  BASE_URL = 'https://katielab.com/v1/iap-redeem/';
} else {
  throw new Error('未知的 nginxVersion');
}



// 全域使用者暫存
let cachedUser: UserInfo | null = null;

export const getCachedUser = () => cachedUser;

type UserInfo = {
  coins?: number;
  gifted?: boolean;
  giftNoticeShown?: boolean;
};

// ✅ 取得使用者資料（GET）
export async function fetchUserInfo(id: string) {
  console.log('fetchUserInfo');
  try {
    const response = await fetch(`${BASE_URL}?id=${id}`, {
      headers: {
        'Accept': 'application/json', // 明確要求 JSON 回應
      },
    });
    console.log(`${BASE_URL}?id=${id}`);

    // 檢查回應的 Content-Type 是否是 JSON
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      const text = await response.text();
      throw new Error(`非 JSON 回應: ${text.substring(0, 100)}`);
    }

    const json = await response.json();
    if (json.success && json.data) {
      cachedUser = json.data;
      return json;
    }
    return { success: false, data: null, message: json.message };
  } catch (err) {
    return { success: false, data: null, message: (err as Error).message };
  }
}

export async function logCoinUsage({
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
    //     const idToken = await ensureFreshIdToken(); // 這裡才驗證
    // console.log("🧪 idToken 發行時間:", JSON.parse(atob(idToken.split('.')[1])));
    console.log('logCoinUsage');

    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, value, note, idToken: undefined, }),
    });
    const data = await res.json();
    // ✅ 更新本地金幣
    if (typeof data.coins === 'number') {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) {
          const user = JSON.parse(stored);
          user.coins = data.coins;
          await AsyncStorage.setItem('user', JSON.stringify(user));
        }
      } catch (err) {
        console.warn('⚠️ 無法更新本地金幣 (checkCoinUsage)', err);
      }
    }

    return data;


  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function checkCoinUsage({
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
    console.log('chekCoinUsage1');
    
    // 非強制取得
   const idToken = await ensureFreshIdToken(); // 這裡才驗證

// 強制取得
/*
const result = await GoogleSignin.signIn(); // 強制讓使用者登入一次
const freshTokens = await GoogleSignin.getTokens(); // 取得新的 idToken
const idToken = freshTokens.idToken;*/


    console.log('chekCoinUsage2');
    console.log("🧪 idToken =", idToken);
    console.log("🧪 raw middle =", idToken?.split?.(".")[1]);


    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, value, note, idToken }),
    });

    // 
    const data = await res.json();
    // ✅ 更新本地金幣
    if (typeof data.coins === 'number') {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) {
          const user = JSON.parse(stored);
          user.coins = data.coins;
          await AsyncStorage.setItem('user', JSON.stringify(user));
        }
      } catch (err) {
        console.warn('⚠️ 無法更新本地金幣 (checkCoinUsage)', err);
      }
    }

    return data;
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}