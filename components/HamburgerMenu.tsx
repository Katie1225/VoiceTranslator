// components/HamburgerMenu.tsx
import React from 'react';
import { Alert, View, Text, TouchableOpacity } from 'react-native';
import { lightTheme, darkTheme, additionalColors } from '../constants/Colors';
import { GoogleSignin, statusCodes, User, SignInSuccessResponse } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage'; // 如未引入請加上

type Props = {
  visible: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  customPrimaryColor: string | null;
  setCustomPrimaryColor: (color: string | null) => void;
  styles: any;
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
  if (!visible) return null;

  /*
  const handleGoogleLogin = async () => {
    try {
      console.log('📌 開始登入，webClientId=', '732781312395-blhdm11hejnib8c2k9orf7drjcorp1pp.apps.googleusercontent.com');
    
      console.log('📌 檢查 Google Play Services...');
      const hasServices = await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      console.log('✅ Play Services 可用:', hasServices);
  
      console.log('📌 執行 signIn()...');
      const result = await GoogleSignin.signIn();
      console.log('✅ 登入成功 result:', JSON.stringify(result, null, 2));
  
      const user = (result as any).user;
      console.log('🧑 使用者名稱:', user?.name);
      console.log('📧 Email:', user?.email);
      console.log('🆔 ID:', user?.id);
  
      Alert.alert('登入成功', `你好，${user?.name || user?.email}`);
    } catch (err) {
      console.error('❌ 登入錯誤:', JSON.stringify(err, null, 2));
      Alert.alert('登入失敗', '請查看 log');
    }
  };
  */
  type GoogleUser = {
    id: string;
    name?: string;
    givenName?: string;
    familyName?: string;
    email?: string;
    photo?: string;
  };
  
  const handleGoogleLogin = async () => {
    try {
      console.log('📌 開始登入，webClientId = 732781312395-blhdm11hejnib8c2k9orf7drjcorp1pp.apps.googleusercontent.com');
   
      console.log('📌 檢查 Google Play Services...');
      const hasServices = await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      console.log('✅ Play Services 可用:', hasServices);
  
      console.log('📌 執行 signIn()...');
      const result = await GoogleSignin.signIn();
      console.log('✅ 登入成功 result:', JSON.stringify(result, null, 2));
  
      // ✅ 明確告訴 TypeScript user 的型別
      const user: GoogleUser = (result as any)?.data?.user || {};
  
      console.log('🧑 使用者名稱:', user.name);
      console.log('📧 Email:', user.email);
      console.log('🆔 ID:', user.id);
  
      // ✅ 儲存到 AsyncStorage（你可以改成 setUser() 存到 state）
      await AsyncStorage.setItem('user', JSON.stringify(user));
  
      Alert.alert('登入成功', `你好，${user.name || user.email || '未知使用者'}`);
    } catch (err) {
      console.error('❌ 登入錯誤:', JSON.stringify(err, null, 2));
      Alert.alert('登入失敗', '請查看 log');
    }
  };

  return (
    <View style={styles.menuContainer}>
<TouchableOpacity onPress={handleGoogleLogin} style={styles.menuItemButton}>
  <Text style={styles.menuItem}>☁️ 登入 Google 帳戶</Text>
</TouchableOpacity>

      <Text style={styles.menuItem}>版本: v1.3.2</Text>

      <TouchableOpacity
        onPress={() => { onClose();   toggleTheme(); }}
        style={styles.menuItemButton}
      >
        <Text style={styles.menuItem}>
          {isDarkMode ? '切換淺色模式' : '切換深色模式'}
        </Text>
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
            onPress={() => { onClose();   setCustomPrimaryColor(color); ; }}
          />
        ))}
      </View>
    </View>
  );
};

export default HamburgerMenu;
