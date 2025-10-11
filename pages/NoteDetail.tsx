// NoteDetail.tsx
// 問題是繼續使用 import Sound from 'react-native-sound'; 
// 其實不需要改 import expo-audio 應該跟 recorderlist 一樣去引用 useAudioPlayer 但改了幾次改不掉先放著
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Alert, Share } from 'react-native';
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
  RecordingItem, summarizeItemWithMode,
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
import { APP_TITLE, SEGMENT_DURATION, setSegmentDuration } from '../constants/variant';
import {
  renderFilename,
  renderNoteBlock
} from '../components/AudioItem';
import PlaybackBar from '../components/PlaybackBar';
import MoreMenu from '../components/MoreMenu';
import { shareRecordingNote, shareRecordingFile, saveEditedRecording, deleteTextRecording, prepareEditing } from '../utils/editingHelpers';
import { TouchableWithoutFeedback, Keyboard } from 'react-native';
import { useTranslation } from '../constants/i18n';

// ---- 全域：記錄正在跑轉寫的 uri，避免未完成又被重觸發 ----
const __VN_RUNNING_SET: Set<string> =
  (global as any).__VN_RUNNING_SET || new Set<string>();
(global as any).__VN_RUNNING_SET = __VN_RUNNING_SET;


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

  // 切分音檔
  useEffect(() => {
  AsyncStorage.getItem('VN_SEGMENT_DURATION').then(v => {
    if (v) setSegmentDuration(Number(v));
  });
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

    //

    const segments = parts.map((p: any) => {
      const text = (p?.transcript || '').trim();
      return {
        name: p.displayName || p.name || 'Segment',
        text: text || t('transcribingInProgress'), // 先佔位
      };
    });

    if (segments.length === 0) return null;

    return (
      <View style={{ gap: 12 }}>
        {segments.map((seg: { name: string | number | boolean | React.ReactElement<any, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | React.ReactPortal | null | undefined; text: string | number | boolean | React.ReactElement<any, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | React.ReactPortal | null | undefined; }, i: any) => (
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
  type SummarizeMode = typeof summarizeModes[number]['key'];

  type Segment = {
    uri: string;
    name: string;
    text: string;
  };

  const renderSegmentedSummary = (mode: SummarizeMode = 'summary') => {
    const parts = recordings[index]?.derivedFiles?.splitParts ?? [];

    // ✅ 明確轉成字串，避免 ReactNode / undefined
    const segments: Segment[] = parts
      .map((p: any) => ({
        uri: String(p.uri ?? ''),
        name: String(p.displayName ?? p.name ?? 'Segment'),
        text: String(p?.summaries?.[mode] ?? '').trim(),
      }))
      .filter((s: { text: string | any[]; }) => s.text.length > 0);

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

            {/* ✎ 編輯該段摘要 */}
            <TouchableOpacity
              onPress={() => {
                setEditingState({
                  type: 'summary',
                  index,
                  uri: seg.uri,      // ← 子音檔
                  text: seg.text,    // ← 明確是 string
                  mode,              // ← 當前模式
                });
                setIsEditing(true);
              }}
              style={{ alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 8 }}
            >
              <Text style={[styles.transcriptActionButton, { color: colors.primary }]}>
                ✎ {t('edit')}
              </Text>
            </TouchableOpacity>
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
        let lastFlush = 0;
        const r = await transcribeAudio(
          part,
          (liveText?: string) => {
            const now = Date.now();
            if (!liveText) return;

            // 小節流，避免每個 token 都重繪
            if (now - lastFlush < 250) return;
            lastFlush = now;

            // 將即時文字直接寫到「這個小音檔」的 transcript
            // ✅ 只 setRecordings，不立即 saveRecordings（減少 I/O）
            const temp = updateRecordingFields(
              (recordingsInput ?? recordings),
              index,
              part.uri,
              { transcript: String(liveText).trim() }
            );
            setRecordings(temp);
          },
          lang,
          t
        );
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
          const segmentSummary = await summarizeItemWithMode(
            { ...part, transcript: text },   // 確保帶到剛轉出的文字
            'summary',
            t,
            { startTime, date },
            { mergeSplitParts: false, withLabels: true }
          );


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
// ✅ 先量測該子檔實際長度；失敗才回退 part.durationSec / SEGMENT_DURATION
let measuredSec = 0;
try {
  measuredSec = await new Promise<number>((resolve, reject) => {
    const s = new Sound(part.uri, '', (err) => {
      if (err) return resolve(0); // 量不到就回 0，後面會有 fallback
      const d = Math.ceil(s.getDuration());
      s.release();
      resolve(isFinite(d) && d > 0 ? d : 0);
    });
  });
} catch { /* ignore */ }

const segmentDurationSec =
  measuredSec > 0
    ? measuredSec
    : Math.ceil(part?.durationSec ?? SEGMENT_DURATION);

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
    setSummaryMode('summary');
    setViewType('summary'); // ✅ 完成就跳到重點整理清單（顯示子段的摘要）
    return updated;
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
// ✅ 不再取 min，上限去掉，直接累計該段實際秒數
remain += sec;
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
      const modeKey = editingState.mode || summaryMode; // ← 以編輯時的 mode 為主

      const targetItem = editingState.uri
        ? recordings[index].derivedFiles?.splitParts?.find((p: { uri: string }) => p.uri === editingState.uri)
        : recordings[index];

      updatePayload.summaries = {
        ...(targetItem?.summaries || {}),
        [summaryMode]: editingState.text,
      };
    } else {
      updatePayload[editingState.type!] = editingState.text;
    }

    const updated = updateRecordingFields(
      recordings,
      index,
      editingState.uri ?? undefined,  // ✅ null 轉成 undefined
      updatePayload
    );


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

// 本次操作的唯一 key（分段用子檔 uri；母檔用母檔 uri）
const transcribeKey = String(uri ?? recordings[index]?.uri ?? '');

// ---- 防重複觸發（尚未完成）----
try {
  if (transcribeKey && __VN_RUNNING_SET.has(transcribeKey)) {
    // 同一段還在跑，直接略過這次按鈕
    setActiveTask(null);
    setIsTranscribing(false);
    return;
  }
  if (transcribeKey) __VN_RUNNING_SET.add(transcribeKey); // 開始：上鎖
} catch {}


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
            try {
  const key = String(uri ?? recordings[index]?.uri ?? '');
  if (key) __VN_RUNNING_SET.delete(key);
} catch {}

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
          try {
  const key = String(uri ?? recordings[index]?.uri ?? '');
  if (key) __VN_RUNNING_SET.delete(key);
} catch {}

          return;
        }
// ✅ 小音檔估價用實際長度
remainingSec = durationSec;

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
        try {
  const key = String(uri ?? recordings[index]?.uri ?? '');
  if (key) __VN_RUNNING_SET.delete(key);
} catch {}

        return;
      }

      // 先驗餘額
      const ok = await ensureCoins(coinsToDeduct);
      if (!ok) {
        setIsTranscribing(false);
        setActiveTask(null);
        try {
  const key = String(uri ?? recordings[index]?.uri ?? '');
  if (key) __VN_RUNNING_SET.delete(key);
} catch {}

        return;
      }

      let storedAfter = await AsyncStorage.getItem('user');
let userAfter = storedAfter ? JSON.parse(storedAfter) : null;

      if (isMainAudio && !alreadySplit && NEED_AUTO_SPLIT) {
        setPartialTranscript(t('splittingInProgress')); // 顯示「分段中…」

        const parent = recordings[index];
        const segmentLength = SEGMENT_DURATION;
        const totalSegments = Math.ceil(durationSec / segmentLength);

        // 先把 splitParts 初始化為空陣列，讓 UI 立刻進入「分段清單」模式
        let updated = [...recordings];
        updated[index] = {
          ...parent,
          derivedFiles: { ...(parent.derivedFiles || {}), splitParts: [] },
        };
        setRecordings(updated);
        await saveRecordings(updated);
        setViewType('transcript'); // 讓 NoteDetail 直接顯示分段（未出字會顯示「轉寫中…」）

        // 逐段：切一段 → 寫進 splitParts → 立刻轉字這一段
        for (let seg = 0, start = 0; start < durationSec; seg++, start += segmentLength) {
          try {
            const part = await splitAudioSegments(parent.uri, start, segmentLength, t, parent.displayName);
            if (!part) continue;

            

// 取得母音檔暫存的分段筆記
const temp = (parent as any).tempNoteSegs || [];
// 把第 seg 段的文字下放到這個子段
part.notes = (temp[seg]?.text || '').trim();


            // ✅ 複製主音檔 notes 到小音檔（避免重複才複製）
            if (!part.notes?.trim() && parent.notes?.trim()) {
              part.notes = parent.notes;
            }
            // ① 立刻把這段 append 到 splitParts（畫面上會看到新的一段）
            updated = [...updated];
            const parentNow = updated[index];
            const partsNow = parentNow?.derivedFiles?.splitParts || [];
            updated[index] = {
              ...parentNow,
              derivedFiles: { ...(parentNow.derivedFiles || {}), splitParts: [...partsNow, part] },
            };
            setRecordings(updated);
            await saveRecordings(updated);

            // ② 立刻只轉「這一段」
            // （提示可選：顯示第 seg+1 / totalSegments 進度）
            setPartialTranscript(
              t('segmentTranscribingProgress', { current: seg + 1, total: totalSegments })
            );
            const updatedAfter = await transcribeMissingSplitParts([part], updated);
            if (updatedAfter) {
              updated = updatedAfter; // ★ 用最新 recordings 當下一輪基準，避免覆蓋掉已寫入的 transcript
            }

            // 註：transcribeMissingSplitParts 內會負責剪靜音/上傳/回寫 transcript & summary/扣金幣
            //     也會在結尾把 partialTranscript 清掉、把畫面保持在 transcript 分段清單

          } catch (e) {
            // 單段失敗就略過，避免卡住整體流程
          }
        }

        setPartialTranscript('');
        setIsTranscribing(false);
        setActiveTask(null);
        return; // ← 別再往下跑整檔轉寫
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


      if (userAfter) {
  const coinResult = await logCoinUsage({
    id: userAfter.id,
    email: userAfter.email,
    name: userAfter.name,
    action: 'transcript',
    value: -coinsToDeduct,
    note: `轉文字：${currentItem.displayName || currentItem.name || ''}，長度 ${durationSec}s，扣 ${coinsToDeduct} 金幣`
  });
  if (!coinResult.success) {
    debugWarn("轉換成功，但扣金幣失敗", coinResult.message || "請稍後再試");
  }
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
        try {
  const key = String(uri ?? recordings[index]?.uri ?? '');
  if (key) __VN_RUNNING_SET.delete(key);
} catch {}


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

      const summary = await summarizeItemWithMode(
        updatedItem,                 // 剛寫回 transcript 的主檔或子檔
        'summary',
        t,
        { startTime, date },
        { mergeSplitParts: false, withLabels: true }
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
      try { if (transcribeKey) __VN_RUNNING_SET.delete(transcribeKey); } catch {}
      setActiveTask(null);
      setIsTranscribing(false);
    }
  };

  // 判斷母音檔現有摘要是否「可用」：可用就直接用，不要重生；不可用才重生
function isStaleMainSummary(cacheText: string, mode: string): boolean {
  const t = (cacheText || '').trim();

  // 1) 太短通常是舊 bullet 或 placeholder
  if (t.length < 120) return true;

  // 2) 典型舊 bullet/placeholder 關鍵字（你 log 裡出現過）
  const badPhrases = [
    '以下是錄音內容的重點摘要', '在這次的講座中，主要討論了以下幾個重點',
    '重點摘要：', '以下內容是一份「已整理好的重點」', '以下是逐字稿的重點摘要',
  ];
  if (badPhrases.some(p => t.includes(p))) return true;

  // 3) 沒有任何段落標記/內容痕跡（你聚合素材常見「【段落名】」）
  const hasSegmentMark = t.includes('【');
  if (!hasSegmentMark) {
    // 如果沒有段落標記，且幾乎都是「• 」開頭的清單，也視為舊格式
    const bulletOnly = t.split('\n').filter(Boolean).every(line => line.trim().startsWith('•'));
    if (bulletOnly) return true;
  }

  // 4) 若有你自己的「生成時間/標章」可加更準（此處略）
  return false; // 不舊 → 可用
}

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
      // 1) 已經有摘要 → 直接顯示

      const isMainAudio = !uri;
const hasSplits = !!recordings[index]?.derivedFiles?.splitParts?.length;
const cacheText = String(currentItem.summaries?.[mode] ?? '').trim();
const hasCache = cacheText.length > 0;

debugLog('[Summarize] enter', {
  mode, isMainAudio, hasSplits, hasCache,
  cachePreview: cacheText.slice(0, 100),
});

// 子音檔：有快取 → 直接顯示
if (!isMainAudio && hasCache) {
  setSummaryMode(mode);
  setViewType('summary');
  return;
}

// ✅ 母音檔（未切段）：只要有快取就直接顯示（不做舊稿判斷）
if (isMainAudio && !hasSplits && hasCache) {
  setSummaryMode(mode);
  setViewType('summary');
  return;
}

// ✅ 母音檔（已切段）：有快取且不是「舊格式」→ 直接顯示；否則才重生
if (isMainAudio && hasSplits && hasCache && !isStaleMainSummary(cacheText, mode)) {
  setSummaryMode(mode);
  setViewType('summary');
  return;
}

// 其餘情況（沒快取、或切段母音檔快取是舊稿）→ 才進入重生
debugLog('[Summarize] regenerate: no cache or stale main');

      // 2) 需要金幣就先檢查
      let user: any = null;
      if (pay) {
        const ok = await ensureCoins(COIN_COST_AI);
        if (!ok) return;
        const stored = await AsyncStorage.getItem('user');
        if (!stored) throw new Error(t('userDataUnavailable'));
        user = JSON.parse(stored);
      }

      // 3) 時間資訊
      const dateObj = currentItem.date ? new Date(currentItem.date) : null;
      const startTime = dateObj
        ? `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`
        : '';
      const date = dateObj
        ? `${dateObj.getFullYear()}/${dateObj.getMonth() + 1}/${dateObj.getDate()}`
        : '';

      // 4) 只在這裡宣告一次 isMainAudio，並決定 targetItem
      const targetItem = isMainAudio ? recordings[index] : currentItem;

      // （可選）除錯資訊
      debugLog('[Summarize DEBUG]', {
        mode,
        isMainAudio,
        uri,
        title: targetItem.displayName || targetItem.name || '',
        notesLen: (targetItem.notes || '').length,
        hasSplit: !!targetItem?.derivedFiles?.splitParts?.length,
      });

      // 5) 呼叫 helpers：會自動把「標題＋筆記＋逐字稿」組成輸入
      // 主音檔用「聚合素材」，避免只有段落標題
let summary: string;

if (isMainAudio) {
  if (hasSplits) {
    // ✅ 已切段的母音檔：用聚合素材重生
    const material = buildAggregatedMaterialForMode(recordings, index, mode);
    const synthetic = { ...currentItem, transcript: material };
    synthetic.summaries = {}; // 只在重生時清（這裡一定是要重生的分支）
    debugLog('[Summarize] using aggregated material', {
      mode, materialLen: material.length, materialHead: material.slice(0, 200),
    });
    summary = await summarizeItemWithMode(
      synthetic,
      mode,
      t,
      { startTime, date },
      { mergeSplitParts: false, withLabels: true }
    );
  } else {
    // ✅ 未切段的母音檔：用本檔 transcript 直接生成（不聚合、也不清 summaries）
    summary = await summarizeItemWithMode(
      currentItem,
      mode,
      t,
      { startTime, date },
      { mergeSplitParts: false, withLabels: true }
    );
  }
} else {
  // 子音檔照舊
  summary = await summarizeItemWithMode(
    currentItem,
    mode,
    t,
    { startTime, date },
    { mergeSplitParts: false, withLabels: true }
  );
}
      // 6) 寫回資料
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

      // 7) 扣金幣紀錄
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

  // ✅ 依「模式」組成最終要給 AI 的素材：優先用各子段的 summaries[mode]，沒有才回退 transcript
  function buildAggregatedMaterialForMode(
    recordings: any[],
    index: number,
    mode: string
  ): string {
    const main = recordings[index];
    if (!main) return '';

    const parts = main?.derivedFiles?.splitParts || [];
    const lines: string[] = [];

    // （可選）母檔自己該 mode 的摘要，當成前言
    const parent = String(main?.summaries?.[mode] ?? '').trim();
    if (parent) lines.push(parent);

    // 每段：顯示時間/標題 + 內容（優先用 summaries[mode]；沒有才用 transcript）
    for (const p of parts) {
      const title = String(p.displayName ?? p.name ?? 'Segment');
      const text =
        String(p?.summaries?.[mode] ?? '').trim() ||
        String(p?.transcript ?? '').trim();
      if (text) {
        lines.push(`【${title}】\n${text}`);
      }
    }

    // 如果沒有分段，就回退用主檔 transcript
    if (lines.length === 0) {
      const fallback = String(main?.transcript ?? '').trim();
      if (fallback) lines.push(fallback);
    }

    return lines.filter(Boolean).join('\n\n').trim();
  }

  function buildAggregatedContentForMainSummary(
    recordings: any[],
    index: number,
    mode: string,
    heading?: string
  ): string {
    const main = recordings[index];
    if (!main) return '';

    const parent = (main?.summaries?.[mode] || '').trim(); // 主檔整檔條列（summary 模式會用到）
    const parts = main?.derivedFiles?.splitParts || [];

    const lines: string[] = [];
    if (heading) lines.push(heading);

    // 先放主檔整體條列
    if (parent) lines.push(parent);

    // 再逐段詳細（顯示時間/標題 + 內容）
    for (const p of parts) {
      const title = p.displayName || p.name || 'Segment';
      const text = (p?.summaries?.[mode] || '').trim();
      if (text) {
        lines.push(`【${title}】\n${text}`);
      }
    }

    return lines.filter(Boolean).join('\n\n').trim();
  }

  const handleShare = async () => {
    const isMainAudio = !uri;

    // 主音檔 + 工具箱(summary) 視圖：直接分享聚合好的純文字
    if (isMainAudio && viewType === 'summary') {
      const content = buildAggregatedContentForMainSummary(
        recordings,
        index,
        summaryMode,
        `${currentItem.displayName || ''} — ${t('toolbox')}`
      );

      if (!content) {
        Alert.alert(t('error'), t('shareFailed')); // 可換成你的文案
        return;
      }

      try {
        await Share.share({
          title: currentItem.displayName || 'Export',
          message: content, // 直接丟文字
        });
      } catch (e) {
        Alert.alert(t('error'), t('shareFailed'));
      }
      return;
    }

    // 其他情境維持原行為
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
      // 子檔 or 母檔 → 一律用 updateRecordingFields 精準更新
      if (viewType === 'transcript') {
        // 只清掉逐字稿內容，不動其他欄位/物件結構
        const updated = updateRecordingFields(recordings, index, uri, { transcript: '' });

        setFinalTranscript('');
        setPartialTranscript('');
        setIsTranscribing(false);

        await saveRecordings(updated);
        setRecordings(updated);
        return;
      }

      if (viewType === 'summary') {
        // 刪除特定摘要 mode（需要先算出新物件再回寫）
        const target =
          uri
            ? recordings[index].derivedFiles?.splitParts?.find((p: { uri: string; }) => p.uri === uri)
            : recordings[index];

        const nextSummaries = { ...(target?.summaries || {}) };
        delete nextSummaries[summaryMode];

        const updated = updateRecordingFields(recordings, index, uri, { summaries: nextSummaries });
        await saveRecordings(updated);
        setRecordings(updated);
        setSummaries(nextSummaries);
        return;
      }

      if (viewType === 'notes') {
        const updated = updateRecordingFields(recordings, index, uri, { notes: '' });
        await saveRecordings(updated);
        setRecordings(updated);
        return;
      }
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
            //

            const hasSplit = parts.length > 0;
            const mainHasText = !!currentItem?.transcript?.trim()?.length;
            const anyPartHasText = parts.some((p: any) => (p?.transcript || '').trim().length > 0);
            const canUseToolbox = mainHasText || anyPartHasText;

            const disabled = isToolbox ? (!canUseToolbox || isSummarizing) : false;

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
                    const isMainAudio = !uri;

                    // 主音檔 + 預設 summary 模式：僅顯示已產生的小段摘要，不自動跑整檔摘要
                    const shouldAutoSummarize =
                      !isMainAudio && !currentItem.summaries?.[summaryMode] && !isSummarizing;

                    if (shouldAutoSummarize) {
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
            // 
            if (viewType === 'transcript' && isMainAudio && parts.length > 0) {
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
          {getSummarizeModes(t).map((mode) => {
            const isMainAudio = !uri;

            // 🔒 條件：母音檔正在轉文字 → 工具箱全鎖（包括 summary）
            const isLockedByTranscribing = isMainAudio && isTranscribing;

            // 原本「同一模式正在跑」的狀態
            const isBusySame =
              !!summarizingState &&
              summarizingState.index === index &&
              summarizingState.mode === mode.key;

            const isLocked = isLockedByTranscribing || isBusySame;

            // 顯示沙漏：正在轉文字 + 這個模式是 summary
            const showHourglass = isLockedByTranscribing && mode.key === 'summary';

            return (
              <TouchableOpacity
                key={mode.key}
                disabled={isLocked}
                onPress={() => {
                  if (isLocked) return;
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
                  opacity: isLocked ? 0.35 : 1,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text
                    style={{
                      color: isLocked ? colors.text + '66' : colors.text,
                      fontWeight: summaries?.[mode.key] ? 'bold' : 'normal',
                    }}
                  >
                    {mode.label}
                  </Text>

                  {/* 已完成 ✓ */}
                  {summaries?.[mode.key] && (
                    <Text style={{ color: colors.text, fontSize: 14 }}>✓</Text>
                  )}

                  {/* 顯示沙漏 */}
                  {(showHourglass || isBusySame) && (
                    <Text style={{ color: colors.primary, fontSize: 14 }}>⏳</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}


        </View>
      )}
    </SafeAreaView>
  );
}