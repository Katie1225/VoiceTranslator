import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadUserAndSync } from './loginHelpers';
import { fetchUserInfo } from './googleSheetAPI';
import { debugLog } from './debugLog';
import { Linking } from 'react-native';

// 每日自動刷新比對金額

export const maybeSyncCoins = async () => {
  try {
    const stored = await AsyncStorage.getItem('user');
    if (!stored) return;

    const localUser = JSON.parse(stored);
    const lastSyncStr = await AsyncStorage.getItem('lastCoinSyncTime');
    const now = Date.now();
    const threshold = 24 * 60 * 60 * 1000; // 24 小時

    if (!lastSyncStr || now - parseInt(lastSyncStr) > threshold) {
      debugLog("🔄 自動同步金幣中...");

      const cloudUser = await fetchUserInfo(localUser.id);
      if (!cloudUser) {
        debugLog("❌ 無法取得雲端使用者資料");
        return;
      }

      const cloudCoins = cloudUser.coins ?? 0;
      const localCoins = localUser.coins ?? 0;

      if (cloudCoins !== localCoins) {
        const subject = encodeURIComponent(`金幣異常通知：${localUser.email}`);
        const body = encodeURIComponent(`
使用者 ID: ${localUser.id}
名稱: ${localUser.name || '無'}
Email: ${localUser.email}

📦 本地金幣: ${localCoins}
☁️ 雲端金幣: ${cloudCoins}

時間: ${new Date().toLocaleString()}
`);
        const mailtoUrl = `mailto:whycatiadm@gmail.com?subject=${subject}&body=${body}`;

        try {
          await Linking.openURL(mailtoUrl);
          debugLog("📧 已觸發金幣異常 email");
        } catch (err) {
          debugLog("❌ 無法開啟 email app 寄信", err);
        }
      }

      // 寫回最新資料與同步時間
      await AsyncStorage.setItem('user', JSON.stringify(cloudUser));
      await AsyncStorage.setItem('lastCoinSyncTime', now.toString());
    }
  } catch (err) {
    debugLog("❌ maybeSyncCoins 發生錯誤:", err);
  }
};
