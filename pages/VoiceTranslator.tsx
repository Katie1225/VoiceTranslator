import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import * as Localization from 'expo-localization';
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';

import { debugLog, debugWarn, debugError } from '@/utils/debugLog';
import { useTranslation } from '../constants/i18n';
import { useNavigation } from '@react-navigation/native';
import TopUpModal from '../components/TopUpModal';
import RecorderHeader from '../components/RecorderHeader';
import { useTheme } from '../constants/ThemeContext';
import { translateText } from '../utils/translateHelper';
import { LANGUAGE_MAP, LanguageCode, getDeviceLanguage, getSpeechLanguage } from '../constants/languages';
import { useLogin } from '../constants/LoginContext';
import { getInitialFreeCoins, productToCoins } from '@/constants/variant';
import { purchaseManager, waitForTopUp } from '@/utils/iap';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Keyboard, Dimensions } from 'react-native';
import { RootStackParamList } from '@/App';

export default function VoiceTranslator() {
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<
    {
      id: string;
      text: string;
      role: 'original' | 'translation';
      position: 'upper' | 'lower';
      detectedLang: string;
    }[]
  >([]);

  const [targetLang, setTargetLang] = useState('en');
  const [sourceLang, setSourceLang] = useState<string>(getDeviceLanguage());
  const [autoPlay, setAutoPlay] = useState(true);
  const [selectedMsg, setSelectedMsg] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<'default' | 'reversed'>('default');
  const [isLanguageSwapped, setIsLanguageSwapped] = useState(false);
  const didInitialScroll = useRef(false);

  const [reverseNextPair, setReverseNextPair] = useState(false);
  // 交換語言時也考慮佈局模式
  const [isRotating, setIsRotating] = useState(false);
  const { t } = useTranslation();
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [showTopUp, setShowTopUp] = useState(false);
  const [coins, setCoins] = useState(0);
  const [inputPosition, setInputPosition] = useState<'bottom' | 'top'>('bottom');
  const [isUpsideDown, setIsUpsideDown] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<Speech.Voice[]>([]);
  const voiceCache = useRef<Map<string, string>>(new Map()); // 語言代碼 -> 語音ID 的快取
  const isScrolling = useRef(false);

  // 同步滾動函數
  const syncScroll = (source: 'upper' | 'lower', event: any) => {
    if (isScrolling.current) return;

    isScrolling.current = true;

    const offsetY = event.nativeEvent.contentOffset.y;
    const contentHeight = event.nativeEvent.contentSize.height;
    const layoutHeight = event.nativeEvent.layoutMeasurement.height;

    // 計算滾動比例

    if (source === 'upper') {
      lowerScrollRef.current?.scrollTo({ y: offsetY, animated: false });
    } else {
      upperScrollRef.current?.scrollTo({ y: offsetY, animated: false });
    }

    setTimeout(() => {
      isScrolling.current = false;
    }, 16);
  };

  // 從 LoginContext 獲取用戶狀態
  const { currentUser, setCurrentUser } = useLogin();

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  // 添加键盘监听器
  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (e) => {
      setIsKeyboardVisible(true);
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setIsKeyboardVisible(false);
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

useFocusEffect(
  useCallback(() => {
    const state = navigation.getState?.();
    if (!state) return;

    const currentRoute = state.routes[state.index];
    const params = currentRoute?.params as any;

    if (params?.setLayoutMode) {
      const nextMode = params.setLayoutMode;
      debugLog("🔄 接收到佈局模式:", nextMode);

      // 直接設定佈局模式
      setLayoutMode(nextMode);

      // 重置所有旋轉相關狀態
      setIsUpsideDown(false);
      setReverseNextPair(false);
      setInputPosition('bottom');

      // 確保螢幕方向為正向
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);

      // 清除參數
      navigation.setParams({ setLayoutMode: undefined } as any);

      // 顯示提示
      setTimeout(() => {
        Alert.alert(
          '佈局模式已切換',
          `當前模式: ${nextMode === 'default' ? '對話模式' : '學習模式'}`,
          [{ text: '確定' }]
        );
      }, 100);
    }
  }, [navigation])
);

  // 只在這個頁面畫面會旋轉
  useEffect(() => {
    // ⭐ 進入頁面就維持豎向，禁止自動旋轉
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);

    return () => {
      // ⭐ 離開頁面也保持豎向
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  useEffect(() => {
    if (!didInitialScroll.current && messages.length > 0) {
      didInitialScroll.current = true;

      // 第 1 次：畫面 render 完後捲
      requestAnimationFrame(() => {
        scrollToBottom();
        // 第 2 次：layout 完成後再捲一次（最關鍵）
        setTimeout(scrollToBottom, 50);
      });
    }
  }, [messages]);

  useEffect(() => {
    if (didInitialScroll.current) {
      setTimeout(scrollToBottom, 30);  // 快速捲到底即可
    }
  }, [messages]);
  // ⭐ 進入頁面時讀取 targetLang
useFocusEffect(
  useCallback(() => {
    const loadTargetLang = async () => {
      try {
        const saved = await AsyncStorage.getItem('targetLang');
        if (saved) {
          debugLog("🎯 回到 VoiceTranslator，自動更新 targetLang:", saved);
          setTargetLang(saved);
        }
      } catch (e) {
        debugWarn("讀取 targetLang 失敗:", e);
      }
    };
    loadTargetLang();
  }, [])
);



  // 載入金幣 - 改進為實時監聽
  useEffect(() => {
    const loadCoins = async () => {
      try {
        const coinsStr = await AsyncStorage.getItem('coins');
        const coinsAmount = coinsStr ? parseInt(coinsStr, 10) : getInitialFreeCoins();
        setCoins(coinsAmount);
        debugLog('💰 VoiceTranslator 載入金幣:', coinsAmount);
      } catch (error) {
        debugError('載入金幣失敗:', error);
      }
    };

    loadCoins();
  }, []);

  // ⭐ 保存所有交換相關狀態到 AsyncStorage
  const saveSwapState = async () => {
    try {
      const swapState = {
        isLanguageSwapped,
        isUpsideDown,
        reverseNextPair,
        layoutMode,
        sourceLang,
        targetLang,
        inputPosition
      };
      await AsyncStorage.setItem('vt_swap_state', JSON.stringify(swapState));
      debugLog('💾 保存交換狀態:', swapState);
    } catch (e) {
      debugWarn('保存交換狀態失敗', e);
    }
  };

  // ⭐ 恢復所有交換相關狀態
const restoreSwapState = async () => {
  try {
    const saved = await AsyncStorage.getItem('vt_swap_state');
    if (saved) {
      const swapState = JSON.parse(saved);
      
      // 檢查是否有正在進行的佈局更改
      const state = navigation.getState?.();
      const params = state?.routes[state.index]?.params as any;
      
      // 如果沒有佈局更改指令，才恢復狀態
      if (!params?.setLayoutMode) {
        setIsLanguageSwapped(swapState.isLanguageSwapped || false);
        setIsUpsideDown(swapState.isUpsideDown || false);
        setReverseNextPair(swapState.reverseNextPair || false);
        setLayoutMode(swapState.layoutMode || 'default');
        setSourceLang(swapState.sourceLang || getDeviceLanguage());
      //  setTargetLang(swapState.targetLang || 'en');
        setInputPosition(swapState.inputPosition || 'bottom');

        debugLog('💾 恢復交換狀態:', swapState);
      } else {
        debugLog('⏩ 跳過狀態恢復，有佈局更改正在進行');
      }
    }
  } catch (e) {
    debugWarn('恢復交換狀態失敗', e);
  }
};

  // ⭐ 在組件掛載時恢復狀態
  useEffect(() => {
    const restoreState = async () => {
      try {
        const savedMessages = await AsyncStorage.getItem('vt_messages');
        const savedText = await AsyncStorage.getItem('vt_text');

        // 恢復交換狀態
        await restoreSwapState();

        if (savedMessages) {
          setMessages(JSON.parse(savedMessages));
        }
        if (savedText) {
          setText(savedText);
        }
      } catch (e) {
        debugWarn('恢復翻譯內容失敗', e);
      }
    };
    restoreState();
    initializeVoices();
  }, []);

  // ⭐ 當相關狀態改變時自動保存
useEffect(() => {
  debugLog(`📱 layoutMode 變化: ${layoutMode}`);
  saveSwapState();
}, [layoutMode]);

  const upperScrollRef = useRef<ScrollView>(null);
  const lowerScrollRef = useRef<ScrollView>(null);

  // 修改自動接續翻譯的 useEffect
  useEffect(() => {
    const params = (navigation as any)?.getState?.()?.routes?.slice(-1)[0]?.params;
    if (params?.autoTranslate) {
      const pendingText = params.autoTranslate;
      debugLog('🔁 自動接續翻譯:', pendingText);

      // 先把文字放進輸入框
      setText(pendingText);

      // 檢查是否需要自動顯示充值畫面
      const checkAndProceed = async () => {
        try {
          const coinsStr = await AsyncStorage.getItem('coins');
          const currentCoins = coinsStr ? parseInt(coinsStr, 10) : getInitialFreeCoins();
          const textLength = pendingText.length;

          if (currentCoins < textLength && currentUser) {
            // ✅ 登入後金幣仍然不足，自動彈出充值畫面
            debugLog('💰 登入後金幣仍然不足，自動顯示充值畫面');
            setShowTopUp(true);
          } else if (currentCoins >= textLength) {
            // ✅ 金幣足夠，自動翻譯
            setTimeout(() => {
              handleSubmit();
            }, 800);
          }
          // 如果未登入且金幣不足，什麼都不做，等待用戶操作
        } catch (error) {
          debugError('檢查金幣失敗:', error);
        }
      };
      checkAndProceed();
    }
  }, []);

  // 🗑 清除所有訊息
  const handleClear = () => {
    setMessages([]);
    AsyncStorage.removeItem('vt_messages').catch((e) => {
      debugWarn('清除翻譯紀錄失敗', e);
    });
  };

  // ⭐ 輸入框變動時，同步存到 AsyncStorage
  const handleTextChange = (value: string) => {
    setText(value);
    AsyncStorage.setItem('vt_text', value).catch((e) => {
      debugWarn('儲存輸入文字失敗', e);
    });
  };

  // 🔄 切換佈局模式
  const handleToggleLayout = async () => {
    debugLog('🔄 開始切換佈局模式 ======================');
    debugLog(`切換前 layoutMode: ${layoutMode}`);

    const nextMode = layoutMode === 'default' ? 'reversed' : 'default';

    debugLog(`切換後 layoutMode: ${nextMode}`);

    // ⭐ 重置所有旋轉相關狀態
    setIsUpsideDown(false);
    setReverseNextPair(false);
    setInputPosition('bottom');

    // ⭐ 確保螢幕方向為正向
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);

    // ⭐ 更新佈局模式
    setLayoutMode(nextMode);

    debugLog('🔄 佈局模式切換完成 ======================');

    // ⭐ 顯示當前模式提示
    Alert.alert(
      '佈局模式已切換',
      `當前模式: ${nextMode === 'default' ? '上下分割' : '成對顯示'}`,
      [{ text: '確定' }]
    );
  };

  const initializeVoices = async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 400));
      debugLog('🗣 開始載入語音列表...');
      const voices = await Speech.getAvailableVoicesAsync();
      setAvailableVoices(voices);
      debugLog(`🗣 語音列表載入完成，共 ${voices.length} 個語音`);

      // 🔥 直接從 LANGUAGE_MAP 取得所有語言，不用手動維護
      const allLanguageCodes = Object.keys(LANGUAGE_MAP);

      debugLog(`🗣 開始預快取 ${allLanguageCodes.length} 種語言的語音...`);

      allLanguageCodes.forEach(langCode => {
        const speechLang = getSpeechLanguage(langCode);
        const voice = voices.find(v =>
          v.language.startsWith(speechLang) && v.quality === 'Enhanced'
        ) || voices.find(v => v.language.startsWith(speechLang));

        if (voice) {
          voiceCache.current.set(langCode, voice.identifier);
          debugLog(`🗣 預快取語音: ${langCode} -> ${voice.identifier}`);
        } else {
          debugWarn(`🗣 未找到對應語音: ${langCode} (${speechLang})`);
        }
      });
      debugLog(`🗣 語音預快取完成，共快取 ${voiceCache.current.size} 種語言`);
    } catch (error) {
      debugError('載入語音列表失敗:', error);
    }
  };

  const handleSwapLanguages = async () => {
    debugLog('🔄 開始語言交換 (複雜模式) ======================');
    debugLog(`交換前: ${sourceLang} -> ${targetLang}`);

    setIsRotating(true);
    setIsLanguageSwapped(prev => !prev);

    const newSourceLang = targetLang;
    const newTargetLang = sourceLang;

    // ⭐ 在語言交換後立即檢查
    await checkKeyboardForSwap(newSourceLang);

    setIsUpsideDown(prev => !prev);
    setReverseNextPair(prev => !prev);

    debugLog(`交換後: ${newSourceLang} -> ${newTargetLang}`);
    debugLog(`isUpsideDown: ${!isUpsideDown} -> ${isUpsideDown}`);
    debugLog(`reverseNextPair: ${!reverseNextPair} -> ${reverseNextPair}`);
    debugLog(`inputPosition: ${inputPosition} -> ${inputPosition === 'bottom' ? 'top' : 'bottom'}`);

    if (!reverseNextPair) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_DOWN);
    } else {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    }

    setSourceLang(newSourceLang);
    setTargetLang(newTargetLang);
    setInputPosition(inputPosition === 'bottom' ? 'top' : 'bottom');

    setTimeout(() => {
      setIsRotating(false);
      debugLog('🔄 語言交換完成 ======================\n');
    }, 500);
  };

  const handleSwapLanguagesSimple = () => {
    debugLog('🔄 開始語言交換 (簡單模式) ======================');
    debugLog(`交換前: ${sourceLang} -> ${targetLang}`);

    setIsLanguageSwapped(prev => !prev);
    setSourceLang(targetLang);
    setTargetLang(sourceLang);

    debugLog(`交換後: ${targetLang} -> ${sourceLang}`);
    debugLog('🔄 語言交換完成 (簡單模式) ======================\n');
  };

  // 🗣 朗讀函式 - 根據目標語言自動選擇語音
  const speakText = async (msg: string, languageCode: string) => {
    if (!msg.trim()) return;

    setSelectedMsg(msg);

    try {
      // 🚀 直接從快取取得語音ID，超快！
      const cachedVoiceId = voiceCache.current.get(languageCode);

      if (cachedVoiceId) {
        debugLog(`🗣 使用快取語音: ${languageCode}`);
        Speech.speak(msg, {
          voice: cachedVoiceId,
          pitch: 1.0,
          rate: 1.0,
          onDone: () => setSelectedMsg(null),
          onError: () => setSelectedMsg(null),
        });
        return;
      }

      // 備用方案：如果快取沒有（理論上不會發生，因為我們預快取了所有語言）
      debugLog(`🗣 快取未命中，使用系統預設: ${languageCode}`);
      const speechLanguage = getSpeechLanguage(languageCode);
      Speech.speak(msg, {
        language: speechLanguage,
        pitch: 1.0,
        rate: 1.0,
        onDone: () => setSelectedMsg(null),
        onError: () => setSelectedMsg(null),
      });

    } catch (error) {
      debugError('語音播放錯誤:', error);
      setSelectedMsg(null);
    }
  };

  // ⭐ 更新 messages 同時寫進 AsyncStorage
  const updateMessages = (builder: (prev: typeof messages) => typeof messages) => {
    setMessages(prev => {
      const updated = builder(prev);
      AsyncStorage.setItem('vt_messages', JSON.stringify(updated)).catch((e) => {
        debugWarn('儲存翻譯紀錄失敗', e);
      });
      return updated;
    });
  };

  // 處理翻譯 - 金幣不足時直接彈出充值或登入
  const handleSubmit = async () => {
    if (!text.trim()) {
      return;
    }

    const original = text.trim();
    const textLength = original.length;

    // 🎯 新增：翻譯前詳細 log
    debugLog('🔤 翻譯開始 ======================');
    debugLog(`📝 原文: "${original}"`);
    debugLog(`🌍 來源語言: "${sourceLang}" `);
    debugLog(`🎯 目標語言: "${targetLang} "`);
    debugLog(`🔄 交換狀態: ${isLanguageSwapped ? '已交換' : '未交換'}`);
    debugLog(`📱 佈局模式: ${layoutMode}`);
    debugLog(`🔄 reverseNextPair: ${reverseNextPair}`);
    debugLog(`📐 inputPosition: ${inputPosition}`);
    debugLog(`💰 需要金幣: ${textLength}, 目前金幣: ${coins}`);

    try {
      // 先檢查金幣是否足夠
      const coinsStr = await AsyncStorage.getItem('coins');
      const currentCoins = coinsStr ? parseInt(coinsStr, 10) : getInitialFreeCoins();

      if (currentCoins < textLength) {
        // 金幣不足的情況
        debugLog('❌ 金幣不足，中斷翻譯');
        if (currentUser) {
          debugLog('💰 金幣不足，顯示充值畫面');
          setShowTopUp(true);
          await AsyncStorage.setItem('pendingTranslation', original);
        } else {
          debugLog('🔐 未登入，自動跳轉登入');
          await AsyncStorage.setItem('pendingTranslation', original);
          navigation.navigate('MenuPage' as never);
          await AsyncStorage.setItem('autoLoginRequired', 'true');
        }
        return;
      }

      // 金幣足夠，進行翻譯
      debugLog('🟡 開始呼叫翻譯 API...');

      // 先清空輸入框
      setText('');

      // 呼叫翻譯 API
      const translated = await translateText(original, targetLang);

      const newId = Date.now().toString();

      // 🎯 新增：翻譯結果 log
      debugLog('✅ 翻譯完成 ======================');
      debugLog(`📝 原文: "${original}"`);
      debugLog(`🌍 翻譯: "${translated}"`);
      debugLog(`🆔 訊息ID: ${newId}`);
      debugLog(`🔄 使用reverseNextPair: ${reverseNextPair}`);

      if (reverseNextPair) {
        debugLog('📋 新增訊息順序: 翻譯在下，原文在上');
        updateMessages(prev => [
          ...prev,
          { id: newId, text: translated, role: 'translation', position: 'lower', detectedLang: targetLang },
          { id: newId, text: original, role: 'original', position: 'upper', detectedLang: sourceLang },
        ]);
      } else {
        debugLog('📋 新增訊息順序: 原文在下，翻譯在上');
        updateMessages(prev => [
          ...prev,
          { id: newId, text: original, role: 'original', position: 'lower', detectedLang: sourceLang },
          { id: newId, text: translated, role: 'translation', position: 'upper', detectedLang: targetLang },
        ]);
      }

      // 檢查翻譯結果
      if (typeof translated === 'string' && translated !== '(Translation failed)' && translated !== '(Network error)') {
        // 翻譯成功
        const updatedCoinsStr = await AsyncStorage.getItem('coins');
        const updatedCoins = updatedCoinsStr ? parseInt(updatedCoinsStr, 10) : currentCoins - textLength;
        setCoins(updatedCoins);

        debugLog(`💰 翻譯成功！扣除 ${textLength} 金幣，剩餘 ${updatedCoins} 金幣`);

        // 自動播放語音
        if (autoPlay) {
          debugLog(`🔊 自動播放語音，語言: ${targetLang}`);
          speakText(translated, targetLang);
        }
      } else {
        // 翻譯失敗
        debugLog('❌ 翻譯失敗:', translated);
        let errorMessage = t('translationFailed');

        if (translated === '(Network error)') {
          errorMessage = t('networkError');
        } else if (translated === '(Translation failed)') {
          errorMessage = t('translationFailed');
        } else if (translated?.error) {
          errorMessage = t('translationError', { error: translated.error });
        }
        Alert.alert(t('translationFailedTitle'), errorMessage);
      }
    } catch (error) {
      debugError('❌ 翻譯過程發生錯誤:', error);
      Alert.alert(
        t('systemError'),
        t('translationProcessError'),
        [{ text: t('confirm') }]
      );
      setText('');
    }

    debugLog('🔤 翻譯結束 ======================\n');
  };

  // 處理充值成功 - 自動完成未完成的翻譯
  const handleTopUpSuccess = async (coinsAdded: number) => {
    try {
      // 重新載入金幣確保準確
      const coinsStr = await AsyncStorage.getItem('coins');
      const currentCoins = coinsStr ? parseInt(coinsStr, 10) : 0;
      setCoins(currentCoins);

      // 更新用戶狀態
      if (currentUser) {
        const updatedUser = { ...currentUser, coins: currentCoins };
        setCurrentUser(updatedUser);
      }

      setShowTopUp(false);
      // ✅ 使用翻譯函數而不是硬編碼
      Alert.alert(
        t('topUpSuccess'),
        `${t('topUpSuccessMessage', { coins: coinsAdded, total: currentCoins })}`
      );

      // ✅ 恢復交換狀態，確保回來後方向正確
      await restoreSwapState();

      // ✅ 新增：如果有未完成的翻譯，自動重新執行
      const pendingText = text.trim();
      if (pendingText) {
        debugLog('🔄 檢測到未完成翻譯，自動執行...');
        // 稍作延遲讓 Alert 消失
        setTimeout(() => {
          handleSubmit();
        }, 1000);
      }

    } catch (error) {
      debugError('處理充值成功失敗:', error);
    }
  };

  // ⭐ 第一次交換語言後提醒使用者新增鍵盤語言
  const checkKeyboardForSwap = async (newSourceLang: string) => {
    const short = newSourceLang.split('-')[0]; // zh-TW → zh
    const deviceBase = getDeviceLanguage().split('-')[0];

    // ⭐ 如果使用者切換後的新輸入語言 = 本機語言 → 不用提醒
    if (short === deviceBase) return;

    // ⭐ 只定義一次 key
    const storageKey = `keyboard_warning_${short}`;
    const warned = await AsyncStorage.getItem(storageKey);

    // 🔥 修復：使用一致的檢查值
    if (warned === '1') return;

    const name = LANGUAGE_MAP[newSourceLang as keyof typeof LANGUAGE_MAP]?.label || newSourceLang;

    Alert.alert(
      t('keyboardLanguageRequired'),
      t('keyboardLanguageMessage', { language: name }),
      [
        {
          text: t('doNotShowAgain'),
          style: "destructive",
          onPress: async () => {
            await AsyncStorage.setItem(storageKey, '1');
            debugLog(`✅ 已設置不再提醒鍵盤警告: ${storageKey}`);
          },
        },
        {
          text: t('iUnderstand'),
          style: "cancel",
        }
      ]
    );
  };
  // 準備產品列表
  const products = Object.keys(productToCoins).map(id => ({
    id,
    coins: productToCoins[id],
    localizedPrice: 'NT$ 30' // 這裡可以從 getProducts 獲取實際價格
  }));

  // ⭐ 根據 isRotating 決定「誰在上、誰在下、語言是哪個」
  const upperMessages = messages.filter(m => m.position === 'upper');
  const lowerMessages = messages.filter(m => m.position === 'lower');

  // 在現有的鍵盤監聽器中添加滾動邏輯
  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (e) => {
      setIsKeyboardVisible(true);
      setKeyboardHeight(e.endCoordinates.height);

      // ⭐ 鍵盤顯示時立即滾動到底部
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    });

    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setIsKeyboardVisible(false);
      setKeyboardHeight(0);

      // ⭐ 鍵盤隱藏時也滾動到底部，確保布局正確
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // 修改 scrollToBottom 函數，確保在鍵盤狀態下也能正確滾動
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      // ⭐ 添加更強的滾動邏輯
      lowerScrollRef.current?.scrollToEnd({ animated: false });
      upperScrollRef.current?.scrollToEnd({ animated: false });

      // ⭐ 雙重確保，特別是鍵盤彈出時
      setTimeout(() => {
        lowerScrollRef.current?.scrollToEnd({ animated: false });
        upperScrollRef.current?.scrollToEnd({ animated: false });
      }, 150);
    });
  };

  return (
<KeyboardAvoidingView
      style={[
        styles.container,
        {
          flex: 1,
          backgroundColor: colors.background,
          // 加上 isUpsideDown 翻轉
          transform: isUpsideDown ? [{ rotate: '180deg' }] : []
        }
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* 🔸依照 layoutMode 顯示不同版型 */}
      {layoutMode === 'default' ? (
        
        // ⭐⭐⭐ 修改開始：加入過場畫面判斷 ⭐⭐⭐
        isRotating ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            {/* 顯示一個大的交換圖標 */}
            <Icon name="swap-vertical-circle-outline" size={90} color={colors.primary} />
          </View>
        ) : (
          <>
            {/* 上半部：翻譯區 */}
            <View style={[
              styles.section,
              styles.upperSection,
              { flex: 1 },

            ]}>
              <ScrollView
                ref={upperScrollRef}
                onScroll={(event) => syncScroll('upper', event)}
                scrollEventThrottle={16}
                onContentSizeChange={() => {
                  if (!isRotating) {
                    upperScrollRef.current?.scrollToEnd({ animated: false });
                  }
                }}
                contentContainerStyle={[
                  styles.upperScrollContent,
                  inputPosition === 'top' ? { paddingBottom: 70 } : {},
                  !isUpsideDown && { paddingTop: 35 }
                ]}
                style={{ transform: [{ rotate: '180deg' }] }}
              >

                {upperMessages.map((msg) => {
                  const isTranslated = msg.role === 'translation'; // ⭐ 用 role 決定左右 & 顏色

                  return (
                    <TouchableOpacity
                      key={msg.id}
                      activeOpacity={0.8}
                      onPress={() => speakText(msg.text, msg.detectedLang)}
                      style={[
                        styles.messageBubble,
                        {
                          // ⭐ 原文在左、翻譯在右
                          alignSelf: isTranslated ? 'flex-start' : 'flex-end',
                          marginLeft: isTranslated ? 10 : 0,
                          marginRight: isTranslated ? 0 : 10,
                          marginBottom: 10,

                          // ⭐ 原文用 container 背景，翻譯用主色
                          backgroundColor: isTranslated ? colors.container : colors.primary,
                          borderWidth: isTranslated ? 1 : 0,
                          borderColor: isTranslated ? colors.primary : 'transparent',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.messageText,
                          {
                            color: isTranslated ? colors.text : colors.background,
                          },
                        ]}
                        selectable={true}
                      >
                        {msg.text + '   '}
                      </Text>

                      <View style={{ position: 'absolute', right: 8, top: 8 }}>
                        <Icon
                          name="volume-high"
                          size={16}
                          color={isTranslated ? colors.primary : colors.background}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Header - 旋轉時隱藏，不轉時顯示 */}
            <View style={[
              styles.headerContainer,
              isUpsideDown && { transform: [{ rotate: '180deg' }] },
              {
                height: 60, // 固定header高度
                justifyContent: 'center',
                ...(isUpsideDown
                  ? { marginBottom: -35 }  // 反轉時：下方 margin
                  : { marginTop: -35 }     // 正向時：上方 margin
                ),
                zIndex: 10 // 確保在最上層
              }
            ]}>
              <RecorderHeader
                title="VTrans"
                onDelete={handleClear}
                autoPlayEnabled={autoPlay}
                toggleAutoPlay={() => setAutoPlay(p => !p)}
                onSwapLanguages={handleSwapLanguages}
                isLanguageSwapped={isLanguageSwapped}
                targetLangCode={targetLang as LanguageCode}
              />
            </View>

            {/* 下半部：原文區 */}
            <View style={[
              styles.section,
              { flex: 1 }
            ]}>
              <ScrollView
                ref={lowerScrollRef}
                onScroll={(event) => syncScroll('lower', event)}
                scrollEventThrottle={16}
                onContentSizeChange={() => {
                  if (!isRotating) {
                    lowerScrollRef.current?.scrollToEnd({ animated: false });
                  }
                }}
                contentContainerStyle={[
                  styles.lowerScrollContent,
                  inputPosition === 'bottom' && !isRotating ? { paddingBottom: 70 } : {},
                  isUpsideDown && { paddingTop: 35 }
                ]}
              >
                {lowerMessages.map((msg) => {
                  const isTranslated = msg.role === 'translation';

                  return (
                    <TouchableOpacity
                      key={msg.id}
                      activeOpacity={0.8}
                      onPress={() => speakText(msg.text, msg.detectedLang)}
                      style={[
                        styles.messageBubble,
                        styles.lowerMessageBubble,
                        {
                          // ⭐ 一樣：原文左、翻譯右
                          alignSelf: isTranslated ? 'flex-start' : 'flex-end',
                          marginLeft: isTranslated ? 10 : 0,
                          marginRight: isTranslated ? 0 : 10,
                          marginBottom: 10,

                          backgroundColor: isTranslated ? colors.container : colors.primary,
                          borderColor: isTranslated ? colors.primary : 'transparent',
                          borderWidth: isTranslated ? 1 : 0,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.messageText,
                          { color: isTranslated ? colors.text : colors.background }
                        ]}
                        selectable={true}
                      >
                        {msg.text + '   '}
                      </Text>

                      <View style={{ position: 'absolute', right: 8, top: 8 }}>
                        <Icon
                          name="volume-high"
                          size={16}
                          color={isTranslated ? colors.primary : colors.background}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}

              </ScrollView>
            </View>

{/* 輸入框 - 永遠在底部，跟著大翻轉 */}
            <View
              style={[
                {
                  width: '100%',
                  transform: isUpsideDown ? [{ rotate: '180deg' }] : [],
                  height: 70,
                },
                inputPosition === 'top'
                  ? { position: 'absolute', top: 0 }
                  : { position: 'absolute', bottom: 0 }
              ]}
            >
              {/* ⭐ 修改：增加一個內層容器來做橫向排列 (Row) */}
              <View style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.container,
                borderTopWidth: 1,
                borderColor: colors.primary,
                paddingRight: 10, // 給按鈕一點空間
              }}>
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: colors.text,
                      // backgroundColor, borderColor 移到外層了，這裡改透明
                      backgroundColor: 'transparent', 
                      borderTopWidth: 0, // 邊框也由外層控制
                      height: '100%',
                      flex: 1, // 讓輸入框佔據剩餘空間
                    },
                  ]}
                  placeholder={t('enterTextPlaceholder')}
                  placeholderTextColor={colors.subtext}
                  value={text}
                  onChangeText={handleTextChange}
                  onSubmitEditing={handleSubmit}
                  returnKeyType="send"
                />

                {/* ⭐ 新增：當有文字時顯示傳送箭頭 */}
                {text.trim().length > 0 && (
                  <TouchableOpacity onPress={handleSubmit} activeOpacity={0.7}>
                    <Icon 
                      name="arrow-up-circle" 
                      size={36} 
                      color={colors.primary} 
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </>
        )

      ) : (
        <>
          {/* 反轉模式：Header 放最上 */}
          <View style={styles.headerContainer}>
            <RecorderHeader
              title="VLearn"
              onDelete={handleClear}
              autoPlayEnabled={autoPlay}
              toggleAutoPlay={() => setAutoPlay(prev => !prev)}
              onSwapLanguages={handleSwapLanguagesSimple} // ⭐ reverse mode 永遠 simple swap
              isLanguageSwapped={isLanguageSwapped}
                              targetLangCode={targetLang as LanguageCode}
            />
          </View>

          {/* 成對訊息區 */}
          <View style={[
            styles.section,
            {
              flex: 1
            }
          ]}>
            <ScrollView
              ref={upperScrollRef}
              onContentSizeChange={() => {
                upperScrollRef.current?.scrollToEnd({ animated: false });
              }}
              contentContainerStyle={[
                styles.lowerScrollContent,
    { paddingBottom: 70 } 
              ]}
            >
              {Object.values(
                messages.reduce((acc: Record<string, any>, msg) => {
                  if (!acc[msg.id]) acc[msg.id] = {};
                  acc[msg.id][msg.role] = msg;
                  return acc;
                }, {} as Record<string, any>)
              ).map((pair: any, i) => {
                const orig = pair.original;
                const trans = pair.translation;

                if (!orig && !trans) return null;

                return (
                  <View key={orig?.id ?? trans?.id ?? i} style={{ marginBottom: 12 }}>

                    {/* ⭐ 原文：右邊（輸入）- 修正顏色邏輯 */}
                    {orig && (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => speakText(orig.text, orig.detectedLang)}
                      >
                        <View
                          style={[
                            styles.messageBubble,
                            {
                              alignSelf: 'flex-end',
                              backgroundColor: colors.primary, // ⭐ 原文用主色
                              marginRight: 10,
                              marginLeft: 'auto',
                              marginBottom: 10,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.messageText,
                              { color: colors.background }, // ⭐ 原文文字用背景色
                            ]}
                            selectable={true}
                          >
                            {orig.text + '   '}
                          </Text>

                          <View style={{ position: 'absolute', right: 8, top: 8 }}>
                            <Icon
                              name="volume-high"
                              size={16}
                              color={colors.background} // ⭐ 喇叭圖標用背景色
                            />
                          </View>
                        </View>
                      </TouchableOpacity>
                    )}

                    {/* ⭐ 翻譯：左邊（輸出）- 修正顏色邏輯 */}
                    {trans && (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => speakText(trans.text, trans.detectedLang)}
                      >
                        <View
                          style={[
                            styles.messageBubble,
                            {
                              alignSelf: 'flex-start',
                              backgroundColor: colors.container, // ⭐ 翻譯用容器色
                              borderWidth: 1,
                              borderColor: colors.primary,
                              marginLeft: 10,
                              marginRight: 'auto',
                              marginBottom: 10,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.messageText,
                              { color: colors.text }, // ⭐ 翻譯文字用文字色
                            ]}
                            selectable={true}
                          >
                            {trans.text + '   '}
                          </Text>

                          <View style={{ position: 'absolute', right: 8, top: 8 }}>
                            <Icon
                              name="volume-high"
                              size={16}
                              color={colors.primary} // ⭐ 喇叭圖標用主色
                            />
                          </View>
                        </View>
                      </TouchableOpacity>
                    )}

                  </View>
                );
              })}
            </ScrollView>
          </View>

{/* ⭐ 反轉模式的輸入框：永遠固定在最底 */}
          <View
            style={{
              width: '100%',
              position: 'absolute',
              bottom: 0,
              backgroundColor: colors.background,
              // paddingHorizontal: 10, // 移掉這個，讓邊框貼齊
              // paddingVertical: 8,    // 移掉這個，讓高度固定
            }}
          >
            {/* ⭐ 修改：同樣改為 Row 佈局 */}
            <View style={{
               flexDirection: 'row',
               alignItems: 'center',
               backgroundColor: colors.container,
               borderTopWidth: 1,
               borderColor: colors.primary,
               height: 70, // 保持高度一致
               paddingRight: 10,
            }}>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    backgroundColor: 'transparent', // 改透明
                    borderTopWidth: 0,              // 移除邊框
                    flex: 1,                        // 佔滿空間
                    height: '100%'
                  }
                ]}
                placeholder={t('enterTextPlaceholder')}
                placeholderTextColor={colors.subtext}
                value={text}
                onChangeText={handleTextChange}
                onSubmitEditing={handleSubmit}
                returnKeyType="send"
              />

              {/* ⭐ 新增：當有文字時顯示傳送箭頭 */}
              {text.trim().length > 0 && (
                <TouchableOpacity onPress={handleSubmit} activeOpacity={0.7}>
                  <Icon 
                    name="arrow-up-circle" 
                    size={36} 
                    color={colors.primary} 
                  />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </>
      )}


      {/* 充值彈窗 */}
      <TopUpModal
        visible={showTopUp}
        onClose={() => setShowTopUp(false)}
        onSelect={async (productId) => {
          try {
            await purchaseManager.requestPurchase(productId);
            const coinsAdded = await waitForTopUp();
            handleTopUpSuccess(coinsAdded);
          } catch (error) {
            Alert.alert(t('purchaseFailed'), t('pleaseTryAgain'));
          }
        }}
        styles={styles}
        colors={colors}
        products={products}
      />
    </KeyboardAvoidingView>
  );

}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  upperScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  lowerScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  headerContainer: {
    alignItems: 'center',
  },
  messageBubble: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 2,
    marginVertical: 4,
    maxWidth: '80%',
  },
  lowerMessageBubble: {
    borderWidth: 1,
  },
  messageText: {
    fontSize: 16,
    textAlign: 'left',
  },
  input: {
    fontSize: 18,
    padding: 12,
    borderTopWidth: 1,
  },
  languagePickerContainer: {
    position: 'absolute',
    top: 5,
    right: 5,
    zIndex: 20,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  languagePicker: {
    width: 140,
    height: 40,
  },
  upperSection: {},
  upperMessageBubble: {},

  coinsDisplay: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    zIndex: 10,
  },
  headerPlaceholder: {
    height: 60, // 根據你的 Header 實際高度調整
  },
});

