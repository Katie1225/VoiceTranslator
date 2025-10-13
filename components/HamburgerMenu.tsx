// components/HamburgerMenu.tsx
import React, { useEffect, useState } from 'react';
import { Linking, Alert, View, Text, TouchableOpacity, Image, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { logCoinUsage, fetchUserInfo } from '../utils/googleSheetAPI';
import { handleLogin } from '../utils/loginHelpers';
import { version, setSegmentDuration } from '../constants/variant';
import { useTheme } from '../constants/ThemeContext';
import { useLoginContext } from '../constants/LoginContext';
import { useTranslation } from '../constants/i18n';
import { useLanguage } from '../constants/LanguageContext';
import { debugError } from '@/utils/debugLog';

type Props = {
  visible: boolean;
  onClose: () => void;
  onLoginPress: () => Promise<boolean>;
  onLoginSuccess?: () => void;
};

type GoogleUser = {
  id: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  photo?: string;
  coins?: number;
};

const HamburgerMenu = ({ visible, onClose, onLoginPress, onLoginSuccess }: Props) => {
  const { colors, styles, isDarkMode, toggleTheme, setCustomPrimaryColor, customPrimaryColor, additionalColors } = useTheme();
  const [currentUser, setCurrentUser] = useState<GoogleUser | null>(null);
  useEffect(() => {
    const loadUser = async () => {
      const stored = await AsyncStorage.getItem('user');
      if (stored) {
        setCurrentUser(JSON.parse(stored));
      }
    };
    loadUser();
  }, [visible]);
  const { isLoggingIn, setIsLoggingIn } = useLoginContext();

  const { t } = useTranslation();
const { locale, setAppLocale } = useLanguage();

  const handleLogout = async () => {
    await GoogleSignin.signOut();
    await AsyncStorage.removeItem('user');
    setCurrentUser(null);
    //  Alert.alert('已登出');
  };
  const handleLoginWithAutoClose = async () => {
    setIsLoggingIn(true);
    const result = await handleLogin(setIsLoggingIn, t);
    setIsLoggingIn(false);

    if (result) {
      Alert.alert(`✅ ${t('loginSuccess')}`, result.message, [
        {
          text: t('continue'),
          onPress: () => {
            if (onLoginSuccess) onLoginSuccess();
          }
        }
      ]);
    }
  };

const [lang, setLang] = useState<'zh' | 'en' | 'ja'>(locale);  // 用 context 的 locale 當初值
useEffect(() => {
  setLang(locale); // 每次打開選單或 locale 改變時，同步顯示
}, [visible, locale]);


const pickLang = async (code: 'zh' | 'en' | 'ja') => {
  setLang(code);
  await setAppLocale(code); // 由 context 寫入 appLang
  onClose();
};


  const PREF_KEY = 'VN_TRANSCRIBE_PROMPT_PREF'; // 'ask' | 'off'
  const [promptPref, setPromptPref] = useState<'ask' | 'off'>('ask');

  useEffect(() => {
    AsyncStorage.getItem(PREF_KEY).then(v => {
      if (v === 'off') setPromptPref('off'); else setPromptPref('ask');
    });
  }, [visible]);

  const setPref = async (v: 'ask' | 'off') => {
    setPromptPref(v);
    await AsyncStorage.setItem(PREF_KEY, v);
    onClose(); // 選完就關閉選單（可移除）
  };

const [segmentPref, setSegmentPref] = useState<number>(600); // 預設 10 分鐘
const SEGMENT_KEY = 'VN_SEGMENT_DURATION';

useEffect(() => {
  AsyncStorage.getItem(SEGMENT_KEY).then(v => {
    const sec = v ? Number(v) : 600;
    setSegmentPref(sec);
    setSegmentDuration(sec); // ← 這行很關鍵：讓全域 SEGMENT_DURATION 一起恢復
  });
}, [visible]);

const pickSegment = async (sec: number) => {
  setSegmentPref(sec);
  await AsyncStorage.setItem(SEGMENT_KEY, String(sec));
  setSegmentDuration(sec);   // 更新全域常數
  onClose();
};

  if (!visible) return null;

  return (
    <View style={{
      position: 'absolute',
      top: 55,
      left: 10, // 👈 調整這裡可以讓選單「往左移」
      right: 20,
      backgroundColor: colors.container,
      borderRadius: 12,
      padding: 12,
      zIndex: 9999,
      elevation: 10,
    }}>

      {currentUser ? (
        <View style={[styles.menuItemButton, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
          <View style={{ flexDirection: 'column' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {currentUser.photo && (
                <Image source={{ uri: currentUser.photo }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 8 }} />
              )}
              <Text style={styles.menuItem}>{currentUser.name || currentUser.email}</Text>
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
        <TouchableOpacity onPress={handleLoginWithAutoClose} style={styles.menuItemButton}>
          <Text style={styles.menuItem}>☁️ {t('googleLogin')}</Text>
        </TouchableOpacity>

      )}

      <Text style={styles.menuItem}>{t('version')}: {version} </Text>

      <TouchableOpacity
        onPress={() => {
          Linking.openURL('mailto:katie@example.com?subject=User Feedback');
        }}
        style={styles.menuItemButton}
      >
        <Text style={styles.menuItem}>✉️ {t('contactKai')}</Text>
      </TouchableOpacity>
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


      <TouchableOpacity onPress={() => { onClose(); toggleTheme(); }} style={styles.menuItemButton}>
        <Text style={styles.menuItem}>{isDarkMode ? t('switchToLight') : t('switchToDark')}</Text>
      </TouchableOpacity>

      <Text style={styles.menuHeader}>{t('primaryColor')}</Text>
      <View
        style={[
          styles.colorOptionsContainer,
          { paddingHorizontal: 8, justifyContent: 'flex-start' }
        ]}
      >
        <TouchableOpacity
          onPress={() => { onClose(); setCustomPrimaryColor(null); }}
        />
{Object.entries(additionalColors).map(([name, color]) => (
  <TouchableOpacity
    key={name}
    style={[
      styles.colorOption,
      { backgroundColor: color },
      customPrimaryColor === color && {
        borderWidth: 2,
        borderColor: colors.text,   // 或 colors.primary，看你要哪一種
      },
    ]}
    onPress={() => { onClose(); setCustomPrimaryColor(color); }}
  />
))}

      </View>
      <Text style={styles.menuHeader}>{t('chooseLanguage')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 8 }}>
        {[
          { code: 'zh', label: '中文' },
          { code: 'en', label: 'English' },
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
      <Text style={[styles.menuHeader, { marginTop: 20 }]}>{t('transcribePrefTitle')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 8 }}>
        {[
          { key: 'ask', label: t('transcribePrefAsk') },
          { key: 'off', label: t('transcribePrefDontAsk') },
        ].map(({ key, label }) => {
          const selected = promptPref === (key as any);
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setPref(key as 'ask' | 'off')}
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
<Text style={[styles.menuHeader, { marginTop: 20 }]}>{t('segmentDuration')}</Text>
<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 8 }}>
  {[
    { sec: 60,   label: t('segment1min')  }, // 1 分鐘
    { sec: 300,  label: t('segment5min')  }, // 5 分鐘
    { sec: 600,  label: t('segment10min') }, // 10 分鐘
    // 用超大數代表「不切斷」，讓「item.durationSec > SEGMENT_DURATION」幾乎永遠不成立 → 不顯示展開分段按鈕
    { sec: 999999, label: t('segmentNoSplit') },
  ].map(({ sec, label }) => {
    const selected = segmentPref === sec;
    return (
      <TouchableOpacity
        key={sec}
        onPress={() => pickSegment(sec)}
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
    </View>
  );
};

export default HamburgerMenu;
