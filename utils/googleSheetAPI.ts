// googleSheetAPI.ts
const BASE_URL = 'https://script.google.com/macros/s/AKfycbw4TrRmrfIkobg3X53If14mzY-llaBBYfAcIjI5YpZZEylU5LyQmA5eDxbzh7iqcam9/exec';

// 金幣規則設定
export const INITIAL_GIFT_COINS = 100;     // 首次登入送 100 金幣
export const COIN_UNIT_MINUTES = 1;       // 幾分鐘為一單位
export const COIN_COST_PER_UNIT = 1;      // 每單位扣幾金幣

export const COINS_PER_MINUTE = COIN_COST_PER_UNIT / COIN_UNIT_MINUTES;


type UserInfo = {
  coins?: number;
  gifted?: boolean;
  giftNoticeShown?: boolean;
};

// ✅ 取得使用者資料（GET）
export async function fetchUserInfo(id: string): Promise<{
  success: boolean;
  data?: UserInfo;
  message?: string;
}> {
  try {
    const response = await fetch(`${BASE_URL}?id=${id}`);
    return await response.json();
  } catch (err) {
    return {
      success: false,
      message: (err as Error).message || '取得資料失敗',
    };
  }
}

export async function logCoinUsage({
  id,
  action,
  value,
  note,
  email,
  name
}: {
  id: string;
  action: string;
  value: number;
  note?: string;
  email?: string;
  name?: string;
}): Promise<{ success: boolean; message?: string }> {
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        action,
        value,
        note,
        email,
        name
      })
    });

    return await res.json();
  } catch (err) {
    return {
      success: false,
      message: (err as Error).message
    };
  }
}