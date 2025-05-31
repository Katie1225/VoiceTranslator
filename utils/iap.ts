import {
    initConnection,
    getProducts,
    requestPurchase as iapRequestPurchase,
    purchaseUpdatedListener,
    purchaseErrorListener,
    finishTransaction,
    ProductPurchase,
    Purchase,
    getAvailablePurchases,
} from 'react-native-iap';
import { Alert, Platform, EmitterSubscription } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logCoinUsage, checkCoinUsage } from './googleSheetAPI';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { debugValue } from '../constants/variant'
import { debugLog, debugWarn, debugError } from './debugLog';

let onTopUpCompleted: (() => void) | null = null;

export const setTopUpCompletedCallback = (fn: (() => void) | null) => {
  onTopUpCompleted = fn;
};

let onTopUpProcessingChange: ((isProcessing: boolean) => void) | null = null;

export const setTopUpProcessingCallback = (fn: ((isProcessing: boolean) => void) | null) => {
  onTopUpProcessingChange = fn;
};
// 產品配置
export const productToCoins: Record<string, number> = {
    'topup_100': debugValue === '1' ? 10 : 100,
    'topup_400': 400,
    'topup_1000': 1000,
};

export const productIds = Object.keys(productToCoins);


// 單例管理類
class PurchaseManager {
    private static instance: PurchaseManager;
    private listener: EmitterSubscription | null = null;

    private pendingActions: Array<{ type: string, index?: number }> = [];

    private constructor() { }

    public static getInstance(): PurchaseManager {
        if (!PurchaseManager.instance) {
            PurchaseManager.instance = new PurchaseManager();
        }
        return PurchaseManager.instance;
    }

    public async initialize(): Promise<boolean> {
        try {

            // 初始化IAP連接
            const connected = await initConnection();
            if (!connected) {
                throw new Error('無法連接到應用商店');
            }

            // 設置監聽器
            this.listener = purchaseUpdatedListener(this.handlePurchaseUpdate.bind(this));

            // 清理殘留交易
            await this.cleanupPendingTransactions();

            // 預加載產品資訊
            await this.loadProducts();

            return true;

        } catch (err) {
            debugError('IAP初始化失敗:', err);
            return false;
        } 
    }

    private async loadProducts() {
        try {
            const products = await getProducts({ skus: productIds });
            debugLog('✅ 加載產品列表成功', products);
        } catch (err) {
            debugError('❌ 加載產品列表失敗:', err);
        }
    }

    private async cleanupPendingTransactions() {
        try {
            const purchases = await getAvailablePurchases();
            for (const p of purchases) {
                await finishTransaction({ purchase: p, isConsumable: true });
            }
        } catch (err) {
            debugWarn('清理殘留交易失敗:', err);
        }
    }

    public getPendingActions() {
        return [...this.pendingActions]; // 返回副本以避免外部修改
    }

    // 添加公共方法來檢查是否有 pendingActions
    public hasPendingActions() {
        return this.pendingActions.length > 0;
    }

    private async handlePurchaseUpdate(purchase: Purchase) {
        try {
    // 開始處理時顯示遮罩
    if (onTopUpProcessingChange) onTopUpProcessingChange(true);
            if (!purchase.transactionReceipt) {
                debugWarn('交易未完成，略過');
                return;
            }

            // 完成交易
            await finishTransaction({ purchase, isConsumable: true });
            debugLog('✅ google交易已完成，使用者完成付款');

            // 驗證產品
            const coinsToAdd = productToCoins[purchase.productId];
            if (!coinsToAdd) {
                throw new Error(`無效產品ID: ${purchase.productId}`);
            }
            debugLog('✅ 有效產品 ID');

            // 記錄金幣
            const user = JSON.parse(await AsyncStorage.getItem('user') || '{}');
            debugLog('✅ 紀錄金幣');

            const result = await checkCoinUsage({
                id: user.id,
                email: user.email,
                name: user.name,
                action: 'topup',
                value: coinsToAdd,
                note: `購買 ${coinsToAdd} 金幣`
            });

            debugLog('✅ 上傳金幣');
            debugLog(result);

            if (!result.success) {
                throw new Error(result.message || '金幣記錄失敗');
            }

            // 更新本地金幣已在CheckCoinUsage 完成


            // 強制同步最新 user 資料
            //    await loadUserAndSync();

            // 顯示加值成功提示
            Alert.alert('✅ 加值成功', `已獲得 ${coinsToAdd} 金幣`);

if (onTopUpCompleted) {
  debugLog('🔁 呼叫儲值完成 callback');
  onTopUpCompleted();
  onTopUpCompleted = null;
}
            
            // 處理等待中的操作（現在確保金幣已更新後才執行）
     /*       if (this.pendingActions.length > 0) {
                const actions = [...this.pendingActions];
                this.clearPendingActions();
                return actions;
            } */
        } catch (err) {
            Alert.alert('❌ 購買處理失敗', err instanceof Error ? err.message : '未知錯誤');
        }finally {
    // 無論成功失敗都關閉遮罩
    if (onTopUpProcessingChange) onTopUpProcessingChange(false);
  }
    }

    public async requestPurchase(productId: string): Promise<boolean> {
        if (!productToCoins[productId]) {
            throw new Error('無效的產品ID');
        }

        try {
            const iapReady = await this.checkIAPReady();
            if (!iapReady) throw new Error('應用商店服務不可用');

            await iapRequestPurchase(
                Platform.OS === 'android'
                    ? { skus: [productId] }
                    : { sku: productId }
            );

            return true;
        } catch (err) {
            debugError('購買請求失敗:', err);
            throw err; // 重新拋出讓調用方處理
        }
    }

    private async checkIAPReady(): Promise<boolean> {
        try {
            return await initConnection();
        } catch (err) {
            return false;
        }
    }

    public addPendingAction(action: { type: string, index?: number }) {
        this.pendingActions.push(action);
    }

    public clearPendingActions() {
        this.pendingActions = [];
    }

    public cleanup() {
        this.listener?.remove();
        this.clearPendingActions();
    }
}

// 導出單例實例
export const purchaseManager = PurchaseManager.getInstance();







