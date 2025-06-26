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
  enhanceAudio, trimSilence,
  transcribeAudio, summarizeWithMode, summarizeModes,
  parseDateTimeFromDisplayName, generateRecordingMetadata,
} from '../utils/audioHelpers';
import type { RootStackParamList } from '../App';
import * as Localization from 'expo-localization';
import { debugLog, debugWarn, debugError } from '../utils/debugLog';
import { handleLogin, loadUserAndSync, COIN_UNIT_MINUTES, COIN_COST_PER_UNIT, COIN_COST_AI } from '../utils/loginHelpers';
import { productIds, productToCoins, purchaseManager, setTopUpProcessingCallback, setTopUpCompletedCallback, waitForTopUp } from '../utils/iap';
import { useFileStorage } from '../utils/useFileStorage';
import { useRecordingContext } from '../constants/RecordingContext';
import TopUpModal from '../components/TopUpModal';
import SplitPromptModal, { splitTimeInSeconds } from '../components/SplitPromptModal';
import LoginOverlay from '../components/LoginOverlay';
import { useLoginContext } from '../constants/LoginContext';
import { APP_TITLE } from '../constants/variant';
import {
  renderFilename,
  renderNoteBlock
} from '../components/AudioItem';
import PlaybackBar from '../components/PlaybackBar';
import MoreMenu from '../components/MoreMenu';
import { shareRecordingNote, shareRecordingFile, saveEditedRecording, deleteTextRecording, prepareEditing } from '../utils/editingHelpers';
import { TouchableWithoutFeedback, Keyboard } from 'react-native';


export default function NoteDetailPage() {
  const navigation = useNavigation();
  const { styles, colors } = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'NoteDetail'>>();
  const { index, type: initialType, summaryMode: initialSummaryMode } = route.params;


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
    } else {
      sound.play(() => {
        setIsPlaying(false);
        setPosition(0);
      });
      setIsPlaying(true);
    }
  };

  const { recordings, setRecordings } = useRecordingContext();

  const currentItem = recordings[index];

  useEffect(() => {
    setSummaries(currentItem.summaries || {});
    setFinalTranscript(currentItem.transcript || '');
  }, [currentItem]);

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
      Alert.alert('購買失敗', err instanceof Error ? err.message : '請稍後再試');
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
    const init = async () => {
      if (route.params.shouldTranscribe && !currentItem.transcript) {
        await handleTranscribe();
      }
    };
    init();
  }, [route.params.shouldTranscribe]);

  useFocusEffect(
    React.useCallback(() => {
      const checkLogin = async () => {
        const stored = await AsyncStorage.getItem('user');
        if (!stored && !isLoggingIn) {
          // ✅ 顯示提示：「尚未登入」
          Alert.alert('尚未登入', '登入後可解鎖 AI 工具箱與錄音文檔轉文字功能');
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
        Alert.alert("請先登入", "使用此功能需要登入", [
          { text: "取消", onPress: () => resolve(false) },
          {
            text: "登入",
            onPress: async () => {
              const result = await handleLogin(setIsLoggingIn);
              if (result) {
                Alert.alert('✅ 登入成功', result.message, [
                  { text: '繼續', onPress: () => resolve(true) }
                ]);
              } else {
                resolve(false);
              }
            }
          }
        ]);
      });

      // 如果登入失敗或取消，直接返回 false
      if (!loginResult) return false;

      // 登入成功後重新獲取用戶資料
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
      Alert.alert("金幣不足", `此操作需要 ${requiredCoins} 金幣，你目前剩餘 ${user.coins} 金幣`, [
        { text: "取消", style: "cancel", onPress: () => resolve(false) },
        {
          text: "立即儲值",
          onPress: async () => {
            setShowTopUpModal(true);
            const coinsAdded = await waitForTopUp(); // 等待儲值完成
            const refreshed = await AsyncStorage.getItem('user');
            const updatedUser = refreshed ? JSON.parse(refreshed) : user;
            resolve(updatedUser.coins >= requiredCoins);
          }
        }
      ]);
    });
  };

  const saveEditing = () => {
    if (editingState.index === null) return;

    const updated = saveEditedRecording(recordings, editingState, summaryMode);
    const newItem = updated[editingState.index];

    // 更新全局 recordings
    setRecordings(updated);
    saveRecordings(updated);

    // 確保畫面也用上最新資料
    setEditValue(
      viewType === 'transcript' ? newItem.transcript || '' :
        viewType === 'summary' ? newItem.summaries?.[summaryMode] || '' :
          newItem.notes || ''
    );

    setEditingState({ type: null, index: null, text: '' });
  };


  //轉文字邏輯
  const handleTranscribe = async (): Promise<void> => {

    if (isTranscribing) return; // ✅ 避免同時跑兩個
    setIsTranscribing(true);

    // ✅ 如果已有逐字稿，就不重複處理
    const currentItem = recordings[index];
    if (currentItem?.transcript) return;

    try {
      setIsTranscribing(true);
      setPartialTranscript('正在轉文字...');

      //先確認音檔長度跟需要金額
      const durationSec = await new Promise<number>((resolve, reject) => {
        const sound = new Sound(currentItem.uri, '', (error) => {
          if (error) {
            reject(new Error("無法載入音訊：" + error.message));
            return;
          }
          const duration = sound.getDuration();
          sound.release(); // ✅ 記得釋放資源
          if (duration === 0) {
            reject(new Error("無法取得音檔長度"));
          } else {
            resolve(Math.ceil(duration));
          }
        });
      });
      // ✅ 計算所需金幣數量
      const coinsToDeduct = Math.ceil(durationSec / (COIN_UNIT_MINUTES * 60)) * COIN_COST_PER_UNIT;
      // ✅ 確認金幣夠不夠，不夠會跳儲值
      const ok = await ensureCoins(coinsToDeduct);
      if (!ok) return;
      // ✅ 取得使用者資訊
      const stored = await AsyncStorage.getItem('user');
      const user = JSON.parse(stored!);
      // ✅ 呼叫 Whisper API 轉文字，並逐段顯示文字
      const result = await transcribeAudio(currentItem, (updatedTranscript) => {
        setPartialTranscript(updatedTranscript); // ✅ 畫面立即顯示
      }, userLang.includes('CN') ? 'cn' : 'tw');

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
        Alert.alert("轉換成功，但扣金幣失敗", coinResult.message || "請稍後再試");
      }

      // 確認音檔是否有效
      const rawText = result?.transcript?.text?.trim() || '';
      const summaryLang = userLang.includes('CN') ? 'cn' : 'tw';

      if (!rawText) {
        const placeholder = '<未偵測到有效語音內容>';

        const updatedItem: RecordingItem = {
          ...currentItem,
          transcript: placeholder,
        };

        const updated = [...recordings];
        updated[index] = updatedItem;
        await saveRecordings(updated);
        setRecordings(updated);
        setFinalTranscript(placeholder);
        setPartialTranscript('');
        return;
      }

      const notesText = currentItem.notes || '';
      const totalTextLength = (rawText + notesText).trim().length;

      if (totalTextLength < 20) {
        const autoSummaries: Record<string, string> = {};
        summarizeModes.forEach(mode => {
          autoSummaries[mode.key] = '內容缺乏足夠資訊分析';
        });

        const updatedItem: RecordingItem = {
          ...currentItem,
          transcript: rawText,
          summaries: autoSummaries,
        };

        const updated = [...recordings];
        updated[index] = updatedItem;

        await saveRecordings(updated);
        setRecordings(updated);

        setFinalTranscript(rawText);
        setPartialTranscript('');
        setSummaries(autoSummaries);
        setSummaryMode('summary');
        setViewType('summary');
        return;
      }


      // ✅ 先存 transcript
      const updatedItem = {
        ...currentItem,
        transcript: rawText,
      };
      const updated = [...recordings];
      updated[index] = updatedItem;
      await saveRecordings(updated);
      setRecordings(updated);
      setFinalTranscript(rawText); // ✅ 可以先顯示

      // ✅ transcript 確保儲存後，再跑摘要
      const summary = await summarizeWithMode(rawText, 'summary', summaryLang);

      // ✅ 接著補寫 summary
      const updatedWithSummary = {
        ...updatedItem,
        summaries: {
          ...(updatedItem.summaries || {}),
          summary,
        },
      };
      const finalUpdated = [...updated];
      finalUpdated[index] = updatedWithSummary;
      await saveRecordings(finalUpdated);
      setRecordings(finalUpdated);
      setSummaries(updatedWithSummary.summaries || {});
      setSummaryMode('summary');
      setViewType('summary');
    } catch (err) {
      Alert.alert("❌ 錯誤", (err as Error).message || "轉換失敗，這次不會扣金幣");
    } finally {
      setIsTranscribing(false);
    }
  };

  // 重點摘要AI工具箱邏輯
  const handleSummarize = async (
    index: number,
    mode: 'summary' | 'tag' | 'action' = 'summary',
    requirePayment?: boolean
  ): Promise<RecordingItem | null> => {
    const pay = requirePayment ?? (mode !== 'summary'); // ← 決定實際是否要扣金幣

    const item = recordings[index];
    let startTime = '';
    let date = '';

    if (item.date) {
      const dateObj = new Date(item.date);
      startTime = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}:${dateObj.getSeconds().toString().padStart(2, '0')}`;
      date = `${dateObj.getFullYear()}/${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
    } else {
      // fallback：從 displayName 擷取
      const parsed = parseDateTimeFromDisplayName(item.displayName || '');
      if (parsed.startTime) startTime = parsed.startTime;
      if (parsed.date) date = parsed.date;
    }

    debugLog('1', mode);

    // ✅ 已有摘要就直接顯示
    if (currentItem.summaries?.[mode]) {
      setSummaryMode(mode);
      //setShowTranscriptIndex(null);
      //setShowSummaryIndex(index);
      return item;
    }

    debugLog('2', mode);
    let user: any = null;

    if (pay) {
      const ok = await ensureCoins(COIN_COST_AI);
      if (!ok) return null;

      const fresh = await AsyncStorage.getItem('user');
      if (!fresh) {
        Alert.alert("錯誤", "無法取得使用者資料");
        return null;
      }
      user = JSON.parse(fresh);
    }

    // ✅ 開始處理摘要
    setSummarizingState({ index, mode });
    try {
      const fullPrompt = currentItem.notes?.trim()
        ? `使用者補充筆記：${currentItem.notes} 錄音文字如下：${currentItem.transcript}`
        : currentItem.transcript || '';

      const summary = await summarizeWithMode(
        fullPrompt,
        mode,
        userLang.includes('CN') ? 'cn' : 'tw',
        { startTime, date }
      );

      const updatedItem = {
        ...recordings[index],
        summaries: {
          ...(recordings[index].summaries || {}),
          [mode]: summary,
        },
      };

      setRecordings(prev => {
        const newRecordings = [...prev];
        newRecordings[index] = updatedItem;
        saveRecordings(newRecordings);
        setSummaries(updatedItem.summaries);
        return newRecordings;
      });


      // ✅ 顯示摘要
      setSummaryMode(mode);
      debugLog('7', mode);

      if (pay && user) {

        await logCoinUsage({
          id: user.id,
          email: user.email,
          name: user.name,
          action: mode,
          value: -COIN_COST_AI,
          note: `${mode}：${item.displayName || item.displayName} 扣 ${COIN_COST_AI} 金幣`,
        });
      }
      debugLog('8', mode);
    } catch (err) {
      Alert.alert("❌ 摘要失敗", (err as Error).message || "處理失敗");
    } finally {
      setSummarizingState(null);
    }
    return null;
  };


  const handleShare = async () => {
    await shareRecordingNote(recordings[index], viewType as 'transcript' | 'summary' | 'notes', summaryMode);
  };

  const content =
    viewType === 'transcript'
      ? (isTranscribing ? partialTranscript : finalTranscript)
      : viewType === 'summary'
        ? summaries?.[summaryMode] || ''
        : currentItem.notes || '';

  useEffect(() => {
    if (!isEditing) {
      const latestItem = recordings[index];
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
    text: string;
    mode?: string;
  }>({ type: null, index: null, text: '' });

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
      Alert.alert('刪除成功', `已刪除 ${viewType === 'summary' ? summaryMode : viewType} 內容`);

    } catch (error) {
      console.error('刪除失敗:', error);
      Alert.alert('刪除失敗', '刪除內容時發生錯誤');
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
            editableName={true}
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
              updated[index].displayName = newName;
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
            renderRightButtons={editingState.type === 'name' && editingState.index === index ? (
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
          {['note', 'transcript', 'summary'].map((key) => (
            <TouchableOpacity
              key={key}
              ref={key === 'summary' ? toolboxButtonRef : undefined}
              onPress={() => {
                setViewType(key as any);
                setEditValue(content);
                setIsEditing(false);

                if (key === 'transcript') {
                  // ✅ 自動轉文字
                  if (!currentItem.transcript && !isTranscribing) {
                    handleTranscribe();
                  }
                  setSummaryMenuContext(null); // 確保工具箱收起
                }

                if (key === 'summary') {
                  if (!currentItem.summaries?.[summaryMode] && !isSummarizing) {
                    handleSummarize(index, summaryMode as 'summary' | 'tag' | 'action');
                  }

                  // ✅ 開關 AI 工具箱選單
                  if (summaryMenuContext) {
                    setSummaryMenuContext(null); // 再次點擊自動收起
                  } else {
                    toolboxButtonRef.current?.measureInWindow((x, y, width, height) => {
                      setSummaryMenuContext({ position: { x, y: y + height } }); // 工具箱顯示位置
                    });
                  }
                }

                if (key === 'note') {
                  setSummaryMenuContext(null); // 工具箱切換時關閉
                }
              }}
              style={{
                paddingVertical: 4,
                paddingHorizontal: 12,
                borderRadius: 8,
                backgroundColor: viewType === key ? colors.primary : colors.primary + '55',
              }}
            >
              <Text style={{ color: 'white', fontSize: 13 }}>
                {key === 'transcript' ? '錄音文檔' : key === 'summary' ? 'AI工具箱' : '談話筆記'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>


        {/* 內容區塊 */}
        {renderNoteBlock({
          type: viewType as 'transcript' | 'summary' | 'notes',
          index,
          value: content,
          editingIndex: editingState.type === viewType && editingState.index === index ? index : null,
          editValue: editingState.text,
          onChangeEdit: (text) => {
            setEditingState({ type: viewType as any, index, text });
          },
          onSave: saveEditing,
          onCancel: () => setEditingState({ type: null, index: null, text: '' }),
          onShare: handleShare,
          onDelete: handleDelete,
          styles,
          colors,
          wrapperStyle: {
            maxHeight: 550,
            width: '96%',
            alignSelf: 'center',
            marginVertical: 10,
          },
          renderContent: () =>
            highlightKeyword(content, searchKeyword, colors.primary + '66')
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
              <Text style={{ color: colors.text, fontSize: 18, marginBottom: 10 }}>💰 處理儲值中...</Text>
              <Text style={{ color: colors.text, fontSize: 14 }}>請稍候，正在驗證與加值</Text>
            </View>
          </View>
        )}
        {/* 分割音檔 
                          <SplitPromptModal
                            visible={showSplitPrompt}
                            onCancel={() => {
                              setShowSplitPrompt(false);
                              setPendingTranscribe(null);
                            }}
                            onSplit={async () => {
                              if (!pendingTranscribe) return;
                              setShowSplitPrompt(false);
                              const item = recordings[pendingTranscribe.index];
                              const parts = await splitAudioByInterval(item.uri);
                              // 加入主列表
                              const newItems = parts.map(p => ({
                                ...p,
                                date: new Date().toISOString(),
                              }));
                              setRecordings(prev => [...newItems, ...prev]);
                              setPendingTranscribe(null);
                            }}
                            onFull={async () => {
                              if (!pendingTranscribe) return;
                              setShowSplitPrompt(false);
                              await handleTranscribe(pendingTranscribe.index); // ⬅️ forceFull
                              setPendingTranscribe(null);
                            }}
                          />*/}

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
          {summarizeModes.map((mode) => (
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
                handleSummarize(index, mode.key as 'summary' | 'tag' | 'action', !isFree);
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