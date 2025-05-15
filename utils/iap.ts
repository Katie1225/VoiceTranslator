import {
    initConnection,
    getProducts,
    requestPurchase as iapRequestPurchase,
    purchaseUpdatedListener,
    purchaseErrorListener,
    finishTransaction,
    ProductPurchase,
} from 'react-native-iap';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logCoinUsage } from './googleSheetAPI';

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

// ✅ 設定購買完成監聽
export const setupPurchaseListener = (onSuccess: (coins: number) => void) => {
    const purchaseUpdate = purchaseUpdatedListener(async (purchase: ProductPurchase) => {
        try {
            const { productId, transactionId, transactionReceipt } = purchase;

            // ✅ 防止重複處理
            if (!transactionId) {
                console.warn('⚠️ 無效交易：缺少 transactionId，略過');
                return;
            }
            if (handledTransactionIds.has(transactionId)) {
                console.warn('⚠️ 此交易已處理過，略過:', transactionId);
                return;
            }
            handledTransactionIds.add(transactionId);
            console.log('🎉 購買成功:', productId);

            if (transactionReceipt) {
                const coins = productToCoins[productId] || 0;
                if (coins > 0) {
                    const stored = await AsyncStorage.getItem('user');
                    if (stored) {
                        const user = JSON.parse(stored);
                        user.coins = (user.coins || 0) + coins;
                        await AsyncStorage.setItem('user', JSON.stringify(user));
                        // ✅ 上報到 Google Sheet
                        await logCoinUsage({
                            id: user.id,
                            idToken: user.idToken,
                            action: 'topup',
                            value: coins,
                            note: `透過內購獲得 ${coins} 金幣（產品 ID: ${productId}）`,
                        });
                        onSuccess(coins);
                    }
                }

                // ✅ 新版 v12 的 finishTransaction 寫法
                await finishTransaction({ purchase, isConsumable: true });
            }
        } catch (err) {
            console.error('❌ 購買處理失敗:', err);
        } return {
            remove: () => {
                purchaseUpdate.remove();
                purchaseError.remove();
            },
        };

    });


    const purchaseError = purchaseErrorListener((error) => {
        console.error('❌ 購買錯誤:', error);
    });

    return {
        remove: () => {
            purchaseUpdate.remove();
            purchaseError.remove();
        },
    };
};
