// utils/loginHelpers.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logCoinUsage, fetchUserInfo, checkCoinUsage } from './googleSheetAPI';
import { Alert } from 'react-native';
import { ensureFreshIdToken } from './authToken';
import { debugLog, debugWarn, debugError } from './debugLog';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useTranslation } from '../constants/i18n';

// 金幣規則設定
export const INITIAL_GIFT_COINS = 100;     // 首次登入送 100 金幣
export const COIN_COST_AI = 10;      // AI工具箱扣幾金幣
export const COIN_UNIT_MINUTES = 1;       // 幾分鐘為一單位
export const COIN_COST_PER_UNIT = 1;      // 每單位扣幾金幣

export const COINS_PER_MINUTE = COIN_COST_PER_UNIT / COIN_UNIT_MINUTES;

// 手動登入
export const handleLogin = async (
    setLoading?: (v: boolean) => void,
      t: (key: string, params?: Record<string, string | number>) => string = (k) => k
): Promise<{ user: any; message: string } | null> => {
    if (setLoading) setLoading(true);

    try {
        const result = await GoogleSignin.signIn();            //google 登入取得使用者資訊
        const user = (result as any)?.data?.user || {};

       // if (!user.id || !user.email) throw new Error("無法取得使用者資訊");
if (!user.id || !user.email) throw new Error(t('noUserInfo'));
       
        //分析使用者資訊
        let baseUser = {
            id: user.id,
            email: user.email,
            name: user.name || user.email.split('@')[0],
        };

        // 將資訊同步到本地
        await AsyncStorage.setItem('user', JSON.stringify(baseUser));
await checkCoinUsage({ ...baseUser, action: 'signup', value: 0, note: t('loginRecord') });

        // ✅ 初次登入送金幣
        const stored = await AsyncStorage.getItem('user');
        const current = stored ? JSON.parse(stored) : null;

        //let message = `你好，${current.name}！`;
let message = t('greeting', { name: current.name });

        if (!current.gifted) {
            await checkCoinUsage({
                ...baseUser,
                action: 'signup_bonus',
                value: INITIAL_GIFT_COINS,
note: t('signupBonus', { coins: INITIAL_GIFT_COINS }),
            });
            current.coins = INITIAL_GIFT_COINS;
            current.gifted = true;
message += `\n\n${t('bonusCoins', { coins: INITIAL_GIFT_COINS })}`;
        }

message += `\n\n${t('currentCoins', { coins: current.coins })}`;
message += `\n\n${t('transcriptionCost', { cost: COINS_PER_MINUTE })}`;
message += `\n\n${t('aiToolCost', { cost: COIN_COST_AI })}`;


        return { user: current, message }; // ✅ 回傳給 VoiceNote
    } catch (err) {
     //   Alert.alert('❌ 登入失敗', err instanceof Error ? err.message : '未知錯誤');
     Alert.alert(t('failedTitle'), err instanceof Error ? err.message : t('unknownError'));
        return null;
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

