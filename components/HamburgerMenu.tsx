// components/HamburgerMenu.tsx
import React, { useEffect, useState } from 'react';
import { Linking, Alert, View, Text, TouchableOpacity, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { logCoinUsage, fetchUserInfo } from '../utils/googleSheetAPI';
import { handleLogin } from '../utils/loginHelpers';
import { version } from '../constants/variant';
import { useTheme } from '../constants/ThemeContext';
import { useLoginContext } from '../constants/LoginContext';
import { useTranslation } from '../constants/i18n';
import { useLanguage } from '../constants/LanguageContext';

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
const { setAppLocale } = useLanguage();

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

      <TouchableOpacity onPress={() => { onClose(); toggleTheme(); }} style={styles.menuItemButton}>
        <Text style={styles.menuItem}>{isDarkMode ? t('switchToLight') : t('switchToDark')}</Text>
      </TouchableOpacity>

      <Text style={styles.menuHeader}>{t('primaryColor')}</Text>
      <View style={styles.colorOptionsContainer}>
        <TouchableOpacity

          onPress={() => { onClose(); setCustomPrimaryColor(null); }}
        />
        {Object.entries(additionalColors).map(([name, color]) => (
          <TouchableOpacity
            key={name}
            style={[
              styles.colorOption,
              { backgroundColor: color },
              customPrimaryColor === color && styles.selectedColor
            ]}
            onPress={() => { onClose(); setCustomPrimaryColor(color); }}
          />
        ))}
      </View>
<Text style={styles.menuHeader}>{t('chooseLanguage')}</Text>
<View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 }}>
  {[
    { label: '中文', value: 'zh' },
    { label: 'English', value: 'en' },
    { label: '日本語', value: 'ja' },
  ].map(({ label, value }) => (
    <TouchableOpacity
      key={value}
      onPress={async () => {
  await setAppLocale(value as any); // 儲存語言
        onClose();                      // 關閉選單
      }}
      style={{
        backgroundColor: colors.surface,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
        margin: 4,
      }}
    >
      <Text style={[styles.menuItem, { fontSize: 13 }]}>{label}</Text>
    </TouchableOpacity>
  ))}
</View>



    </View>

  );
};

export default HamburgerMenu;
