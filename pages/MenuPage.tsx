//pages/MenuPage.tsx

import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Image, Share, Dimensions, Alert, Linking } from 'react-native';
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
import RecorderHeader from '../components/RecorderHeader';
import { useNavigation } from '@react-navigation/native';

type GoogleUser = {
  id: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  photo?: string;
  coins?: number;
};

export default function MenuPage() {
  const { colors, styles, isDarkMode, toggleTheme, setCustomPrimaryColor, customPrimaryColor, additionalColors } = useTheme();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { locale, setAppLocale } = useLanguage();
  const { isLoggingIn, setIsLoggingIn } = useLoginContext();

  const [currentUser, setCurrentUser] = useState<GoogleUser | null>(null);
  const [lang, setLang] = useState<'zh' | 'en' | 'ja'>(locale);
  const [promptPref, setPromptPref] = useState<'ask' | 'off'>('ask');
  const [segmentPref, setSegmentPref] = useState<number>(600);

  const PREF_KEY = 'VN_TRANSCRIBE_PROMPT_PREF';
  const SEGMENT_KEY = 'VN_SEGMENT_DURATION';

  useEffect(() => {
    const loadUserData = async () => {
      const stored = await AsyncStorage.getItem('user');
      if (stored) {
        setCurrentUser(JSON.parse(stored));
      }

      const promptValue = await AsyncStorage.getItem(PREF_KEY);
      if (promptValue === 'off') setPromptPref('off'); else setPromptPref('ask');

      const segmentValue = await AsyncStorage.getItem(SEGMENT_KEY);
      const sec = segmentValue ? Number(segmentValue) : 600;
      setSegmentPref(sec);
      setSegmentDuration(sec);
    };

    loadUserData();
  }, []);

  useEffect(() => {
    setLang(locale);
  }, [locale]);

  const handleLogout = async () => {
    await GoogleSignin.signOut();
    await AsyncStorage.removeItem('user');
    setCurrentUser(null);
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
            // 重新加载用户数据
            const reloadUser = async () => {
              const stored = await AsyncStorage.getItem('user');
              if (stored) {
                setCurrentUser(JSON.parse(stored));
              }
            };
            reloadUser();
          }
        }
      ]);
    }
  };

  const pickLang = async (code: 'zh' | 'en' | 'ja') => {
    setLang(code);
    await setAppLocale(code);
  };

  const setPref = async (v: 'ask' | 'off') => {
    setPromptPref(v);
    await AsyncStorage.setItem(PREF_KEY, v);
  };

  const pickSegment = async (sec: number) => {
    setSegmentPref(sec);
    await AsyncStorage.setItem(SEGMENT_KEY, String(sec));
    setSegmentDuration(sec);
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

        {/* 转录偏好 */}
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

        {/* 分段时长 */}
        <Text style={[styles.menuHeader, { marginTop: 20 }]}>{t('segmentDuration')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 8 }}>
          {[
            { sec: 60, label: t('segment1min') },
            { sec: 300, label: t('segment5min') },
            { sec: 600, label: t('segment10min') },
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
      </ScrollView>
    </View>
  );
}