// utils/loginHelpers.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logCoinUsage, fetchUserInfo } from './googleSheetAPI';
import { INITIAL_GIFT_COINS, COINS_PER_MINUTE } from './iap';
import { Alert } from 'react-native';

import { GoogleSignin } from '@react-native-google-signin/google-signin';


export const handleLogin = async (
    setLoading?: (v: boolean) => void
): Promise<boolean> => {
    if (setLoading) setLoading(true);

    try {
        const result = await GoogleSignin.signIn();
        const user = (result as any)?.data?.user || {};
        const tokens = await GoogleSignin.getTokens();
        const idToken = tokens.idToken;
        if (!user.id || !user.email) throw new Error("無法取得使用者資訊");

        const baseUser = {
            id: user.id,
            idToken,
            email: user.email,
            name: user.name || user.email.split('@')[0],
        };

        console.log(baseUser);
        await logCoinUsage({ ...baseUser, action: 'signup', value: 0, note: '首次登入紀錄' });

        // 同步 Google Sheet 上的用戶狀態
        const remote = await fetchUserInfo(user.id);
        let updatedUser = {
            ...user,
            coins: remote?.data?.coins ?? 0,
            gifted: remote?.data?.gifted ?? false,
            giftNoticeShown: remote?.data?.giftNoticeShown ?? false,
        };

        console.log(updatedUser);

        let message = `你好，${baseUser.name}！`;

        if (!updatedUser.gifted) {
            await logCoinUsage({
                ...baseUser,
                action: 'signup_bonus',
                value: INITIAL_GIFT_COINS,
                note: `首次登入送 ${INITIAL_GIFT_COINS} 金幣`,
            });
            updatedUser.coins = INITIAL_GIFT_COINS;
            updatedUser.gifted = true;
            message += `\n\n🎁 首次登入已免費送你 ${INITIAL_GIFT_COINS} 金幣！`;

        }

        if (!updatedUser.giftNoticeShown) {
            await logCoinUsage({
                ...baseUser,
                action: 'gift_notice_ack',
                value: 0,
                note: '首次登入提示已顯示',
            });
            updatedUser.giftNoticeShown = true;
        }

        message += `\n\n💰 你目前擁有 ${updatedUser.coins} 金幣`;
        message += `\n\n📌 錄音轉文字每 1 分鐘會扣 ${COINS_PER_MINUTE} 金幣`;

        await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
        Alert.alert('✅ 登入成功', message);
        return true;
    } catch (err) {
        Alert.alert('❌ 登入失敗', err instanceof Error ? err.message : '未知錯誤');
        return false;
    } finally {
        if (setLoading) setLoading(false);
    }
};

export const loadUserAndSync = async () => {
    const stored = await AsyncStorage.getItem('user');
    if (stored) {
        const user = JSON.parse(stored);
        const remote = await fetchUserInfo(user.id);
        if (remote.success && remote.data?.coins != null) {
            const updatedUser = {
                ...user,
                coins: remote.data.coins,
                gifted: remote.data.gifted,
                giftNoticeShown: remote.data.giftNoticeShown,
            };
            await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
        }
    }
};
