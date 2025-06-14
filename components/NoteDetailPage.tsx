import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Alert } from 'react-native';
import { RouteProp, useRoute, useNavigation, useFocusEffect,  } from '@react-navigation/native';
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

export default function NoteDetailPage() {
  const navigation = useNavigation();
  const { styles, colors } = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'NoteDetail'>>();
  const { item, index, type: initialType, summaryMode: initialSummaryMode } = route.params as {
    item: any;
    index: number;
    type: 'notes' | 'transcript' | 'summary';
    summaryMode?: 'summary' | 'tag' | 'action';
  };

  const toolboxButtonRef = useRef<View | null>(null);

  const [summaryMode, setSummaryMode] = useState(initialSummaryMode || 'summary');
  const [summaryMenuContext, setSummaryMenuContext] = useState<{ position: { x: number; y: number } } | null>(null);
  const [summaries, setSummaries] = useState(item.summaries || {});
  const [summarizingState, setSummarizingState] = useState<{ index: number; mode: string } | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
const [partialTranscript, setPartialTranscript] = useState('');
const [finalTranscript, setFinalTranscript] = useState(item.transcript || '');

  const [viewType, setViewType] = useState(initialType);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [sound, setSound] = useState<Sound | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // 初始化音檔
  useEffect(() => {
    const s = new Sound(item.uri, '', (error) => {
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
    if (route.params.shouldTranscribe && !item.transcript) {
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
  }, [isLoggingIn])
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

  //轉文字邏輯
const handleTranscribe = async (): Promise<void> => {
    // ✅ 如果已有逐字稿，就不重複處理
    if (item.transcript) return item;


    try {
          setIsTranscribing(true);
    setPartialTranscript('正在轉文字...');
    
      //先確認音檔長度跟需要金額
      const durationSec = await new Promise<number>((resolve, reject) => {
        const sound = new Sound(item.uri, '', (error) => {
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
      const result = await transcribeAudio(item, (updatedTranscript) => {
        setPartialTranscript(updatedTranscript); // ✅ 畫面立即顯示
      }, userLang.includes('CN') ? 'cn' : 'tw');
      // ✅ 自動產生 AI 摘要（只做 summary 模式）
      const summary = await summarizeWithMode(
        result.transcript.text,
        'summary',
        userLang.includes('CN') ? 'cn' : 'tw'
      );

      const skippedMinutes = Math.floor(result.skippedSilentSegments / 2);
      /*if (skippedMinutes > 0) {
        Alert.alert(`已跳過 ${skippedMinutes} 分鐘靜音`,'\n靜音部分不扣金幣');
      } */

      /*   if (!result?.transcript?.text?.trim()) {
           throw new Error("無法取得有效的轉譯結果");
         }*/
      debugLog('✅render 2', skippedMinutes);
      // ✅ 建立更新後的項目資料（含 transcript + summary）
      const updatedItem: RecordingItem = {
        ...item,
        transcript: result.transcript.text,
        summaries: {
          ...(item.summaries || {}),
          summary,
        },
      };

      // ✅ 更新畫面與狀態
      setFinalTranscript(updatedItem.transcript || '');
      setSummaries(updatedItem.summaries);
      setSummaryMode('summary');

      // ✅ 寫入本地檔案 storage
      const updated = [...recordings];
      updated[index] = updatedItem;
      await saveRecordings(updated);

      setRecordings(prev => {
  const newRecordings = [...prev];
  newRecordings[index] = updatedItem;
    saveRecordings(newRecordings);
    setSummaries(updatedItem.summaries); 
  return newRecordings;
});

      // ✅ 紀錄金幣使用
      const coinResult = await logCoinUsage({
        id: user.id,
        email: user.email,
        name: user.name,
        action: 'transcript',
        value: -coinsToDeduct,
        note: `轉文字：${item.displayName || item.name || ''}，長度 ${durationSec}s，扣 ${coinsToDeduct} 金幣`
      });

      if (!coinResult.success) {
        Alert.alert("轉換成功，但扣金幣失敗", coinResult.message || "請稍後再試");
      }
    } catch (err) {
      Alert.alert("❌ 錯誤", (err as Error).message || "轉換失敗，這次不會扣金幣");
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
      const parsed = parseDateTimeFromDisplayName(item.displayName || item.name || '');
      if (parsed.startTime) startTime = parsed.startTime;
      if (parsed.date) date = parsed.date;
    }

    debugLog('1', mode);

    // ✅ 已有摘要就直接顯示
    if (item.summaries?.[mode]) {
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
      const fullPrompt = item.notes?.trim()
        ? `使用者補充筆記：${item.notes} 錄音文字如下：${item.transcript}`
        : item.transcript || '';

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
      //setShowTranscriptIndex(null);
      //setShowSummaryIndex(index);
      debugLog('7', mode);

      if (pay && user) {

        await logCoinUsage({
          id: user.id,
          email: user.email,
          name: user.name,
          action: mode,
          value: -COIN_COST_AI,
          note: `${mode}：${item.displayName || item.name} 扣 ${COIN_COST_AI} 金幣`,
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
    const filename = `${item.displayName || 'note'}.txt`;
    const fileUri = FileSystem.cacheDirectory + filename;

    try {
      await FileSystem.writeAsStringAsync(fileUri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/plain',
        dialogTitle: '分享內容',
        UTI: 'public.text',
      });
    } catch (err) {
      Alert.alert('分享失敗', (err as Error).message);
    }
  };

  const formatTime = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}:${rem.toString().padStart(2, '0')}`;
  };

const content =
  viewType === 'transcript'
    ? (isTranscribing ? partialTranscript || '⏳ 正在轉文字...' : finalTranscript)
    : viewType === 'summary'
      ? summaries?.[summaryMode] || ''
      : item.notes || '';


  const handleSave = () => {
    console.log(`儲存 ${viewType}:`, editValue);
    setIsEditing(false);
  };

  return (
    <View style={[styles.container, { paddingTop: 50, paddingHorizontal: 16 }]}>
      {/* Header */}
      <RecorderHeader
        mode="detail"
        title={item.displayName}
        onBack={() => navigation.goBack()}
      />

      {/* 播放列 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <TouchableOpacity onPress={togglePlay}>
          <Text style={{ fontSize: 24, marginRight: 12 }}>{isPlaying ? '❚❚' : '▶'}</Text>
        </TouchableOpacity>
        <Slider
          minimumValue={0}
          maximumValue={duration}
          value={position}
          onSlidingComplete={(value) => {
            if (sound) {
              sound.setCurrentTime(value / 1000);
              setPosition(value);
            }
          }}
          style={{ flex: 1 }}
        />
        <Text style={{ marginLeft: 8 }}>{formatTime(position)}</Text>
      </View>

      {/* 三顆切換按鈕 */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 12 }}>
        {['note', 'transcript', 'summary'].map((key) => (
          <TouchableOpacity
            key={key}
            ref={key === 'summary' ? toolboxButtonRef : undefined}
            onPress={() => {
              setViewType(key as any);
              setIsEditing(false);

              // ✅ 只有按 summary 才彈出選單
              if (key === 'summary') {
                toolboxButtonRef.current?.measureInWindow((x, y, width, height) => {
                  setSummaryMenuContext({ position: { x, y: y + height } });
                });
              } else {
                setSummaryMenuContext(null); // ❌ 點到其他按鈕要關掉浮層
              }
            }}
            style={{
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: 8,
              backgroundColor: viewType === key ? colors.primary : colors.primary + '55',
            }}
          >
            <Text style={{ color: 'white' }}>
              {key === 'transcript' ? '錄音文檔' : key === 'summary' ? 'AI工具箱' : '談話筆記'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 重點按鈕 */}
      {summaryMenuContext && (
        <View style={{
          position: 'absolute',
          top: summaryMenuContext.position.y,
          left: summaryMenuContext.position.x,
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
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                backgroundColor:
                  summaryMode === mode.key
                    ? colors.primary + '50'
                    : item.summaries?.[mode.key]
                      ? colors.primary + '10'
                      : 'transparent',
                borderRadius: 4,
              }}
              onPress={() => {
                const isFree = mode.key === 'summary';
                handleSummarize(index, mode.key as 'summary' | 'tag' | 'action', !isFree);
              }}
              disabled={summarizingState?.mode === mode.key}
            >
              <Text style={{
                color: colors.text,
                fontWeight: summaries?.[mode.key] ? 'bold' : 'normal',
              }}>
                {mode.label}
                {summaries?.[mode.key] ? ' ✓' : ''}
                {summarizingState?.mode === mode.key ? ' ⏳' : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {/* 內容區塊 */}
      {isEditing ? (
        <>
          <ScrollView keyboardShouldPersistTaps="handled">
            <TextInput
              value={editValue}
              onChangeText={setEditValue}
              multiline
              style={{
                padding: 12,
                fontSize: 16,
                color: colors.text,
                borderWidth: 1,
                borderColor: colors.primary,
                borderRadius: 8,
                textAlignVertical: 'top',
              }}
              autoFocus
            />
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
            <TouchableOpacity onPress={handleSave}>
              <Text style={styles.transcriptActionButton}>💾 儲存</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsEditing(false)}>
              <Text style={styles.transcriptActionButton}>✖️ 取消</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <ScrollView>
            <Text style={styles.transcriptText}>{content}</Text>
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
            <TouchableOpacity onPress={handleShare}>
              <Text style={styles.transcriptActionButton}>📤 分享</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              setEditValue(content);
              setIsEditing(true);
            }}>
              <Text style={styles.transcriptActionButton}>✏️ 修改</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

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
                          {/* 登入遮罩 
                          {isLoggingIn && (
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
                                <Text style={{ color: colors.text, fontSize: 18, marginBottom: 10 }}>🔄 登入中...</Text>
                                <Text style={{ color: colors.text, fontSize: 14 }}>請稍候，正在與 Google 驗證身份</Text>
                              </View>
                            </View>
                          )}*/}
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

    
  );
}
