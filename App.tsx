// App.tsx
import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { APP_VARIANT, getInitialFreeCoins } from './constants/variant';
import { ThemeProvider } from './constants/ThemeContext';

import VoiceTranslator from './pages/VoiceTranslator';
import MenuPage from './pages/MenuPage';
import LanguagePage from './pages/LanguagePage';
import { LoginProvider } from './constants/LoginContext';
import { LanguageProvider } from './constants/LanguageContext';
import { purchaseManager } from './utils/iap';
import { debugError, debugLog, debugWarn } from './utils/debugLog';

// 保留你原本的設定
GoogleSignin.configure({
  webClientId: '425967296243-5g13mk77njoqcca2h4d7ro4c2gifbg9q.apps.googleusercontent.com',
  offlineAccess: true,
});

// 讓 variantMap 更寬鬆，避免型別卡到
const variantMap: Record<string, React.ComponentType<any>> = {
  note: VoiceTranslator,
  clamp: VoiceTranslator,
  notedebug: VoiceTranslator,
};

// 預設頁面仍維持 variantMap 結構
const SelectedPage = variantMap[APP_VARIANT] || (() => {
  debugWarn(`⚠️ APP_VARIANT '${APP_VARIANT}' 無效，已使用預設 'note'`);
  return VoiceTranslator;
})();

// ✅ 補上 VoiceTranslator route 的參數型別，解掉 navigate 時的 never 問題
export type RootStackParamList = {
  RecorderPage: {
    autoTranslate?: string | null;
    toggleLayout?: boolean | null;
  };
  MenuPage: undefined;
  LanguagePage: undefined;
  VoiceTranslator: {
    autoTranslate?: string | null;
    toggleLayout?: boolean | null;
    setLayoutMode?: 'default' | 'reversed'; // 新增這個
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // 首次安裝贈送
        const isFirstInstall = await checkFirstInstall();
        if (isFirstInstall) {
          await giveInstallationBonus();
        }

        // 初始化 IAP
        const iapInitialized = await purchaseManager.initialize();
        if (!iapInitialized) {
          debugWarn('IAP 初始化失敗');
        }

        setAppIsReady(true);
      } catch (error) {
        debugError('App initialization failed:', error);
        setAppIsReady(true);
      }
    };

    initializeApp();
  }, []);

  if (!appIsReady) {
    return null; // 需要的話可放置啟動畫面
  }

  return (
    <LoginProvider>
        <ThemeProvider>
          <LanguageProvider>
            <NavigationContainer>
              <Stack.Navigator initialRouteName="RecorderPage" screenOptions={{ headerShown: false }}>
                <Stack.Screen name="RecorderPage" component={SelectedPage} />
                <Stack.Screen name="MenuPage" component={MenuPage} />
                <Stack.Screen name="LanguagePage" component={LanguagePage} />
                {/* ✅ 新增：顯式註冊 VoiceTranslator route，支援 autoTranslate 參數 */}
                <Stack.Screen name="VoiceTranslator" component={VoiceTranslator} />
              </Stack.Navigator>
            </NavigationContainer>
          </LanguageProvider>
        </ThemeProvider>
    </LoginProvider>
  );
}

async function checkFirstInstall(): Promise<boolean> {
  try {
    const installed = await AsyncStorage.getItem('app_installed');
    if (!installed) {
      await AsyncStorage.setItem('app_installed', 'true');
      return true;
    }
    return false;
  } catch (error) {
    debugError('Check first install error:', error);
    return false;
  }
}

async function giveInstallationBonus() {
  try {
    const bonusAmount = getInitialFreeCoins();
    const currentCoinsStr = await AsyncStorage.getItem('coins');
    const currentCoins = currentCoinsStr ? parseInt(currentCoinsStr, 10) : 0;
    const newCoins = currentCoins + bonusAmount;

    await AsyncStorage.setItem('coins', newCoins.toString());

    // 若已登入，同步更新 user 物件
    const userStr = await AsyncStorage.getItem('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      const updatedUser = { ...user, coins: newCoins };
      await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
    }

    debugLog(`🎁 安裝贈送 ${bonusAmount} 金幣！目前總數: ${newCoins}`);
  } catch (error) {
    debugError('Give installation bonus error:', error);
  }
}
