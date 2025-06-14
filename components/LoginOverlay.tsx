// components/LoginOverlay.tsx
import React from 'react';
import { View, Text } from 'react-native';
import { useLoginContext } from '../constants/LoginContext';
import { useTheme } from '../constants/ThemeContext';

export default function LoginOverlay() {
  const { isLoggingIn } = useLoginContext();
  const { colors } = useTheme();

  if (!isLoggingIn) return null;

  return (
    <View style={{
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 9999,
      elevation: 9999,
    }}>
      <View style={{
        backgroundColor: colors.background,
        padding: 24,
        borderRadius: 12,
        alignItems: 'center'
      }}>
        <Text style={{ color: colors.text, fontSize: 18, marginBottom: 10 }}>🔄 登入中...</Text>
        <Text style={{ color: colors.text, fontSize: 14 }}>請稍候，正在與 Google 驗證身份</Text>
      </View>
    </View>
  );
}
