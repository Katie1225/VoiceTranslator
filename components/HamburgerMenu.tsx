// components/HamburgerMenu.tsx
import React, { useEffect, useState } from 'react';
import { Linking, Alert, View, Text, TouchableOpacity, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { lightTheme, darkTheme, additionalColors } from '../constants/Colors';
import { logCoinUsage, fetchUserInfo, getCachedUser } from '../utils/googleSheetAPI';
import { handleLogin } from '../utils/loginHelpers';
import { version } from '../constants/variant';
import Constants from 'expo-constants';

const appVersion = Constants.expoConfig?.version || 'unknown';

type Props = {
  visible: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  customPrimaryColor: string | null;
  setCustomPrimaryColor: (color: string | null) => void;
  styles: any;
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

const HamburgerMenu = ({
  visible,
  onClose,
  isDarkMode,
  toggleTheme,
  customPrimaryColor,
  setCustomPrimaryColor,
  styles,
  onLoginPress,
  onLoginSuccess
}: Props) => {
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

  const handleLogout = async () => {
    await GoogleSignin.signOut();
    await AsyncStorage.removeItem('user');
    setCurrentUser(null);
    Alert.alert('已登出');
  };
  const handleLoginWithAutoClose = async () => {
    const result = await onLoginPress(); // loginPress 必須 return true/false
    if (result && onLoginSuccess) {
      onLoginSuccess(); // 登入成功後執行關閉選單
    }
  };

  if (!visible) return null;
  const coins = getCachedUser()?.coins ?? 0;

  return (
    <View style={styles.menuContainer}>

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
              <Text style={[styles.menuItem, { fontSize: 12, color: 'gold' }]}>💰 金幣：{coins}</Text>
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

     {/* <Text style={styles.menuItem}>版本: {appVersion}</Text>*/}


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
          style={[
            styles.colorOption,
            { backgroundColor: isDarkMode ? darkTheme.primary : lightTheme.primary },
            !customPrimaryColor && styles.selectedColor
          ]}
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
