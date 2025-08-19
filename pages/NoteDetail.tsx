import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Alert } from 'react-native';
import { RouteProp, useRoute, useNavigation, useFocusEffect, } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import Sound from 'react-native-sound';
import { useTheme } from '../constants/ThemeContext';
import RecorderHeader from '../components/RecorderHeader';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { logCoinUsage } from '../utils/googleSheetAPI';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RecordingItem,
  transcribeAudio, summarizeWithMode, summarizeModes,
  parseDateTimeFromDisplayName, generateRecordingMetadata, updateRecordingFields, getSummarizeModes, splitAudioSegments,
} from '../utils/audioHelpers';
import type { RootStackParamList } from '../App';
import * as Localization from 'expo-localization';
import { debugLog, debugWarn, debugError } from '../utils/debugLog';
import { handleLogin, loadUserAndSync, COIN_UNIT_MINUTES, COIN_COST_PER_UNIT, COIN_COST_AI } from '../utils/loginHelpers';
import { productIds, productToCoins, purchaseManager, setTopUpProcessingCallback, setTopUpCompletedCallback, waitForTopUp } from '../utils/iap';
import { useFileStorage } from '../utils/useFileStorage';
import { useRecordingContext } from '../constants/RecordingContext';
import TopUpModal from '../components/TopUpModal';
import LoginOverlay from '../components/LoginOverlay';
import { useLoginContext } from '../constants/LoginContext';
import { APP_TITLE, SEGMENT_DURATION } from '../constants/variant';
import {
  renderFilename,
  renderNoteBlock
} from '../components/AudioItem';
import PlaybackBar from '../components/PlaybackBar';
import MoreMenu from '../components/MoreMenu';
import { shareRecordingNote, shareRecordingFile, saveEditedRecording, deleteTextRecording, prepareEditing } from '../utils/editingHelpers';
import { TouchableWithoutFeedback, Keyboard } from 'react-native';
import { useTranslation } from '../constants/i18n';

export default function NoteDetailPage() {
  const navigation = useNavigation();
  const { styles, colors } = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'NoteDetail'>>();
  const { t } = useTranslation();
  const { index, uri, type: initialType, summaryMode: initialSummaryMode } = route.params;
  const [activeTask, setActiveTask] = useState<'transcribe' | 'summarize' | null>(null);

  const {
    recordings,
    setRecordings,
    lastVisitedRecording,
    setLastVisitedRecording
  } = useRecordingContext();

  // 🎯 抓主音檔與小音檔
  if (index === undefined) {
    Alert.alert(t('error'), t('audioIndexNotFound')); // 錯誤. 找不到音檔 index
    navigation.goBack();
    return null;
  }
  const mainItem = recordings[index];
  const subItem = uri
    ? mainItem?.derivedFiles?.splitParts?.find((p: { uri: string }) => p.uri === uri)
    : null;

  const currentItem: RecordingItem = subItem ?? mainItem;


  /* 檢查 currentItem 結構
  debugLog('currentItem:', {
    uri: currentItem.uri,
    transcript: currentItem.transcript,
    summaries: currentItem.summaries,
    notes: currentItem.notes,
  });
  */

  const toolboxButtonRef = useRef<View | null>(null);

  const [summaryMode, setSummaryMode] = useState(initialSummaryMode || 'summary');
  const [summaryMenuContext, setSummaryMenuContext] = useState<{ position: { x: number; y: number } } | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [summarizingState, setSummarizingState] = useState<{ index: number; mode: string } | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [viewType, setViewType] = useState(initialType);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [sound, setSound] = useState<Sound | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [speedMenuVisible, setSpeedMenuVisible] = useState(false);
  const [speedAnchor, setSpeedAnchor] = useState<{ x: number; y: number } | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);

  const [selectedMenuIndex, setSelectedMenuIndex] = useState<number | null>(null);

  const isAnyProcessing = isTranscribing || isSummarizing;
  type SummarizeMode = typeof summarizeModes[number]['key'];

  // 特殊著色
  const highlightKeyword = (text: string, keyword: string | undefined, highlightColor: string) => {
    if (!keyword || !text.includes(keyword)) return <Text>{text}</Text>;

    const parts = text.split(new RegExp(`(${keyword})`, 'gi'));
    return (
      <Text style={styles.transcriptText}>
        {parts.map((part, i) =>
          part.toLowerCase() === keyword.toLowerCase() ? (
            <Text
              key={i}
              style={{
                backgroundColor: highlightColor,
                color: colors.text,
              }}
            >
              {part}
            </Text>
          ) : (
            <Text key={i}>{part}</Text>
          )
        )}
      </Text>
    );
  };

  // 編輯重置
  const resetEditingState = () => {
    setIsEditing(false);
    setEditingState({ type: null, index: null, text: '' });
  };

  // 初始化音檔
  useEffect(() => {
    const s = new Sound(currentItem.uri, '', (error) => {
      if (!error) {
        setDuration(s.getDuration() * 1000);
      }
    });
    setSound(s);

    return () => {
      s.release();
    };
  }, []);

  useEffect(() => {
    if (isPlaying && sound) {
      const interval = setInterval(() => {
        sound.getCurrentTime((sec) => {
          setPosition(sec * 1000);
        });
      }, 300);
      return () => clearInterval(interval);
    }
  }, [isPlaying, sound]);

  const togglePlay = () => {
    if (!sound) return;
    if (isPlaying) {
      sound.pause();
      setIsPlaying(false);
      setLastVisitedRecording(prev => prev ? { ...prev, isPlaying: false } : null); // 暫停時更新狀態
    } else {
      sound.play(() => {
        setIsPlaying(false);
        setPosition(0);
      });
      setIsPlaying(true);
      setLastVisitedRecording({ // 播放時更新狀態
        index,
        uri: currentItem.uri,
        type: viewType,
        isPlaying: true
      });
    }
  };

  // 👇 每段逐字稿渲染（顯示子段 displayName + 該段文字）
  const renderSegmentedTranscript = () => {
    const parts = recordings[index]?.derivedFiles?.splitParts || [];
    const segments = parts
      .map((p: any) => ({
        name: p.displayName || p.name || 'Segment',
        text: (p.transcript || '').trim(),
      }))
      .filter(s => s.text.length > 0);

    if (segments.length === 0) return null;

    return (
      <View style={{ gap: 12 }}>
        {segments.map((seg, i) => (
          <View key={`${seg.name}-${i}`} style={{ gap: 6 }}>
            <Text style={[styles.transcriptText, { fontWeight: 'bold' }]}>
              {seg.name}
            </Text>
            <Text style={styles.transcriptText}>
              {seg.text}
            </Text>
          </View>
        ))}
      </View>
    );
  };

// ✅ 每段摘要渲染（顯示子段 displayName + 該段摘要）
const renderSegmentedSummary = (mode: SummarizeMode = 'summary') => {
  const parts = recordings[index]?.derivedFiles?.splitParts || [];
  const segments = parts
    .map((p: any) => ({
      name: p.displayName || p.name || 'Segment',
      text: (p.summaries?.[mode] || '').trim(),
    }))
    .filter(s => s.text.length > 0);

  if (segments.length === 0) return null;

  return (
    <View style={{ gap: 12 }}>
      {segments.map((seg, i) => (
        <View key={`${seg.name}-${i}`} style={{ gap: 6 }}>
          <Text style={[styles.transcriptText, { fontWeight: 'bold' }]}>{seg.name}</Text>
          <Text style={styles.transcriptText}>{seg.text}</Text>
        </View>
      ))}
    </View>
  );
};


  // 逐段轉文字（只處理還沒有 transcript 的分段）
  const transcribeMissingSplitParts = async (
    partsInput?: any[],
    recordingsInput?: RecordingItem[]
  ) => {
    const main = (recordingsInput ?? recordings)[index];
    const parts = partsInput ?? main?.derivedFiles?.splitParts ?? [];
    if (!parts.length) return;

    const lang = (Localization.getLocales?.()[0]?.languageTag || 'zh-TW').includes('CN') ? 'cn' : 'tw';

    let updated = [...(recordingsInput ?? recordings)];

    const total = parts.length;
    for (let i = 0; i < total; i++) {
      const part = parts[i];
      // UI 提示目前進度（可自行調整字串）
      setPartialTranscript(
        t('segmentTranscribingProgress', { current: i + 1, total })
      );

      // 已經有逐字稿就跳過
      if (part?.transcript && part.transcript.trim().length > 0) continue;

      try {
        // ① 轉寫
        const r = await transcribeAudio(part, undefined, lang, t);
        const text = (r?.transcript?.text || '').trim();

        // ② 先把 transcript 寫回該子段（即使空字串也先寫，後面會判斷）
        updated = updateRecordingFields(updated, index, part.uri, { transcript: text });
        setRecordings(updated);
        await saveRecordings(updated);

        // ③ 主音檔同款容錯（只有「純靜音」不扣；太短要扣）
        const notesTextForPart = (part as any)?.notes || '';
        const totalTextLengthForPart = (text + notesTextForPart).trim().length;

        // 3-1) 純靜音（text 為空）→ 不做摘要、不扣款
        if (!text) {
          const placeholder = t('noValidSpeechDetected');
          const autoSummaries: Record<string, string> = {};
          summarizeModes.forEach(mode => { autoSummaries[mode.key] = placeholder; });

          updated = updateRecordingFields(updated, index, part.uri, {
            transcript: placeholder,
            summaries: { ...(part.summaries || {}), ...autoSummaries },
          });
          setRecordings(updated);
          await saveRecordings(updated);

          // 👇 直接下一段（不扣）
          continue;
        }

        // 3-2) 內容太少 → 不做真正摘要，但「要扣」
        if (totalTextLengthForPart < 20) {
          const autoSummaries: Record<string, string> = {};
          summarizeModes.forEach(mode => {
            autoSummaries[mode.key] = text + '\n' + t('insufficientContentForSummary');
          });

          updated = updateRecordingFields(updated, index, part.uri, {
            summaries: { ...(part.summaries || {}), ...autoSummaries },
          });
          setRecordings(updated);
          await saveRecordings(updated);

          {
            const segName = part.displayName || part.name || 'Segment';
            const firstLine = (autoSummaries.summary || text || '').split('\n').find(Boolean) || '';
            if (firstLine) {
              const parentSummaryNow = (updated[index]?.summaries?.summary || '').trim();
              const line = `• ${segName}: ${firstLine}`;
              const parentSummaryNext = parentSummaryNow
                ? (parentSummaryNow.includes(line) ? parentSummaryNow : `${parentSummaryNow}\n${line}`)
                : line;
              updated = updateRecordingFields(updated, index, undefined, {
                summaries: { ...(updated[index]?.summaries || {}), summary: parentSummaryNext },
              });

              setRecordings(updated);
              await saveRecordings(updated);
            }
          }

          // 👇 太短也要扣 → 直接走到「⑤ 扣款」
        } else {
          // ④ 正常：做摘要並寫回
          let startTime = '', date = '';
          if (part?.date) {
            const d = new Date(part.date);
            startTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
            date = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
          }
          const segmentSummary = await summarizeWithMode(text, 'summary', t, { startTime, date });

          updated = updateRecordingFields(updated, index, part.uri, {
            summaries: { ...(part.summaries || {}), summary: segmentSummary },
          });
          setRecordings(updated);
          await saveRecordings(updated); {
            const segName = part.displayName || part.name || 'Segment';
            const firstLine = (segmentSummary || '').split('\n').find(Boolean) || '';
            if (firstLine) {
              const parentSummaryNow = (updated[index]?.summaries?.summary || '').trim();
              const line = `• ${segName}: ${firstLine}`;
              const parentSummaryNext = parentSummaryNow
                ? (parentSummaryNow.includes(line) ? parentSummaryNow : `${parentSummaryNow}\n${line}`)
                : line;

              updated = updateRecordingFields(updated, index, undefined, {
                summaries: { ...(updated[index]?.summaries || {}), summary: parentSummaryNext },
              });
              setRecordings(updated);
              await saveRecordings(updated);
            }
          }
        }

        // ⑤ ✅ 扣這一段的錢（純靜音不會走到這裡；太短和正常都會扣）
        const segmentDurationSec = Math.min(
          SEGMENT_DURATION,
          Math.ceil(part?.durationSec ?? SEGMENT_DURATION)
        );
        const coinsForThisPart =
          Math.ceil(segmentDurationSec / (COIN_UNIT_MINUTES * 60)) * COIN_COST_PER_UNIT;

        if (coinsForThisPart > 0) {
          const stored = await AsyncStorage.getItem('user');
          const user = stored ? JSON.parse(stored) : null;
          if (user) {
            await logCoinUsage({
              id: user.id,
              email: user.email,
              name: user.name,
              action: 'transcript',
              value: -coinsForThisPart,
              note: `轉文字${totalTextLengthForPart < 20 ? '(太短)' : '+摘要'}：${part.displayName || part.name || ''}，長度 ${segmentDurationSec}s，扣 ${coinsForThisPart} 金幣`
            });
          }
        }
      } catch (err) {
        // 轉寫/摘要失敗 → 不扣
      }

    }

    // 清掉提示，用分段清單顯示結果
    setPartialTranscript('');
    setViewType('transcript'); // 讓你的 renderSegmentedTranscript() 出來
    return true;
  };

  // ✅ 工具：把長主音檔的小音檔逐字稿合併成一份（給新聞稿/各種摘要用）
  const buildMergedTranscript = (item: RecordingItem) => {
    if (!item) return '';
    const parts = item?.derivedFiles?.splitParts || [];
    // 短音檔：直接回主檔 transcript
    if (!parts.length) return (item.transcript || '').trim();

    // 長音檔：把每段的 displayName + transcript 串起來
    const merged = parts.map((p: any) => {
      const name = p.displayName || p.name || 'Segment';
      const text = (p?.transcript || '').trim();
      return text ? `【${name}】\n${text}` : '';
    }).filter(Boolean).join('\n\n');

    return merged.trim();
  };


  useEffect(() => {
    const updatedMain = recordings[index];
    const updatedSub = uri
      ? updatedMain?.derivedFiles?.splitParts?.find((p: { uri: string }) => p.uri === uri)
      : null;
    const updatedItem = updatedSub ?? updatedMain;

    setSummaries(updatedItem?.summaries || {});
    setFinalTranscript(updatedItem?.transcript || '');
  }, [recordings, index, uri]);

  const {
    isLoading,
    loadRecordings,
    saveRecordings,
    safeDeleteFile,
    updateRecordingAtIndex
  } = useFileStorage(setRecordings);

  // 帳號登入
  const { isLoggingIn, setIsLoggingIn } = useLoginContext();
  useEffect(() => {
    loadUserAndSync();
  }, []);

  // 購買畫面
  const [showTopUpModal, setShowTopUpModal] = useState(false);

  //儲值中
  const [isTopUpProcessing, setIsTopUpProcessing] = useState(false);

  useEffect(() => {
    const callback = (isProcessing: boolean) => {
      setIsTopUpProcessing(isProcessing);
    };

    setTopUpProcessingCallback(callback);

    return () => {
      setTopUpProcessingCallback(null); // 清理時取消回調
    };
  }, []);

  // 替換原有的 handlePurchase 函數
  const handleTopUp = async (productId: string) => {
    debugLog('🟢 handleTopUp called with productId:', productId);
    try {
      // 1. 請求儲值
      await purchaseManager.requestPurchase(productId);
      setShowTopUpModal(false);

      // 2. 等待金幣更新（不再需要手動同步，因為 handlePurchaseUpdate 已經處理）
      // 3. 清除中斷操作的標記

    } catch (err) {
      debugWarn('購買錯誤:', err);
    }
  };

  // 在組件中添加 useEffect 來監聽 pendingActions
  useEffect(() => {
    const checkPendingActions = async () => {
      // 使用公共方法替代直接訪問私有屬性
      if (purchaseManager.hasPendingActions()) {
        const actions = purchaseManager.getPendingActions();
        const action = actions[0];

        if (action.type === 'transcribe' && action.index !== undefined) {
          const freshUser = await AsyncStorage.getItem('user');
          if (freshUser) {
            const user = JSON.parse(freshUser);
            if (user.coins > 0) { // 確保金幣已更新
              purchaseManager.clearPendingActions();
              setTimeout(() => {
                handleTranscribe(); // ✅ 不傳 index
              }, 500);
            }
          }
        }
      }
    };

    checkPendingActions();
  }, [purchaseManager]); // 依賴 purchaseManager 實例

  const userLang = Localization.getLocales()[0]?.languageTag || 'zh-TW';

  // 在 useEffect 中處理轉文字邏輯
  useEffect(() => {
    setLastVisitedRecording({ index, uri, type: initialType });
    const init = async () => {
      if (route.params.shouldTranscribe && !currentItem.transcript) {
        await handleTranscribe();
      }
    };
    init();
  }, [route.params.shouldTranscribe]);

  useEffect(() => {
    setLastVisitedRecording({ index, uri, type: initialType, isPlaying: true });
  }, [index, uri, initialType]);


  useFocusEffect(
    React.useCallback(() => {
      const checkLogin = async () => {
        const stored = await AsyncStorage.getItem('user');
        if (!stored && !isLoggingIn) {
          // ✅ 顯示提示：「尚未登入」
          debugWarn('尚未登入', '登入後可解鎖 AI 工具箱與錄音文檔轉文字功能');
        }
      };
      checkLogin();
      return () => {
        if (sound) {
          sound.stop(() => {
            sound.release();
          });
        }
      };
    }, [isLoggingIn, sound])
  );

  // 確認金幣
  const ensureCoins = async (requiredCoins: number): Promise<boolean> => {
    // 先檢查登入狀態
    let stored = await AsyncStorage.getItem('user');

    // 如果未登入，要求登入
    if (!stored) {
      const loginResult = await new Promise<boolean>((resolve) => {
        Alert.alert(
          t('loginRequiredTitle'),       // 原本的「請先登入」
          t('loginRequiredMessage'),     // 原本的「使用此功能需要登入」
          [
            { text: t('cancel'), onPress: () => resolve(false) },
            {
              text: t('login'),
              onPress: async () => {
                const result = await handleLogin(setIsLoggingIn, t);
                if (result) {
                  Alert.alert(t('loginSuccessTitle'), result.message, [
                    { text: t('continue'), onPress: () => resolve(true) }
                  ]);
                } else {
                  resolve(false);
                }
              }
            }
          ]
        );
      });

      if (!loginResult) return false;

      stored = await AsyncStorage.getItem('user');
      if (!stored) return false;
    }


    // 解析用戶資料
    const user = JSON.parse(stored);
    debugLog('確認點 2: 使用者有', user.coins, '需要', requiredCoins);

    // 檢查金幣數量
    if (user.coins >= requiredCoins) return true;

    // 金幣不足處理
    debugLog('確認點 3:進入處理');
    return new Promise((resolve) => {
      Alert.alert(
        t('notEnoughCoinsTitle'), // 金幣不足
        t('notEnoughCoinsMessage')
          .replace('{{required}}', String(requiredCoins))
          .replace('{{current}}', String(user.coins)),
        [
          { text: t('cancel'), style: 'cancel', onPress: () => resolve(false) },
          {
            text: t('topUpNow'), // 立即儲值
            onPress: async () => {
              setShowTopUpModal(true);
              const coinsAdded = await waitForTopUp(); // 等待儲值完成
              const refreshed = await AsyncStorage.getItem('user');
              const updatedUser = refreshed ? JSON.parse(refreshed) : user;
              resolve(updatedUser.coins >= requiredCoins);
            },
          },
        ]
      );
    });
  };

  // 以你現有的計價單位
  const secondsPerUnit = COIN_UNIT_MINUTES * 60;

  function getUntranscribedSecondsForRecording(rec: any): number {
    // 如果已經有切段，就只計算「沒有 transcript 的子段」
    const parts = rec?.derivedFiles?.splitParts || [];
    if (parts.length > 0) {
      let remain = 0;
      for (const p of parts) {
        const done = !!(p?.transcript && p.transcript.trim().length > 0);
        // 純靜音也會寫入 placeholder => 視為「已處理，不再計價」
        if (!done) {
          const sec = Math.ceil(p?.durationSec ?? SEGMENT_DURATION);
          // 最後一段可能不足 SEGMENT_DURATION，沿用實際秒數
          remain += Math.min(sec, SEGMENT_DURATION);
        }
      }
      return remain;
    }

    // 沒切段：如果主音檔已經有 transcript，就不需要再計價
    const hasMain = !!(rec?.transcript && rec.transcript.trim().length > 0);
    if (hasMain) return 0;

    // 主音檔未轉：整段都算
    const dur = Math.ceil(rec?.durationSec ?? 0);
    return dur;
  }

  function coinsNeededForSeconds(seconds: number): number {
    if (seconds <= 0) return 0;
    return Math.ceil(seconds / secondsPerUnit) * COIN_COST_PER_UNIT;
  }


  const saveEditing = () => {

    if (editingState.type === 'name') {
      const updated = [...recordings];
      updated[index].displayName = editingState.text;

      setRecordings(updated);
      saveRecordings(updated);
      setEditingState({ type: null, index: null, text: '', uri: null });
      setIsEditing(false);
      return;
    }
    let updatePayload: any = {};

    if (editingState.type === 'summary') {
      const targetItem = uri
        ? recordings[index].derivedFiles?.splitParts?.find(p => p.uri === uri)
        : recordings[index];

      updatePayload.summaries = {
        ...(targetItem?.summaries || {}),
        [summaryMode]: editingState.text,
      };
    } else {
      updatePayload[editingState.type!] = editingState.text;
    }

    const updated = updateRecordingFields(recordings, index, uri, updatePayload);

    setRecordings(updated);
    saveRecordings(updated);
    setEditValue(editingState.text);
    setEditingState({ type: null, index: null, text: '', uri: null });
    setIsEditing(false);
  };


  //轉文字邏輯
  const handleTranscribe = async (): Promise<void> => {

    if (isTranscribing) return; // ✅ 避免同時跑兩個
    // 已有主音檔逐字稿就不處理（避免誤卡狀態）
    if (currentItem?.transcript?.trim()?.length) return;
    if (activeTask) { Alert.alert(t('pleaseWait'), t('anotherTaskInProgress')); return; }
    setActiveTask('transcribe');
    setIsTranscribing(true);

    // Create a RecordingItem-compatible object if currentItem is SplitPart

    try {
      setIsTranscribing(true);
      setPartialTranscript(t('transcribingInProgress')); // 正在轉文字...

      const stored = await AsyncStorage.getItem('user');
      const user = stored ? JSON.parse(stored) : null;

      //先確認音檔長度跟需要金額
      const durationSec = await new Promise<number>((resolve, reject) => {
        const sound = new Sound(currentItem.uri, '', (error) => {
          if (error) {
            reject(new Error(t('errorLoadingAudio') + ': ' + error.message)); // 無法載入音訊
            return;
          }
          const duration = sound.getDuration();
          sound.release(); // ✅ 記得釋放資源
          if (duration === 0) {
            reject(new Error(t('invalidAudioDuration'))); // 無法取得音檔長度
          } else {
            resolve(Math.ceil(duration));
          }
        });
      });
      // ✅ 計算所需金幣數量

      const isMainAudio = !uri; // 沒傳 uri 就是主音檔
      const parts = recordings[index]?.derivedFiles?.splitParts || [];
      const alreadySplit = parts.length > 0;
      const NEED_AUTO_SPLIT = durationSec > SEGMENT_DURATION; // 超過一段長度

      // ===== 三種情境估價 =====
      let remainingSec = 0;

      if (!isMainAudio) {
        // 小音檔：只估這一段，且用「參數長度」估價（不看實際切長）
        const part = parts.find((p: any) => p.uri === uri);
        // 這段已轉過就直接跳過
        if (part?.transcript && part.transcript.trim().length > 0) {
          setIsTranscribing(false);
          setActiveTask(null);
          return;
        }
        remainingSec = SEGMENT_DURATION;

      } else {
        // 主音檔
        if (alreadySplit) {
          // 長母音檔（已切段）：估「未轉完的小段總秒數」
          remainingSec = getUntranscribedSecondsForRecording(recordings[index]);
        } else {
          // 未切段：短母音檔 or 即將自動切段的第一次進來
          // 若你希望第一次就切段且不先估整段，可把這裡設為 0；
          // 但你前面說短母音檔估價正確，所以保留用整段長度估價：
          remainingSec = durationSec;
        }
      }

      const coinsToDeduct = coinsNeededForSeconds(remainingSec);

      // 全部都已轉寫（或這段已轉過）→ 直接跳過，不再提示加值
      if (coinsToDeduct === 0) {
        setIsTranscribing(false);
        setActiveTask(null);
        return;
      }

      // 先驗餘額
      const ok = await ensureCoins(coinsToDeduct);
      if (!ok) {
        setIsTranscribing(false);
        setActiveTask(null);
        return;
      }



      if (isMainAudio && !alreadySplit && NEED_AUTO_SPLIT) {
        setPartialTranscript(t('splittingInProgress')); // 顯示「分段中…」

        const parent = recordings[index];
        const parts: RecordingItem[] = [];
        const segmentLength = SEGMENT_DURATION;

        // 用已算出的 durationSec 迴圈切段
        for (let start = 0; start < durationSec; start += segmentLength) {
          try {
            const part = await splitAudioSegments(parent.uri, start, segmentLength, t, parent.displayName);
            if (part) parts.push(part);
          } catch (e) {
            // 分段失敗就略過，不插任何文字
          }
        }

        // 寫回 splitParts
        const updated = [...recordings];
        updated[index] = {
          ...parent,
          derivedFiles: { ...(parent.derivedFiles || {}), splitParts: parts },
        };
        setRecordings(updated);
        await saveRecordings(updated);

        // ✨ 新增：切完就開始轉「尚未轉過」的分段
        await transcribeMissingSplitParts(parts, updated);

        // 後續就不要再對母音檔跑整段轉文字了
        setIsTranscribing(false);
        setActiveTask(null);
        return;
      }

      // …自動切段區塊之後、呼叫整段 transcribeAudio 之前，補這段：
      if (isMainAudio) {
        const parts = recordings[index]?.derivedFiles?.splitParts || [];
        const hasSplit = parts.length > 0;
        if (hasSplit) {
          await transcribeMissingSplitParts(parts, recordings);   // 只補還沒轉過的
          setIsTranscribing(false);
          setActiveTask(null);
          return; // 不要再跑整段母音檔的轉文字
        }
      }




      // ✅ 呼叫 Whisper API 轉文字，並逐段顯示文字
      const result = await transcribeAudio(currentItem, (updatedTranscript) => {
        setPartialTranscript(updatedTranscript); // ✅ 畫面立即顯示
      }, userLang.includes('CN') ? 'cn' : 'tw', t);


      // ✅ 紀錄金幣使用
      const coinResult = await logCoinUsage({
        id: user.id,
        email: user.email,
        name: user.name,
        action: 'transcript',
        value: -coinsToDeduct,
        note: `轉文字：${currentItem.displayName || currentItem.name || ''}，長度 ${durationSec}s，扣 ${coinsToDeduct} 金幣`
      });

      if (!coinResult.success) {
        debugWarn("轉換成功，但扣金幣失敗", coinResult.message || "請稍後再試");
      }

      // 確認音檔是否有效
      const rawText = result?.transcript?.text?.trim() || '';
      const summaryLang = userLang.includes('CN') ? 'cn' : 'tw';

      if (!rawText) {
        // const placeholder = '<未偵測到有效語音內容>';
        const placeholder = t('noValidSpeechDetected');

        // ✅ 為所有摘要欄位都加上這個 placeholder，避免後續再做摘要
        const autoSummaries: Record<string, string> = {};
        summarizeModes.forEach(mode => {
          autoSummaries[mode.key] = placeholder;
        });

        const updated = updateRecordingFields(recordings, index, uri, {
          transcript: placeholder,
          summaries: autoSummaries,
        });
        await saveRecordings(updated);
        setRecordings(updated);
        setFinalTranscript(placeholder);
        setPartialTranscript('');
        setSummaries(autoSummaries); // ✅ 畫面立即顯示打勾
        setSummaryMode('summary');

        return;
      }

      const notesText = currentItem.notes || '';
      const totalTextLength = (rawText + notesText).trim().length;

      if (totalTextLength < 20) {
        const autoSummaries: Record<string, string> = {};
        summarizeModes.forEach(mode => {
          autoSummaries[mode.key] = rawText + '\n' + t('insufficientContentForSummary');
          //   autoSummaries[mode.key] = rawText + '\n' + '內容缺乏足夠資訊分析';
        });

        const updated = updateRecordingFields(recordings, index, uri, {
          transcript: rawText,
          summaries: autoSummaries,
        });
        await saveRecordings(updated);
        setRecordings(updated);
        setFinalTranscript(rawText);
        setPartialTranscript('');
        setSummaries(autoSummaries);
        setSummaryMode('summary');
        resetEditingState();
        return;
      }

      // ✅ 先寫入 transcript
      let updated = updateRecordingFields(recordings, index, uri, {
        transcript: rawText,
      });
      await saveRecordings(updated);
      setRecordings(updated);

      // ✅ 再取得正確的 item（主音檔或子音檔）
      const updatedItem = uri
        ? updated[index].derivedFiles?.splitParts?.find((p) => p.uri === uri)
        : updated[index];

      // ✅ 呼叫摘要 API
      // 取得音檔時間資訊
      let startTime = '';
      let date = '';
      if (updatedItem?.date) {
        const dateObj = new Date(updatedItem.date);
        startTime = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}:${dateObj.getSeconds().toString().padStart(2, '0')}`;
        date = `${dateObj.getFullYear()}/${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
      }

      const summary = await summarizeWithMode(
        rawText,
        'summary',
        t,
        { startTime, date }
      );

      // ✅ 補寫 summary 回該筆資料
      updated = updateRecordingFields(updated, index, uri, {
        summaries: {
          ...(updatedItem?.summaries || {}),
          summary,
        },
      });
      await saveRecordings(updated);
      setRecordings(updated);
      setSummaries(
        uri
          ? updated[index].derivedFiles?.splitParts?.find((p) => p.uri === uri)?.summaries || {}
          : updated[index].summaries || {}
      );
      setSummaryMode('summary');
      setViewType('summary');
    } catch (err) {
      Alert.alert(t('error'), (err as Error).message || t('transcriptionFailedNoCharge'));
      //   Alert.alert("❌ 錯誤", (err as Error).message || "轉換失敗，這次不會扣金幣");
    } finally {
      setActiveTask(null);
      setIsTranscribing(false);
    }
  };

  // 重點摘要AI工具箱邏輯
  const handleSummarize = async (
    index: number,
    mode: SummarizeMode = 'summary',
    requirePayment?: boolean
  ): Promise<void> => {
    if (activeTask) {
      Alert.alert(t('pleaseWait'), t('anotherTaskInProgress'));
      return;
    }

    const pay = requirePayment ?? (mode !== 'summary');
    setActiveTask('summarize');
    setSummarizingState({ index, mode });

    try {
      // ✅ 1. 如果已經有摘要，就切換顯示即可
      if (currentItem.summaries?.[mode]) {
        setSummaryMode(mode);
        setViewType('summary');
        return;
      }

      // ✅ 2. 如果需要金幣，先檢查是否足夠
      let user: any = null;
      if (pay) {
        const ok = await ensureCoins(COIN_COST_AI);
        if (!ok) return;
        const stored = await AsyncStorage.getItem('user');
        if (!stored) throw new Error(t('userDataUnavailable'));
        user = JSON.parse(stored);
      }

// ✅ 3. 整理摘要上下文
const dateObj = currentItem.date ? new Date(currentItem.date) : null;
const startTime = dateObj
  ? `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`
  : '';
const date = dateObj
  ? `${dateObj.getFullYear()}/${dateObj.getMonth() + 1}/${dateObj.getDate()}`
  : '';

// ✅ 主檔 vs 子檔：決定用合併還是單段
const isMainAudio = !uri;
const mergedTranscript = isMainAudio
  ? buildMergedTranscript(recordings[index])   // 主檔：合併全部小檔
  : (currentItem.transcript || '').trim();     // 子檔：只這段

const textToSummarize = currentItem.notes?.trim()
  ? `使用者補充筆記：${currentItem.notes} 錄音文字如下：${mergedTranscript}`
  : mergedTranscript || '';

  debugLog('[Summarize DEBUG]', {
  mode,
  isMainAudio,
  uri,
  mergedLen: mergedTranscript.length,
  mergedPreview: mergedTranscript.slice(0, 180), // 先看前 180 字就好
    TextPreview: textToSummarize,
  notesLen: (currentItem.notes || '').length,
  textToSummarizeLen: textToSummarize.length,
});


      // ✅ 4. 呼叫 API 產生摘要
      const summary = await summarizeWithMode(textToSummarize, mode, t, { startTime, date });

      // ✅ 5. 寫入資料
      const updated = updateRecordingFields(recordings, index, uri, {
        summaries: {
          ...(currentItem.summaries || {}),
          [mode]: summary,
        },
      });

      await saveRecordings(updated);
      setRecordings(updated);
      setSummaries(
        uri
          ? updated[index].derivedFiles?.splitParts?.find((p) => p.uri === uri)?.summaries || {}
          : updated[index].summaries || {}
      );
      setSummaryMode(mode);
      setViewType('summary');

      // ✅ 6. 扣金幣紀錄
      if (pay && user) {
        await logCoinUsage({
          id: user.id,
          email: user.email,
          name: user.name,
          action: mode,
          value: -COIN_COST_AI,
          note: `${mode}：${currentItem.displayName || ''} 扣 ${COIN_COST_AI} 金幣`,
        });
      }
    } catch (err) {
      Alert.alert(t('summarizeFailedTitle'), (err as Error).message || t('summarizeFailedMessage'));
    } finally {
      setActiveTask(null);
      setSummarizingState(null);
      resetEditingState();
    }
  };


  const handleShare = async () => {
    await shareRecordingNote(currentItem, viewType as 'transcript' | 'summary' | 'notes', summaryMode);
  };

  const content =
    viewType === 'transcript'
      ? (isTranscribing ? partialTranscript : finalTranscript)
      : viewType === 'summary'
        ? summaries?.[summaryMode] || ''
        : currentItem.notes || '';

  // 👉 判斷 Notes 是否為空（顯示提示用）
  const isNotesEmpty =
    viewType === 'notes' && !(currentItem.notes && currentItem.notes.trim().length);

  // 👉 Notes 空白時顯示的灰字提示（僅顯示，不會寫入內容）
  const NotesEmptyPlaceholder = () => (
    <View style={{ gap: 6 }}>
      <Text style={{ color: '#888', fontSize: 14 }}>
        {t('notesPlaceholderLine1')}
      </Text>
      <Text style={{ color: '#888', fontSize: 14 }}>

      </Text>
      <Text style={{ color: '#888', fontSize: 14 }}>
        {t('notesPlaceholderLine2')}
      </Text>

    </View>
  );



  useEffect(() => {
    if (!isEditing) {
      const latestItem = currentItem;
      const newValue =
        viewType === 'transcript' ? latestItem.transcript :
          viewType === 'summary' ? latestItem.summaries?.[summaryMode] || '' :
            latestItem.notes || '';
      setEditValue(newValue || ''); // ✅ 強制轉為 string
    }
  }, [recordings, viewType, summaryMode]);


  const [editingState, setEditingState] = useState<{
    type: 'transcript' | 'summary' | 'name' | 'notes' | null;
    index: number | null;
    uri?: string | null;
    text: string;
    mode?: string;
  }>({ type: null, index: null, text: '', uri: null });
  const valueForNoteBlock =
    isEditing && editingState.type !== 'name' && editingState.type === viewType
      ? editingState.text
      : content;

  const handleDelete = async () => {
    try {
      const updatedItem = { ...currentItem };
      let updatedSummaries = { ...(currentItem.summaries || {}) };

      if (viewType === 'transcript') {
        updatedItem.transcript = '';
        setFinalTranscript('');
        setPartialTranscript('');
        setIsTranscribing(false); // 重置轉文字狀態
      } else if (viewType === 'summary') {
        delete updatedSummaries[summaryMode]; // ⬅️ 刪掉特定 summary mode
        updatedItem.summaries = updatedSummaries;
        setSummaries(updatedSummaries);
      } else if (viewType === 'notes') {
        updatedItem.notes = '';
      }

      const updated = [...recordings];
      updated[index] = updatedItem;
      await saveRecordings(updated);
      setRecordings(updated);
      setEditValue('');
      setRecordings([...updated]); // 強制刷新
      //    Alert.alert('刪除成功', `已刪除 ${viewType === 'summary' ? summaryMode : viewType} 內容`);
    } catch (error) {
      debugError('刪除失敗:', error);
    }

  };

  return (
    <SafeAreaView style={{ backgroundColor: colors.container, flex: 1 }}>

      {/* Header */}

      <RecorderHeader
        mode="detail"
        onBack={() => navigation.goBack()}
        searchQuery={searchKeyword}
        setSearchQuery={setSearchKeyword}
      />


      {/* 播放列 */}
      <View style={[styles.container, { marginTop: 0, paddingBottom: 16 }]}>
        <View
          style={{
            marginTop: -10,
            marginHorizontal: 4,
            paddingHorizontal: 6,
            paddingVertical: 6,
            borderRadius: 10,
            backgroundColor: colors.container,
            borderWidth: 1,
            borderColor: colors.border || colors.primary + '22',
          }}
        >
          <PlaybackBar
            editableName={!uri}  // 只有主音檔可編輯名稱
            editingState={editingState}
            itemIndex={index}
            item={currentItem}
            isPlaying={isPlaying}
            isVisible={true}
            playbackPosition={position}
            playbackDuration={duration}
            playbackRate={playbackRate}
            onPlayPause={togglePlay}
            onSeek={(ms) => {
              if (sound) {
                sound.setCurrentTime(ms / 1000);
                setPosition(ms);
              }
            }}
            onEditRename={(newName) => {
              const updated = [...recordings];

              // 1️⃣ 修改主音檔的 displayName
              const mainItem = updated[index];
              mainItem.displayName = newName;

              // 2️⃣ 如果有 splitParts（子音檔），一起更新 displayName
              const parts = mainItem.derivedFiles?.splitParts;
              if (parts && Array.isArray(parts)) {
                parts.forEach((part) => {
                  const partNameSuffix = part.displayName?.split('|')[1]?.trim(); // 取原本的後綴，例如 "00:00-00:30"
                  part.displayName = partNameSuffix
                    ? `${newName} | ${partNameSuffix}`
                    : `${newName}`; // fallback
                });
              }

              // 3️⃣ 儲存
              setRecordings(updated);
              saveRecordings(updated);
            }}

            onMorePress={(e) => {
              e?.target?.measureInWindow?.((x: number, y: number, width: number, height: number) => {
                if (selectedMenuIndex === index) {
                  setSelectedMenuIndex(null);
                  setMenuVisible(false);
                } else {
                  setSelectedMenuIndex(index);
                  setMenuVisible(true);
                  setMenuPosition({ x, y: y + height });
                }
              });
            }}
            onSpeedPress={(e) => {

              if (speedMenuVisible) {
                setSpeedMenuVisible(false);
                return;
              }
              e?.target?.measureInWindow?.((x: number, y: number, width: number, height: number) => {
                setSpeedMenuVisible(true);
                setSpeedAnchor({ x, y: y + height });
              });
            }}
            styles={styles}
            colors={colors}
            setEditingState={setEditingState}
            setRecordings={setRecordings}
            saveRecordings={saveRecordings}
            renderRightButtons={!uri && editingState.type === 'name' && editingState.index === index ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={saveEditing}>
                  <Text style={[styles.transcriptActionButton, { color: colors.primary }]}>💾</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEditingState({ type: null, index: null, text: '' })}>
                  <Text style={styles.transcriptActionButton}>✖️</Text>
                </TouchableOpacity>
              </View>
            ) : undefined}
          />
        </View>

        {/* 三顆切換按鈕 */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 0, marginTop: 10 }}>
          {['notes', 'transcript', 'summary'].map((key) => {
            const isToolbox = key === 'summary';
            //     const noInputContent = !currentItem.transcript?.trim() && !currentItem.notes?.trim();
            //     const disabled = isToolbox && (noInputContent || isAnyProcessing);


            const isMainAudio = !uri;
            const parts = recordings[index]?.derivedFiles?.splitParts || [];
            const hasSplit = parts.length > 0;

            const hasText = !!currentItem?.transcript?.trim()?.length;

            // 子音檔：這段有文字即可
            const childReady = !isMainAudio && hasText;

            // 短母音檔：主音檔有文字即可
            const shortMainReady = isMainAudio && !hasSplit && hasText;

            // 長母音檔：所有小音檔都有文字（含 placeholder）
            const longMainReady =
              isMainAudio && hasSplit &&
              parts.length > 0 &&
              parts.every((p: any) => (p?.transcript || '').trim().length > 0);

            const canUseToolbox = childReady || shortMainReady || longMainReady;

            const disabled = isToolbox ? (!canUseToolbox || isAnyProcessing) : false;

            return (
              <TouchableOpacity
                key={key}
                ref={isToolbox ? toolboxButtonRef : undefined}
                disabled={disabled}
                onPress={() => {
                  if (disabled) return; // ✅ 不觸發任何動作

                  setViewType(key as any);
                  setEditValue(content);
                  setIsEditing(false);

                  if (key === 'transcript') {
                    if (!currentItem.transcript && !isTranscribing) {
                      handleTranscribe();
                    }
                    setSummaryMenuContext(null);
                  }

                  if (key === 'summary') {
                    if (!currentItem.summaries?.[summaryMode] && !isSummarizing) {
                      handleSummarize(index, summaryMode);
                    }

                    if (summaryMenuContext) {
                      setSummaryMenuContext(null);
                    } else {
                      toolboxButtonRef.current?.measureInWindow((x, y, width, height) => {
                        setSummaryMenuContext({ position: { x, y: y + height } });
                      });
                    }
                  }

                  if (key === 'note') {
                    setSummaryMenuContext(null);
                  }
                }}
                style={{
                  paddingVertical: 4,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor:
                    viewType === key ? colors.primary : colors.primary + '55',
                  opacity: disabled ? 0.3 : 1, // ✅ 灰掉按鈕
                }}
              >
                <Text style={{ color: 'white', fontSize: 13 }}>
                  {key === 'transcript'
                    ? t('transcript')
                    : key === 'summary'
                      ? t('toolbox')
                      : t('notes')}
                </Text>
              </TouchableOpacity>
            );
          })}

        </View>

        {/* 內容區塊 */}
        {renderNoteBlock({
          type: viewType as 'transcript' | 'summary' | 'notes',
          index,
          uri: currentItem.uri,
          value: content,                 // ✅ 原始值（顯示用）
          editValue: valueForNoteBlock,  // ✅ 編輯用
          editingIndex: editingState.index,
          editingUri: editingState.uri,
          onChangeEdit: (text) => {
            setEditingState({
              type: viewType as any,
              index,
              uri: currentItem.uri,
              text,
            });
            setIsEditing(true);
          },
          onSave: saveEditing,
          onCancel: () => setEditingState({ type: null, index: null, text: '', uri: null }),
          onShare: handleShare,
          onDelete: handleDelete,
          editable: !isAnyProcessing,
          styles,
          colors,
          wrapperStyle: {
            maxHeight: isEditing ? 220 : 520,
            width: '96%',
            alignSelf: 'center',
            marginVertical: 10,
          },
          renderContent: () => {
            const isMainAudio = !uri; // 沒有 uri 就是主音檔
            const parts = recordings[index]?.derivedFiles?.splitParts || [];
            const hasAnyPartText = parts.some((p: any) => (p.transcript || '').trim().length > 0);
            // ✅ 條件：母音檔 + 有分段 + 每段都有 transcript
            const allSegmentsTranscribed =
              isMainAudio &&
              parts.length > 0 &&
              parts.every((p: any) => (p?.transcript || '').trim().length > 0);

            // ① Notes 區塊：空就顯示灰字提示
            if (viewType === 'notes' && isNotesEmpty) {
              return <NotesEmptyPlaceholder />;
            }

            // ② Transcript 區塊：主音檔且子段已有逐字稿 → 顯示分段內容清單
            if (viewType === 'transcript' && isMainAudio && hasAnyPartText) {
              return renderSegmentedTranscript();
            }
             // ②-2 Summary 區塊：主音檔 → 顯示分段摘要清單（吃小音檔的摘要）
if (viewType === 'summary' && isMainAudio && summaryMode === 'summary') {
   const parts = recordings[index]?.derivedFiles?.splitParts || [];
   const hasAnyPartSummary = parts.some(
     (p: any) => (p?.summaries?.[summaryMode] || '').trim().length > 0
   );
   if (hasAnyPartSummary) {
     return renderSegmentedSummary(summaryMode as SummarizeMode);
   }
 }

            // ③ 其他情況：走原本 highlight 顯示
            return highlightKeyword(content, searchKeyword, colors.primary + '66');
          },

        })}

        <TopUpModal
          visible={showTopUpModal}
          onClose={() => setShowTopUpModal(false)}
          onSelect={handleTopUp}
          styles={styles}
          colors={colors}
          products={productIds.map(id => ({ id, coins: productToCoins[id] }))} // 傳遞產品資訊
        />
        {/* 登入遮罩 */}
        <LoginOverlay />
        {/* 付款遮罩 */}
        {isTopUpProcessing && (
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
              <Text style={{ color: colors.text, fontSize: 18, marginBottom: 10 }}>  {t('topUpProcessingTitle')}</Text> {/*💰 處理儲值中...*/}
              <Text style={{ color: colors.text, fontSize: 14 }}>  {t('topUpProcessingMessage')}</Text> {/*請稍候，正在驗證與加值*/}
            </View>
          </View>
        )}
      </View>

      {speedMenuVisible && speedAnchor && (
        <View style={{
          position: 'absolute',
          top: speedAnchor.y,
          left: speedAnchor.x - 50,
          backgroundColor: colors.container,
          borderRadius: 8,
          padding: 8,
          elevation: 10,
          zIndex: 9999,
        }}>
          {[0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
            <TouchableOpacity
              key={rate}
              onPress={() => {
                setPlaybackRate(rate);            // 記住用戶選擇的速率
                if (isPlaying && sound) {         // ✅ 只有正在播放才套用速率
                  sound.setSpeed(rate);
                }
                setSpeedMenuVisible(false);       // 關閉選單
              }}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 10,
                backgroundColor: playbackRate === rate ? colors.primary + '33' : 'transparent',
              }}
            >
              <Text style={{ color: colors.text, fontWeight: playbackRate === rate ? 'bold' : 'normal' }}>
                {rate}x
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {menuVisible && menuPosition && (
        <MoreMenu
          index={index}
          item={currentItem}
          title={APP_TITLE}
          isDerived={!!uri}
          position={menuPosition}
          styles={styles}
          closeAllMenus={() => setMenuVisible(false)}
          onRename={() => {
            setEditingState(prepareEditing(recordings, index, 'name', summaryMode));
            setMenuVisible(false);
          }}
          onDelete={handleDelete}
          onShare={async (uri) => {
            await shareRecordingFile(uri);
            setMenuVisible(false);
          }}
          showDelete={false}
        />
      )}
      {summaryMenuContext && (
        <View style={{
          position: 'absolute',
          top: summaryMenuContext.position.y + 4,
          left: summaryMenuContext.position.x - 10,
          right: 8,
          backgroundColor: colors.container,
          borderRadius: 8,
          padding: 8,
          zIndex: 9999,
          elevation: 10,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowOffset: { width: 0, height: 2 },
          shadowRadius: 4,
        }}>
          {getSummarizeModes(t).map((mode) => (
            <TouchableOpacity
              key={mode.key}
              disabled={
                !!summarizingState &&
                summarizingState.index === index &&
                summarizingState.mode === mode.key
              }
              onPress={() => {
                const isBlocked =
                  !!summarizingState &&
                  summarizingState.index === index &&
                  summarizingState.mode === mode.key;

                if (isBlocked) return;

                const isFree = mode.key === 'summary';
                handleSummarize(index, mode.key, !isFree);
                setSummaryMenuContext(null);
              }}

              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                backgroundColor:
                  summaryMode === mode.key
                    ? colors.primary + '50'
                    : currentItem.summaries?.[mode.key]
                      ? colors.primary + '10'
                      : 'transparent',
                borderRadius: 4,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{
                  color:
                    !summaries?.[mode.key] &&
                      !!summarizingState &&
                      summarizingState.index === index &&
                      summarizingState.mode !== mode.key
                      ? colors.text + '66'
                      : colors.text,
                  fontWeight: summaries?.[mode.key] ? 'bold' : 'normal',
                }}>
                  {mode.label}
                </Text>

                {summaries?.[mode.key] && (
                  <Text style={{ color: colors.text, fontSize: 14 }}>✓</Text>
                )}

                {summarizingState?.mode === mode.key && summarizingState.index === index && (
                  <Text style={{ color: colors.primary, fontSize: 14 }}>⏳</Text>
                )}
              </View>
            </TouchableOpacity>

          ))}
        </View>
      )}
    </SafeAreaView>
  );
}