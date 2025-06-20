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

  const handleLogout = async () => {
    await GoogleSignin.signOut();
    await AsyncStorage.removeItem('user');
    setCurrentUser(null);
    //  Alert.alert('已登出');
  };
  const handleLoginWithAutoClose = async () => {
    setIsLoggingIn(true);
    const result = await handleLogin(setIsLoggingIn);
    setIsLoggingIn(false);

    if (result) {
      Alert.alert('✅ 登入成功', result.message, [
        {
          text: '繼續',
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
              <Text style={[styles.menuItem, { fontSize: 12, color: 'gold' }]}>💰 金幣：{currentUser.coins}</Text>
            )}
          </View>
          <TouchableOpacity onPress={handleLogout}>
            <Text style={[styles.menuItem, { marginLeft: 12, fontSize: 12 }]}>登出</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={handleLoginWithAutoClose} style={styles.menuItemButton}>
          <Text style={styles.menuItem}>☁️ 登入 Google 帳戶</Text>
        </TouchableOpacity>

      )}

      <Text style={styles.menuItem}>版本: {version} </Text>

      <TouchableOpacity
        onPress={() => {
          Linking.openURL('mailto:katie@example.com?subject=使用者回饋');
        }}
        style={styles.menuItemButton}
      >
        <Text style={styles.menuItem}>✉️ 聯繫凱凱</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => { onClose(); toggleTheme(); }} style={styles.menuItemButton}>
        <Text style={styles.menuItem}>{isDarkMode ? '切換淺色模式' : '切換深色模式'}</Text>
      </TouchableOpacity>

      <Text style={styles.menuHeader}>主題顏色</Text>
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

    </View>

  );
};

export default HamburgerMenu;
