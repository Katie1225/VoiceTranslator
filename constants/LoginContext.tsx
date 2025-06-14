// constants/LoginContext.tsx
import React, { createContext, useContext, useState } from 'react';

type LoginContextType = {
  isLoggingIn: boolean;
  setIsLoggingIn: (value: boolean) => void;
};

const LoginContext = createContext<LoginContextType | undefined>(undefined);

export const LoginProvider = ({ children }: { children: React.ReactNode }) => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  return (
    <LoginContext.Provider value={{ isLoggingIn, setIsLoggingIn }}>
      {children}
    </LoginContext.Provider>
  );
};

export const useLoginContext = () => {
  const context = useContext(LoginContext);
  if (!context) {
    throw new Error('useLoginContext must be used within a LoginProvider');
  }
  return context;
};
