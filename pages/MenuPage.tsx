//pages/MenuPage.tsx

import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Image, Share, Dimensions, Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { handleLogin, checkSpecialBalance } from '../utils/googleSheetAPI';
import { version, debugValue } from '../constants/variant';
import { FontScale, useTheme } from '../constants/ThemeContext';
import { useLogin } from '../constants/LoginContext';
import { useTranslation } from '../constants/i18n';
import { useLanguage } from '../constants/LanguageContext';
import RecorderHeader from '../components/RecorderHeader';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { RootStackParamList } from '../App';  // ✅ 匯入你的 Stack 型別
import { debugLog, debugWarn, debugError } from '@/utils/debugLog';
import { purchaseManager, waitForTopUp } from '../utils/iap';
import TopUpModal from '../components/TopUpModal';

export default function MenuPage() {
  const { fontScale, setFontScale, colors, styles, isDarkMode, toggleTheme, setCustomPrimaryColor, customPrimaryColor, additionalColors } = useTheme();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  // const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [layoutMode, setLayoutMode] = useState<'default' | 'reversed'>('default');
  const { t } = useTranslation();
  const { locale, setAppLocale } = useLanguage();
  const { isLoggingIn, setIsLoggingIn, currentUser, setCurrentUser, logout } = useLogin();

  const [lang, setLang] = useState<'zh' | 'en' | 'ja'>(locale);

  const [nameTapCount, setNameTapCount] = useState(0);
  const [lastTapTime, setLastTapTime] = useState(0);

  const [localCoins, setLocalCoins] = useState(0);

  useEffect(() => {
    setLang(locale);
  }, [locale]);

  // 添加 useEffect 來從 AsyncStorage 載入當前的佈局模式
  useEffect(() => {
    const loadLayoutMode = async () => {
      try {
        const saved = await AsyncStorage.getItem('vt_swap_state');
        if (saved) {
          const swapState = JSON.parse(saved);
          setLayoutMode(swapState.layoutMode || 'default');
        }
      } catch (error) {
        debugError('載入佈局模式失敗:', error);
      }
    };

    loadLayoutMode();
  }, []);

  // ✅ 載入本地金幣
  useEffect(() => {
    const loadLocalCoins = async () => {
      try {
        const coinsStr = await AsyncStorage.getItem('coins');
        const coins = coinsStr ? parseInt(coinsStr, 10) : 0;
        setLocalCoins(coins);
        debugLog('🔄 MenuPage 載入金幣:', coins);

        // ✅ 確保用戶物件的金幣也同步
        if (currentUser && currentUser.coins !== coins) {
          const updatedUser = {
            ...currentUser,
            coins: coins
          };
          setCurrentUser(updatedUser);
          await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
          debugLog('🔄 MenuPage 同步使用者金幣:', coins);
        }
      } catch (error) {
        debugError('載入本地金幣失敗:', error);
      }
    };

    loadLocalCoins();

  }, [navigation]);

  // ✅ 自動登入後回原頁
  useEffect(() => {
    (async () => {
      try {
        const autoLoginFlag = await AsyncStorage.getItem('autoLoginRequired');
        if (autoLoginFlag === 'true' && !currentUser) {
          debugLog('🔁 檢測到 autoLoginRequired，自動登入中...');
          await handleLoginWithAutoClose();

          await AsyncStorage.removeItem('autoLoginRequired');

          // 登入後檢查是否有待翻譯文字
          const pending = await AsyncStorage.getItem('pendingTranslation');
          if (pending) {
            debugLog('🔁 登入後偵測到待翻譯內容，回到 VoiceTranslator');
            await AsyncStorage.removeItem('pendingTranslation');

            // ✅ 直接導航，讓 VoiceTranslator 自己處理金幣檢查
            navigation.navigate('VoiceTranslator', {
              autoTranslate: pending
            });
          }
        }
      } catch (err) {
        debugError('自動登入檢查失敗:', err);
      }
    })();
  }, [currentUser]);

  // 修改登入函數
  const handleLoginWithAutoClose = async () => {
    setIsLoggingIn(true);
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();

      if (userInfo.data && userInfo.data.user) {
        const userObj = {
          id: userInfo.data.user.id,
          name: userInfo.data.user.name,
          email: userInfo.data.user.email,
          photo: userInfo.data.user.photo
          // coins 會在 handleLogin 中從 AsyncStorage 恢復
        };

        const bonus = await handleLogin(userObj, setCurrentUser);
        if (bonus > 0) {
          Alert.alert(`✅ ${t('loginSuccess')}`, `🎁 ${t('bonusCoins', { coins: bonus })}`);
          const updatedCoinsStr = await AsyncStorage.getItem('coins');
          setLocalCoins(updatedCoinsStr ? parseInt(updatedCoinsStr, 10) : 0);
        } else {
          Alert.alert(`✅ ${t('loginSuccess')}`);
        }
      }
    } catch (error) {
      debugError('Google登录失败:', error);
      let errorMessage = '登录过程中发生未知错误';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      Alert.alert(`❌ ${t('loginFailed')}`, errorMessage);
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 修改登出函數
  const handleLogout = async () => {
    try {
      await GoogleSignin.signOut();
      // 直接使用 LoginContext 的 logout 函數
      await logout();
    } catch (error) {
      debugError('登出失敗:', error);
    }
  };

  // reset 金幣跟紀錄 (測試模式)
  const resetForTesting = async () => {
    try {
      await AsyncStorage.multiRemove(['coins', 'user', 'usedChars']);
      setLocalCoins(0);
      setCurrentUser(null);
      Alert.alert('✅ 重置成功', '已清除所有資料，可測試首次安裝送款');
      debugLog('🧪 測試重置：清除所有使用者資料');
    } catch (error) {
      debugError('重置失敗:', error);
      Alert.alert('❌ 重置失敗', '請查看 console 錯誤訊息');
    }
  };
  // 加值測試 (測試模式)
  const addTestCoins = async (amount: number) => {
    try {
      const coinsStr = await AsyncStorage.getItem('coins');
      const currentCoins = coinsStr ? parseInt(coinsStr, 10) : 0;
      const newCoins = currentCoins + amount;
      await AsyncStorage.setItem('coins', newCoins.toString());
      setLocalCoins(newCoins);

      if (currentUser) {
        const updatedUser = { ...currentUser, coins: newCoins };
        setCurrentUser(updatedUser);
        await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
      }

      Alert.alert('✅ 測試加值', `已增加 ${amount} 測試金幣`);
    } catch (error) {
      debugError('加值失敗:', error);
    }
  };

  // ✅ 新增處理名字點擊的函數 (隱藏模式)
  const handleNamePress = async () => {
    const now = Date.now();

    // 如果距離上次點擊超過3秒，重置計數
    if (now - lastTapTime > 3000) {
      setNameTapCount(1);
    } else {
      // 3秒內連續點擊，增加計數
      setNameTapCount(prev => prev + 1);
    }

    setLastTapTime(now);

    // 檢查是否達到5次
    if (nameTapCount + 1 >= 5) {
      await executeSpecialBalance();
      setNameTapCount(0); // 重置計數
    }
  };

  // ✅ 新增檢查特殊設定的函數

  const executeSpecialBalance = async () => {
    if (!currentUser) return;

    try {
      const result = await checkSpecialBalance(currentUser.name, currentUser.id, currentUser.email);

      if (result.hasSpecialBalance && result.coins !== undefined) {
        // ✅ 改成累加到原本的金額
        const currentCoins = currentUser.coins || 0;
        const bonusCoins = result.coins; // 從雲端讀取的金額
        const newCoins = currentCoins + bonusCoins; // 累加

        await AsyncStorage.setItem('coins', newCoins.toString());

        const updatedUser = {
          ...currentUser,
          coins: newCoins
        };
        setCurrentUser(updatedUser);
        await AsyncStorage.setItem('user', JSON.stringify(updatedUser));

        Alert.alert('💰 ' + t('specialBalance'), `${t('bonusCoins', { coins: bonusCoins })}\n${t('currentCoins', { coins: newCoins })}`);
      } else {
        Alert.alert('ℹ️ ' + t('notice'), t('noSpecialBalance'));
      }
    } catch (error) {
      debugError('檢查特殊金額失敗:', error);
      Alert.alert('❌ ' + t('error'), t('specialBalanceError'));
    }
  };

  const pickLang = async (code: 'zh' | 'en' | 'ja') => {
    setLang(code);
    await setAppLocale(code);
  };


  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RecorderHeader
        mode="detail"
        title={t('settingsMenu')}
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={true}
      >
        {/* 用户登录/信息区域 */}
        {currentUser ? (
          <View style={[styles.menuItemButton, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
            <View style={{ flexDirection: 'column' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {currentUser.photo && (
                  <Image source={{ uri: currentUser.photo }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 8 }} />
                )}
                <TouchableOpacity onPress={handleNamePress}>
                  <Text style={styles.menuItem}>{currentUser.name || currentUser.email}</Text>
                </TouchableOpacity>
              </View>
              {typeof currentUser.coins === 'number' && (
                <Text style={[styles.menuItem, { fontSize: 12, color: 'gold' }]}>💰 {t('coins')}：{currentUser.coins}</Text>
              )}
            </View>
            <TouchableOpacity onPress={handleLogout}>
              <Text style={[styles.menuItem, { marginLeft: 12, fontSize: 12 }]}>{t('logout')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.menuItemButton}>
            <TouchableOpacity onPress={handleLoginWithAutoClose}>
              <Text style={styles.menuItem}>☁️ {t('googleLogin')}</Text>
            </TouchableOpacity>
            {/* ✅ 顯示未登入時的金幣 */}
            <Text style={[styles.menuItem, { fontSize: 12, color: 'gold' }]}>
              💰 {t('coins')}：{localCoins}
            </Text>
          </View>
        )}

        {/* 版本信息 */}
        <Text style={styles.menuItem}>{t('version')}: {version} </Text>

        {/* 联系开发者 */}
        <TouchableOpacity
          onPress={() => {
            Linking.openURL('mailto:katie@example.com?subject=User Feedback');
          }}
          style={styles.menuItemButton}
        >
          <Text style={styles.menuItem}>✉️ {t('contactKai')}</Text>
        </TouchableOpacity>

        {/* 分享应用 */}
        <TouchableOpacity
          onPress={async () => {
            try {
              await Share.share({
                message: t('shareMessage'),
              });
            } catch (error) {
              debugError(error);
            }
          }}
          style={styles.menuItemButton}
        >
          <Text style={styles.menuItem}>📲 {t('shareApp')}</Text>
        </TouchableOpacity>

        {/* 切換 Default / Reverse Layout */}
<View style={{ flexDirection: 'row', gap: 10, marginVertical: 10 }}>
  <TouchableOpacity
    onPress={() => {
      navigation.navigate("VoiceTranslator", {
        setLayoutMode: 'default'
      } as any);
    }}
    style={[
      styles.menuItemButton,
{
  backgroundColor: layoutMode === 'default' ? colors.primary : 'transparent',
  opacity: layoutMode === 'default' ? 1 : 1,
  borderRadius: 20, // 圓圈效果
  paddingHorizontal: 12, // 左右小一點
  paddingVertical: 8, // 上下更小
  marginVertical: 2,
  alignItems: 'center', // 字置中
  justifyContent: 'center', // 字置中
  minHeight: 36 // 固定高度讓圈圈小一點
}
    ]}
    disabled={layoutMode === 'default'}
  >
    <Text style={[
      styles.menuItem,
      {
        color: layoutMode === 'default' ? colors.background : colors.text,
        textAlign: 'center'
      }
    ]}>
      💬 {t('conversationMode')}
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    onPress={() => {
      navigation.navigate("VoiceTranslator", {
        setLayoutMode: 'reversed'
      } as any);
    }}
    style={[
      styles.menuItemButton,
{
  backgroundColor: layoutMode === 'reversed' ? colors.primary : 'transparent',
  opacity: layoutMode === 'reversed' ? 1 : 1,
  borderRadius: 20, // 圓圈效果
  paddingHorizontal: 12, // 左右小一點
  paddingVertical: 8, // 上下更小
  marginVertical: 2,
  alignItems: 'center', // 字置中
  justifyContent: 'center', // 字置中
  minHeight: 36 // 固定高度讓圈圈小一點
}
    ]}
    disabled={layoutMode === 'reversed'}
  >
    <Text style={[
      styles.menuItem,
      {
        color: layoutMode === 'reversed' ? colors.background : colors.text,
        textAlign: 'center'
      }
    ]}>
      📚 {t('learningMode')}
    </Text>
  </TouchableOpacity>
</View>
        {/* 字體切換 */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            { key: 'small' as FontScale, label: 'A-' },
            { key: 'medium' as FontScale, label: 'A' },
            { key: 'large' as FontScale, label: 'A+' },
          ].map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              onPress={() => setFontScale(key)}  // ✅ 現在 key 是 FontScale 類型
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 20,
                borderWidth: 2,
                borderColor: colors.primary,
                backgroundColor: fontScale === key ? colors.primary : 'transparent',
              }}
            >
              <Text style={{ fontSize: 16, color: fontScale === key ? colors.background : colors.text }}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>


        {/* 主题切换 */}
        <TouchableOpacity onPress={toggleTheme} style={styles.menuItemButton}>
          <Text style={styles.menuItem}>{isDarkMode ? t('switchToLight') : t('switchToDark')}</Text>
        </TouchableOpacity>

        {/* 主题色选择 */}
        <Text style={styles.menuHeader}>{t('primaryColor')}</Text>
        <View
          style={[
            styles.colorOptionsContainer,
            { paddingHorizontal: 8, justifyContent: 'flex-start' }
          ]}
        >
          <TouchableOpacity
            onPress={() => setCustomPrimaryColor(null)}
          />
          {Object.entries(additionalColors).map(([name, color]) => (
            <TouchableOpacity
              key={name}
              style={[
                styles.colorOption,
                { backgroundColor: color },
                customPrimaryColor === color && {
                  borderWidth: 2,
                  borderColor: colors.text,
                },
              ]}
              onPress={() => setCustomPrimaryColor(color)}
            />
          ))}
        </View>

        {/* 语言选择 */}
        <Text style={styles.menuHeader}>{t('chooseLanguage')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 8 }}>
          {[
            { code: 'en', label: 'English' },
            { code: 'zh', label: '中文' },
            { code: 'ja', label: '日本語' },
          ].map(({ code, label }) => {
            const selected = lang === code;
            return (
              <TouchableOpacity
                key={code}
                onPress={() => pickLang(code as any)}
                style={{
                  paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20,
                  borderWidth: 2, borderColor: colors.primary,
                  backgroundColor: selected ? colors.primary : 'transparent',
                }}
              >
                <Text style={{ fontSize: 13, color: selected ? 'white' : colors.text }}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* reset 設定 */}
        {debugValue === '1' && (
          <>
            <Text style={[styles.menuHeader, { color: 'red', marginTop: 20 }]}>--- 開發者測試 ---</Text>

            <TouchableOpacity onPress={resetForTesting} style={[styles.menuItemButton, { borderColor: 'red' }]}>
              <Text style={[styles.menuItem, { color: 'red' }]}>🔄 重置所有資料</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => addTestCoins(100)} style={[styles.menuItemButton, { borderColor: 'orange' }]}>
              <Text style={[styles.menuItem, { color: 'orange' }]}>💰 +100 測試金幣</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => addTestCoins(-50)} style={[styles.menuItemButton, { borderColor: 'gold' }]}>
              <Text style={[styles.menuItem, { color: 'gold' }]}>💰 -50 測試金幣</Text>
            </TouchableOpacity>

            <Text style={[styles.menuItem, { fontSize: 10, color: 'gray', textAlign: 'center' }]}>
              此區塊只在 Debug 模式顯示
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}