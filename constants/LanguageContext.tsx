// LanguageContext.tsx
import { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { debugLog } from '@/utils/debugLog';

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
    debugLog(`🌍 手動設定語言: ${lang}`);
  };

  useEffect(() => {
    const init = async () => {
      const saved = await AsyncStorage.getItem('appLang');
      
      // ✅ 新版本 API
      const deviceLocales = Localization.getLocales();
      const primaryLocale = deviceLocales[0];
      const deviceLang = primaryLocale?.languageCode || 'en';
      
      debugLog('🌍 裝置語言偵測詳細資訊:', {
        savedLanguage: saved,
        deviceLocales: deviceLocales.map(l => ({
          languageCode: l.languageCode,
          languageTag: l.languageTag,
          regionCode: l.regionCode
        })),
        primaryLanguage: deviceLang,
        finalLanguage: saved || deviceLang
      });

      if (saved && (saved === 'en' || saved === 'zh' || saved === 'ja')) {
        setLocale(saved as LanguageCode);
        debugLog(`🌍 使用儲存的語言: ${saved}`);
      } else if (deviceLang === 'zh' || deviceLang === 'ja') {
        setLocale(deviceLang as LanguageCode);
        debugLog(`🌍 使用裝置語言: ${deviceLang}`);
      } else {
        setLocale('en');
        debugLog('🌍 使用預設語言: en');
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