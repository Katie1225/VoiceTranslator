// constants/languages.ts
import * as Localization from 'expo-localization';

export const LANGUAGE_MAP = {
  'en': { 
    label: 'English: English', 
    value: 'en', 
    speechCode: 'en-US',
    englishName: 'English',
    flagEmoji: '🇺🇸', // 美國國旗
  },
  'ja': { 
    label: 'Japanese: 日本語', 
    value: 'ja', 
    speechCode: 'ja-JP',
    englishName: 'Japanese',
    flagEmoji: '🇯🇵', // 日本國旗
  },
  'ko': { 
    label: 'Korean: 한국어', 
    value: 'ko', 
    speechCode: 'ko-KR',
    englishName: 'Korean',
    flagEmoji: '🇰🇷', // 韓國國旗
  },
  'fr': { 
    label: 'French: Français', 
    value: 'fr', 
    speechCode: 'fr-FR',
    englishName: 'French',
    flagEmoji: '🇫🇷', // 法國國旗
  },
  'de': { 
    label: 'German: Deutsch', 
    value: 'de', 
    speechCode: 'de-DE',
    englishName: 'German',
    flagEmoji: '🇩🇪', // 德國國旗
  },
  'es': { 
    label: 'Spanish: Español', 
    value: 'es', 
    speechCode: 'es-ES',
    englishName: 'Spanish',
    flagEmoji: '🇪🇸', // 西班牙國旗
  },
  'zh-TW': { 
    label: 'Chinese: 中文（繁體）', 
    value: 'zh-TW', 
    speechCode: 'zh-TW',
    englishName: 'Chinese',
    flagEmoji: '🇹🇼', // 台灣國旗
  },
  'tl': { 
    label: 'Filipino: Filipino', 
    value: 'tl', 
    speechCode: 'tl-PH',
    englishName: 'Filipino',
    flagEmoji: '🇵🇭', // 菲律賓國旗
  },
  'th': {
  label: 'Thai: ไทย',
  value: 'th',
  speechCode: 'th-TH',
  englishName: 'Thai',
  flagEmoji: '🇹🇭', // 泰國國旗
},
  'id': { 
    label: 'Indonesian: Bahasa Indonesia', 
    value: 'id', 
    speechCode: 'id-ID',
    englishName: 'Indonesian',
    flagEmoji: '🇮🇩', // 印尼國旗
  },
  'vi': { 
    label: 'Vietnamese: Tiếng Việt', 
    value: 'vi', 
    speechCode: 'vi-VN',
    englishName: 'Vietnamese',
    flagEmoji: '🇻🇳', // 越南國旗
  },
  'hi': { 
  label: 'Hindi: हिन्दी', 
  value: 'hi', 
  speechCode: 'hi-IN',
  englishName: 'Hindi',
  flagEmoji: '🇮🇳', // 印度國旗
},'pt': { 
  label: 'Portuguese: Português', 
  value: 'pt', 
  speechCode: 'pt-PT',
  englishName: 'Portuguese',
  flagEmoji: '🇵🇹', // 葡萄牙國旗
},
} as const;

export type LanguageCode = keyof typeof LANGUAGE_MAP;



export const getDeviceLanguage = (): LanguageCode => {
  const deviceTag = Localization.getLocales()[0]?.languageTag || 'en'; // 例: "zh-TW", "en-US"

  // 1️⃣ 先用完整的 tag 找 ("zh-TW", "en", "ja"...)
  if (deviceTag in LANGUAGE_MAP) {
    return deviceTag as LanguageCode;
  }

  // 2️⃣ 再用 prefix ("zh", "en"...)
  const prefix = deviceTag.split('-')[0];

  // 特別處理中文 → zh-TW
  if (prefix === 'zh' && 'zh-TW' in LANGUAGE_MAP) {
    return 'zh-TW';
  }

  // 其他像 "en"、"ja" 直接用 prefix
  if (prefix in LANGUAGE_MAP) {
    return prefix as LanguageCode;
  }

  // 3️⃣ 全部都沒有就回傳英文
  return 'en';
};

export const getSpeechLanguage = (langCode: string): string => {
  return LANGUAGE_MAP[langCode as LanguageCode]?.speechCode || langCode;
};

export const getLanguageLabel = (langCode: string): string => {
  return LANGUAGE_MAP[langCode as LanguageCode]?.label || langCode;
};

export const getAvailableLanguages = () => {
  // 按照英文名稱排序
  return Object.values(LANGUAGE_MAP).sort((a, b) => 
    a.englishName.localeCompare(b.englishName)
  );
};