// googleSheetAPI.ts
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debugError, debugLog, debugWarn } from './debugLog';
import { ensureFreshIdToken } from './authToken';
import { nginxVersion, getSignupBonus } from '../constants/variant';
import { useTranslation } from '../constants/i18n';

let SERVER_URL: string;

if (nginxVersion === 'blue') {
  SERVER_URL = 'https://katielab.com/iap-redeem-trans/';
} else if (nginxVersion === 'green') {
  SERVER_URL = 'https://katielab.com/v1/iap-redeem-trans/';
} else {
  throw new Error('Server error'); 
}

/**
 * 🟢 登入處理與首次登入檢查 - 合併 loginHelpers 的功能
 */
export async function handleLogin(userObj: any, setCurrentUser: (user: any) => void): Promise<number> {
  try {
    if (!userObj?.email) {
      throw new Error('無法取得使用者資料');
    }

    // 先從本地儲存恢復金幣（解決金幣消失問題）
    const savedCoins = await AsyncStorage.getItem('coins');
    const initialCoins = savedCoins ? parseInt(savedCoins, 10) : 0;
    
    // 儲存登入使用者資料（包含金幣）
    const userWithCoins = {
      ...userObj,
      coins: initialCoins
    };
    
    setCurrentUser(userWithCoins);
    await AsyncStorage.setItem('user', JSON.stringify(userWithCoins));

    // 檢查並發送首次登入獎勵
    const bonus = await checkSignupBonus(userObj.id);
    
    if (bonus > 0) {
      // 更新本地金币
      const updatedUser = {
        ...userWithCoins,
        coins: initialCoins + bonus
      };
      
      setCurrentUser(updatedUser);
      await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
      await AsyncStorage.setItem('coins', (initialCoins + bonus).toString());
      
      return bonus;
    }
    
    return 0;

  } catch (err) {
    console.error('handleLogin error:', err);
    throw err;
  }
}

/**
 * 🟢 登入時檢查是否首次登入贈送
 */
export async function checkSignupBonus(userId: string): Promise<number> {
  try {
    const bonusAmount = getSignupBonus();
    const response = await fetch(`${SERVER_URL}/check-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        id: userId,
        coins: bonusAmount
      }),
    });

    const data = await response.json();
    
    if (data.bonusGiven) {
      // 從伺服器獲取實際贈送的金幣數量
      const bonusCoins = data.coins || bonusAmount;
      
      // 更新本地儲存
      const currentUserStr = await AsyncStorage.getItem('user');
      const currentCoinsStr = await AsyncStorage.getItem('coins');
      const currentCoins = currentCoinsStr ? parseInt(currentCoinsStr, 10) : 0;
      
      if (currentUserStr) {
        const currentUser = JSON.parse(currentUserStr);
        const updatedUser = {
          ...currentUser,
          coins: currentCoins + bonusCoins
        };
        
        await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
      }
      
      // 更新金幣總數
      await AsyncStorage.setItem('coins', (currentCoins + bonusCoins).toString());
      
      return bonusCoins;
    }
    return 0;
  } catch (err) {
    console.error('checkSignupBonus error:', err);
    return 0;
  }
}

/**
 * 💰 儲值成功後通知伺服器
 */
/**
 * 💰 儲值成功後記錄到 Google Sheet（正確欄位版）
 */
export async function recordTopup(
  userId: string,
  coins: number,
  productId: string,
  email: string
) {
  try {
    const timestamp = new Date().toISOString();

    const payload = {
      id: userId,
      action: "topup",       // ⭐ 明確告訴後端這是加值
      coins: coins,          // ⭐ 加值金額，不是餘額
      timestamp: timestamp,  // ⭐ 後端會寫入 timestamp 欄位
      note: productId,       // ⭐ 產品 ID 寫進 note
      email: email           // ⭐ 寫進 email 欄位
    };

    debugLog("📤 上傳加值紀錄:", payload);

    await fetch(`${SERVER_URL}/topup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // ⭐ 本地金幣更新
    const currentCoinsStr = await AsyncStorage.getItem("coins");
    const currentCoins = currentCoinsStr ? parseInt(currentCoinsStr, 10) : 0;
    const newCoins = currentCoins + coins;

    await AsyncStorage.setItem("coins", newCoins.toString());

    // ⭐ 同步 user 物件
    const currentUserStr = await AsyncStorage.getItem("user");
    if (currentUserStr) {
      const user = JSON.parse(currentUserStr);
      const updatedUser = { ...user, coins: newCoins };
      await AsyncStorage.setItem("user", JSON.stringify(updatedUser));
    }

    debugLog(`💰 加值成功：+${coins}, 新餘額 = ${newCoins}`);

  } catch (err) {
    debugError("❌ recordTopup error:", err);
  }
}

// googleSheetAPI.ts - 新增特殊金額檢查函數
export async function checkSpecialBalance(
  userName: string,
  userId: string,
  email: string
): Promise<{ hasSpecialBalance: boolean; coins?: number }> {
  try {
    const response = await fetch(`${SERVER_URL}/check-special-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: userName,
        id: userId,
        email: email,    // ⭐ 加這行
      }),
    });

    return await response.json();
  } catch (err) {
    console.error('checkSpecialBalance error:', err);
    return { hasSpecialBalance: false };
  }
}


/**
 * 🔄 同步用戶金幣數據
 */
export async function syncUserCoins(userId: string): Promise<number> {
  try {
    const coinsStr = await AsyncStorage.getItem('coins');
    return parseInt(coinsStr || '0', 10);
  } catch (err) {
    console.error('syncUserCoins error:', err);
    return 0;
  }
}

/**
 * 應用啟動時自動載入登入資料和金幣
 */
export async function loadSavedUser(setCurrentUser: (user: any) => void) {
  try {
    const savedUser = await AsyncStorage.getItem('user');
    const savedCoins = await AsyncStorage.getItem('coins');
    
    if (savedUser) {
      const user = JSON.parse(savedUser);
      // 確保用戶物件包含最新的金幣數量
      const coins = savedCoins ? parseInt(savedCoins, 10) : (user.coins || 0);
      const userWithCoins = { ...user, coins };
      
      setCurrentUser(userWithCoins);
      await AsyncStorage.setItem('user', JSON.stringify(userWithCoins));
      await AsyncStorage.setItem('coins', coins.toString());
    }
  } catch (err) {
    console.error('loadSavedUser error:', err);
  }
}