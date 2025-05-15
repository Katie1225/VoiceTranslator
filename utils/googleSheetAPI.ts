// googleSheetAPI.ts
const BASE_URL = 'https://katielab.com/v1/iap-redeem/';



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
  idToken,
  action,
  value,
  note,
}: {
  id: string;
  idToken: string;
  action: string;
  value: number;
  note?: string;
}) {
  try {
  //  const res = await fetch(BASE_URL+"/", {
     const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, idToken, action, value, note }),
    });
    return await res.json();
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

