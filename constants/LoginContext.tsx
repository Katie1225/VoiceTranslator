// LoginContext.tsx - 完整修正版本
import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debugLog, debugWarn, debugError } from '@/utils/debugLog';
import { loadSavedUser } from '../utils/googleSheetAPI';

// 定義使用者資料結構
export type GoogleUser = {
  id: string;
  email: string;
  name: string;
  photo?: string;
  coins?: number;
  gifted?: boolean;
  giftNoticeShown?: boolean;
};

// Context 型別
type LoginContextType = {
  isLoggingIn: boolean;
  setIsLoggingIn: (value: boolean) => void;
  currentUser: GoogleUser | null;
  setCurrentUser: (user: GoogleUser | null) => void;
  logout: () => Promise<void>;
};

// 建立 Context
const LoginContext = createContext<LoginContextType | undefined>(undefined);

// Provider 實作
export const LoginProvider = ({ children }: { children: React.ReactNode }) => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<GoogleUser | null>(null);

  // ✅ 啟動時自動載入上次登入的使用者和金幣
  useEffect(() => {
    const loadUser = async () => {
      try {
        await loadSavedUser(setCurrentUser);
      } catch (e) {
        debugLog('⚠️ 載入使用者失敗', e);
      }
    };
    loadUser();
  }, []);

  // ✅ 登出函式 - 修正為不刪除 coins
  const logout = async () => {
    try {
      // 只刪除 user，保留 coins
      await AsyncStorage.removeItem('user');
      setCurrentUser(null);
      debugLog('🚪 使用者已登出（保留金幣數據）');
    } catch (e) {
      debugLog('⚠️ 登出失敗', e);
    }
  };

  return (
    <LoginContext.Provider
      value={{ isLoggingIn, setIsLoggingIn, currentUser, setCurrentUser, logout }}
    >
      {children}
    </LoginContext.Provider>
  );
};

// ✅ 匯出 Hook
export const useLogin = () => {
  const context = useContext(LoginContext);
  if (!context) throw new Error('useLogin must be used within a LoginProvider');
  return context;
};