// components/HamburgerMenu.tsx
import React, { useEffect, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { lightTheme, darkTheme, additionalColors } from '../constants/Colors';

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

  useEffect(() => {
    const loadUser = async () => {
      const stored = await AsyncStorage.getItem('user');
      if (stored) {
        setCurrentUser(JSON.parse(stored));
      }
    };
    loadUser();
  }, []);
  const handleGoogleLogin = async () => {
    try {
      const result = await GoogleSignin.signIn();
      const user = (result as any)?.data?.user || {};
      
      if (!user.id || !user.email) {
        throw new Error("無法取得使用者基本資訊");
      }
  
      // 1. 先 POST 使用者資料
      const postResponse = await fetch('https://script.google.com/macros/s/AKfycbzDi_Q19Y9pz5wgOprOE8FysFCOe0AjCcDhKGoGcJtS4_hEAXaXKQ5dHTAK2OkcTm5i/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          email: user.email,
          name: user.name || user.email.split('@')[0],
        }),
      });
  
      const postResult = await postResponse.json();
      if (!postResult.success) {
        throw new Error(postResult.message || "註冊使用者失敗");
      }
  
      // 2. 再 GET 使用者資料（包含金幣）
      const getResponse = await fetch(
        `https://script.google.com/macros/s/AKfycbzDi_Q19Y9pz5wgOprOE8FysFCOe0AjCcDhKGoGcJtS4_hEAXaXKQ5dHTAK2OkcTm5i/exec?id=${user.id}`
      );
  
      const getResult = await getResponse.json();
      if (!getResult.success) {
        throw new Error(getResult.message || "取得使用者資料失敗");
      }
  
      const mergedUser = {
        ...user,
        coins: getResult.data?.coins || 0,
      };
  
      await AsyncStorage.setItem('user', JSON.stringify(mergedUser));
      setCurrentUser(mergedUser);
  
      Alert.alert(
        '登入成功',
        `你好，${mergedUser.name || mergedUser.email}\n目前金幣: ${mergedUser.coins}`
      );
    } catch (err) {
      console.error('登入錯誤:', err);
      Alert.alert(
        '登入失敗',
        err instanceof Error ? err.message : '未知錯誤'
      );
    }
  };
  
  const handleLogout = async () => {
    await GoogleSignin.signOut();
    await AsyncStorage.removeItem('user');
    setCurrentUser(null);
    Alert.alert('已登出');
  };

  if (!visible) return null;

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
              <Text style={[styles.menuItem, { fontSize: 12, color: 'gold' }]}>💰 金幣：{currentUser.coins}</Text>
            )}
          </View>
          <TouchableOpacity onPress={handleLogout}>
            <Text style={[styles.menuItem, { marginLeft: 12, fontSize: 12 }]}>登出</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={handleGoogleLogin} style={styles.menuItemButton}>
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
