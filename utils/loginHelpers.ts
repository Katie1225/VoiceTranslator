// utils/loginHelpers.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logCoinUsage, fetchUserInfo, checkCoinUsage } from './googleSheetAPI';
import { Alert } from 'react-native';
import { ensureFreshIdToken } from './authToken';
import { debugLog, debugWarn,debugError } from './debugLog';
import { GoogleSignin } from '@react-native-google-signin/google-signin';


// 金幣規則設定
export const INITIAL_GIFT_COINS = 100;     // 首次登入送 100 金幣
export const COIN_COST_AI = 10;      // AI工具箱扣幾金幣
export const COIN_UNIT_MINUTES = 1;       // 幾分鐘為一單位
export const COIN_COST_PER_UNIT = 1;      // 每單位扣幾金幣

export const COINS_PER_MINUTE = COIN_COST_PER_UNIT / COIN_UNIT_MINUTES;

// 手動登入
export const handleLogin = async (
    setLoading?: (v: boolean) => void
): Promise<boolean> => {
    if (setLoading) setLoading(true);

    try {
        const result = await GoogleSignin.signIn();            //google 登入取得使用者資訊
        const user = (result as any)?.data?.user || {};
        
        if (!user.id || !user.email) throw new Error("無法取得使用者資訊");

        //分析使用者資訊
        let  baseUser = {
            id: user.id,
            email: user.email,
            name: user.name || user.email.split('@')[0],
        };             

        // 將資訊同步到本地
        await AsyncStorage.setItem('user', JSON.stringify(baseUser)); 

        debugLog(baseUser);

       await checkCoinUsage({ ...baseUser, action: 'signup', value: 0, note: '登入紀錄' });



            // ✅ 初次登入送金幣
    const stored = await AsyncStorage.getItem('user');
    const current = stored ? JSON.parse(stored) : null;

        let message = `你好，${current.name}！`;

        if (!current.gifted) {
            await checkCoinUsage({
                ...baseUser,
                action: 'signup_bonus',
                value: INITIAL_GIFT_COINS,
                note: `首次登入送 ${INITIAL_GIFT_COINS} 金幣`,
            });
            current.coins = INITIAL_GIFT_COINS;
            current.gifted = true;
            message += `\n\n🎁 首次登入已免費送你 ${INITIAL_GIFT_COINS} 金幣！`;

        }

        if (!current.giftNoticeShown) {
            await logCoinUsage({
                ...baseUser,
                action: 'gift_notice_ack',
                value: 0,
                note: '首次登入提示已顯示',
            });
            current.giftNoticeShown = true;
        }

        message += `\n\n💰 你目前擁有 ${current.coins} 金幣`;
        message += `\n\n📌 錄音轉文字每 1 分鐘 ${COINS_PER_MINUTE} 金幣, 並獲得重點摘要`;
        message += `\n\n📌 AI 工具箱每次使用 ${COIN_COST_AI} 金幣`;

        Alert.alert('✅ 登入成功', message);
        return true;
    } catch (err) {
        Alert.alert('❌ 登入失敗', err instanceof Error ? err.message : '未知錯誤');
        return false;
    } finally {
        if (setLoading) setLoading(false);
    }
};

// 從本地 AsyncStorage 取出目前登入的使用者資訊
export const loadUserAndSync = async () => {
    const stored = await AsyncStorage.getItem('user');
    if (stored) {
        const user = JSON.parse(stored);
        const remote = await fetchUserInfo(user.id);
        if (remote.success && remote.data?.coins != null) {
            const current = {
                ...user,
                coins: remote.data.coins,
                gifted: remote.data.gifted,
                giftNoticeShown: remote.data.giftNoticeShown,
            };
            await AsyncStorage.setItem('user', JSON.stringify(current));
        }
    }
};
