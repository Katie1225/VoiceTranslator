import {
    initConnection,
    getProducts,
    requestPurchase as iapRequestPurchase,
    purchaseUpdatedListener,
    purchaseErrorListener,
    finishTransaction,
    ProductPurchase,
    Purchase,
} from 'react-native-iap';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logCoinUsage } from './googleSheetAPI';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

// 金幣規則設定
export const INITIAL_GIFT_COINS = 100;     // 首次登入送 100 金幣
export const COIN_UNIT_MINUTES = 1;       // 幾分鐘為一單位
export const COIN_COST_PER_UNIT = 1;      // 每單位扣幾金幣

export const COINS_PER_MINUTE = COIN_COST_PER_UNIT / COIN_UNIT_MINUTES;


// 金幣儲存規則

export const productIds = ['topup_100', 'topup_400', 'topup_1000'];

const productToCoins: Record<string, number> = {
    topup_100: 100,
    topup_400: 400,
    topup_1000: 1000,
};

const handledTransactionIds = new Set<string>();


// ✅ 初始化 IAP
export const initIAP = async () => {
    try {
        const connected = await initConnection();
        console.log('✅ IAP 連線成功:', connected);
        return connected;
    } catch (err) {
        console.error('❌ IAP 初始化失敗:', err);
        return false;
    }
};

// ✅ 正確的購買呼叫（v12+ 要求傳入 productId 字串）
export const requestPurchase = async (productId: string) => {
    try {
        console.log('🛒 發起購買:', productId);
        // ✅ 修正 Android 參數格式
        await iapRequestPurchase(Platform.OS === 'android'
            ? { skus: [productId] }
            : { sku: productId });
        console.log('🛒 購買參數:', Platform.OS === 'android' ? { skus: [productId] } : { sku: productId });
    } catch (err) {
        console.error('❌ 購買失敗:', err);
        throw err; // Re-throw if you want to handle it in the calling component
    }
};



const processingTransactions = new Set<string>(); // 新增：正在處理中的交易

export const setupPurchaseListener = () => {
  return purchaseUpdatedListener(async (purchase: Purchase) => {
    try {
      // ✅ 完成交易（要用物件格式包起來）
      await finishTransaction({ purchase });

      // ✅ 拿最新的 idToken
      await GoogleSignin.signInSilently();
      const tokens = await GoogleSignin.getTokens();
      const stored = await AsyncStorage.getItem('user');
      const user = JSON.parse(stored || '{}');

      // ✅ 寫入金幣紀錄（固定加 100）
      const result = await logCoinUsage({
        id: user.id,
        idToken: tokens.idToken,
        action: 'topup',
        value: 100,
        note: '購買金幣',
      });

      if (result.success) {
        // ✅ 更新本地金幣
        user.coins = (user.coins || 0) + 100;
        await AsyncStorage.setItem('user', JSON.stringify(user));

        // ✅ 成功才顯示提示
        Alert.alert('✅ 購買成功', `已獲得 100 金幣`);
      } else {
        Alert.alert('⚠️ 金幣尚未入帳', result.message || '請稍候重試或聯繫客服');
      }
    } catch (err) {
      console.error('❌ 購買失敗:', err);
      Alert.alert('❌ 購買處理失敗', (err as Error).message || '請稍候再試');
    }
  });
};


