const BASE_URL = 'https://script.google.com/macros/s/AKfycbzwlnddM2PzTPris0BORJfDaZjn8GWseXNeVOIge2tf7Ogjvy-vSkwhyxxlgkUw9b_p/exec';




// ✅ 取得使用者資料（GET）
export async function fetchUserInfo(id: string): Promise<{
  success: boolean;
  data?: { coins?: number };
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

/*
// ✅ 金幣相關操作（例如扣除）
export async function callGoogleSheetAction(
  action: 'deduct' | 'add',
  id: string
): Promise<{ success: boolean; coins?: number; message?: string }> {
  try {
    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });

    return await response.json();
  } catch (err) {
    return {
      success: false,
      message: (err as Error).message || '金幣操作失敗',
    };
  }
}*/

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