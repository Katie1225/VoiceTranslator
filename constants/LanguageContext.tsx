// LanguageContext.tsx
import { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';

type LanguageCode = 'en' | 'zh' | 'ja';

const LanguageContext = createContext<{
  locale: LanguageCode;
  setAppLocale: (lang: LanguageCode) => void;
}>({
  locale: 'en',
  setAppLocale: () => {},
});

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const [locale, setLocale] = useState<LanguageCode>('en');

  const setAppLocale = async (lang: LanguageCode) => {
    await AsyncStorage.setItem('appLang', lang);
    setLocale(lang);
  };

  useEffect(() => {
    const init = async () => {
      const saved = await AsyncStorage.getItem('appLang');
      
      // ✅ 新版本 API
      const deviceLocales = Localization.getLocales();
      const primaryLocale = deviceLocales[0];
      const deviceLang = primaryLocale?.languageCode || 'en';
      
      console.log('🌍 裝置語言資訊:', {
        locales: deviceLocales,
        primaryLanguage: deviceLang,
        region: primaryLocale?.regionCode
      });

      if (saved && (saved === 'en' || saved === 'zh' || saved === 'ja')) {
        setLocale(saved as LanguageCode);
      } else if (deviceLang === 'zh' || deviceLang === 'ja') {
        setLocale(deviceLang as LanguageCode);
      } else {
        setLocale('en');
      }
    };
    init();
  }, []);

  return (
    <LanguageContext.Provider value={{ locale, setAppLocale }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);