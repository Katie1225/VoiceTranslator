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
import {debugValue} from '../constants/variant'







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
            console.error('IAP初始化失敗:', err);
            return false;
        }
    }

    private async loadProducts() {
        try {
            const products = await getProducts({ skus: productIds });
            console.log('✅ 加載產品列表成功', products);
        } catch (err) {
            console.error('❌ 加載產品列表失敗:', err);
        }
    }

    private async cleanupPendingTransactions() {
        try {
            const purchases = await getAvailablePurchases();
            for (const p of purchases) {
                await finishTransaction({ purchase: p, isConsumable: true });
            }
        } catch (err) {
            console.warn('清理殘留交易失敗:', err);
        }
    }

    private async handlePurchaseUpdate(purchase: Purchase) {
        try {
            if (!purchase.transactionReceipt) {
                console.warn('交易未完成，略過');
                return;
            }

            // 完成交易
            await finishTransaction({ purchase, isConsumable: true });

                            console.log('✅ google交易已完成，使用者完成付款');

            // 驗證產品
            const coinsToAdd = productToCoins[purchase.productId];
            if (!coinsToAdd) {
                throw new Error(`無效產品ID: ${purchase.productId}`);
            }

                            console.log('✅ 有效產品 ID');
            

            // 記錄金幣
            const user = JSON.parse(await AsyncStorage.getItem('user') || '{}');

             console.log('✅ 紀錄金幣');

            const result = await checkCoinUsage({
                id: user.id,
                action: 'topup',
                value: coinsToAdd,
                note: `購買 ${coinsToAdd} 金幣`
            });

   console.log('✅ 上傳金幣');
   
            if (!result.success) {
                throw new Error(result.message || '金幣記錄失敗');
            }

            // 更新本地金幣
            user.coins = (user.coins || 0) + coinsToAdd;
            await AsyncStorage.setItem('user', JSON.stringify(user));

            // 處理等待中的操作
            if (this.pendingActions.length > 0) {
                Alert.alert('✅ 加值成功', `已獲得 ${coinsToAdd} 金幣，繼續之前操作`);
                const actions = [...this.pendingActions];
                this.clearPendingActions();
                return actions;
            }

            Alert.alert('✅ 加值成功', `已獲得 ${coinsToAdd} 金幣`);
        } catch (err) {
            Alert.alert('❌ 購買處理失敗', err instanceof Error ? err.message : '未知錯誤');
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
            console.error('購買請求失敗:', err);
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







