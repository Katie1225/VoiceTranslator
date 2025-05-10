// googleSheetAPI.ts
const BASE_URL = 'https://script.google.com/macros/s/AKfycbw4TrRmrfIkobg3X53If14mzY-llaBBYfAcIjI5YpZZEylU5LyQmA5eDxbzh7iqcam9/exec';

// 金幣規則設定
export const INITIAL_GIFT_COINS = 100;     // 首次登入送 100 金幣
export const COIN_UNIT_MINUTES = 1;       // 幾分鐘為一單位
export const COIN_COST_PER_UNIT = 1;      // 每單位扣幾金幣

export const COINS_PER_MINUTE = COIN_COST_PER_UNIT / COIN_UNIT_MINUTES;

// 全域使用者暫存
let cachedUser: UserInfo | null = null;

export const getCachedUser = () => cachedUser;

type UserInfo = {
  coins?: number;
  gifted?: boolean;
  giftNoticeShown?: boolean;
};

// ✅ 取得使用者資料（GET）
export async function fetchUserInfo(id: string): Promise<{
  success: boolean;
  data: UserInfo | null;
  message?: string;
}> {
  try {
    const response = await fetch(`${BASE_URL}?id=${id}`);
    const json = await response.json();
    if (json.success && json.data) {
      cachedUser = json.data; // ✅ 同步全域變數
    }
    return json;
  } catch (err) {
    return {
      success: false,
      data: null,
      message: (err as Error).message || '取得資料失敗',
    };
  }
}

export async function logCoinUsage(payload: {
  id: string;
  action: string;
  value: number;
  note: string;
}) {
  try {
    const response = await fetch(`${BASE_URL}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await response.json();

    if (json.success && typeof json.newCoins === 'number') {
      // ✅ 回傳的最新金幣值，直接更新 cachedUser
      if (cachedUser) {
        cachedUser.coins = json.newCoins;
      }
    }
    return json;
  } catch (err) {
    return {
      success: false,
      message: (err as Error).message || '紀錄失敗',
    };
  }
}

