// utils/UserContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type User = {
  id: string;
  name?: string;
  coins: number;
};

// UserContext 的型別定義：包含 user 物件、更新 user 的方法、金幣增減與重新載入本地 user 資料
type UserContextType = {
  user: User | null;
  setUser: (u: User | null) => void;         // 設定 user 或清空
  updateCoins: (delta: number) => void;      // 增減金幣
  reloadUserFromStorage: () => void;         // 從 AsyncStorage 載入本地儲存的 user 資料，並更新 Context 內容
};

// 建立一個 UserContext 物件，讓全 App 可以使用 user 狀態（例如金幣、ID）
const UserContext = createContext<UserContextType>({  // React.createContext()：建立一個用來共享 user 狀態的 Context 容器
  user: null,
  setUser: () => {},
  updateCoins: () => {},
  reloadUserFromStorage: () => {},
});

// 提供 user 狀態與操作方法（setUser, updateCoins 等）給所有子元件使用
export const UserProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);

  const loadUser = async () => {
    const stored = await AsyncStorage.getItem('user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.id) setUser(parsed);
      } catch {}
    }
  };

  const updateCoins = async (delta: number) => {
    if (!user) return;
    const updated = { ...user, coins: user.coins + delta };
    setUser(updated);
    await AsyncStorage.setItem('user', JSON.stringify(updated));
  };

  return (
    <UserContext.Provider
      value={{
        user,
        setUser: (u) => {
          setUser(u);
          if (u) AsyncStorage.setItem('user', JSON.stringify(u));
          else AsyncStorage.removeItem('user');
        },
        updateCoins,
        reloadUserFromStorage: loadUser,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => useContext(UserContext);
