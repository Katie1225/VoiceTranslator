// components/HamburgerMenu.tsx
import React, { useEffect, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { lightTheme, darkTheme, additionalColors } from '../constants/Colors';
import { logCoinUsage, fetchUserInfo } from '../utils/googleSheetAPI';
import { useGoogleLogin } from '../src/hooks/useGoogleLogin';


type Props = {
  visible: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  customPrimaryColor: string | null;
  setCustomPrimaryColor: (color: string | null) => void;
  styles: any;
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
}: Props) => {
  const [currentUser, setCurrentUser] = useState<GoogleUser | null>(null);
  const { isLoggingIn, loginWithGoogle } = useGoogleLogin();

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

  if (!visible) return null;


  return (
    <View style={styles.menuContainer}>
{isLoggingIn ? (
  <View style={{
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  }}>
    <View style={{
      backgroundColor: '#222',
      padding: 24,
      borderRadius: 12,
      alignItems: 'center'
    }}>
      <Text style={{ color: 'white', fontSize: 18, marginBottom: 10 }}>🔄 登入中...</Text>
      <Text style={{ color: 'white', fontSize: 14 }}>請稍候，正在與 Google 驗證身份</Text>
    </View>
  </View>
) : currentUser ? (
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
  <TouchableOpacity onPress={loginWithGoogle} style={styles.menuItemButton}>
    <Text style={styles.menuItem}>☁️ 登入 Google 帳戶</Text>
  </TouchableOpacity>
)}


      <Text style={styles.menuItem}>版本: v1.3.2</Text>

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
