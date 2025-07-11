// components/RecorderLists.tsx
import React, { useState, useEffect, useRef } from 'react';

import { Platform, PermissionsAndroid } from 'react-native';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView, StatusBar,
  TextInput,
  Alert,
  ActivityIndicator,
  TouchableWithoutFeedback,
  FlatList,
  Dimensions
} from 'react-native';
import SoundLevel from 'react-native-sound-level';
import { useKeepAwake } from 'expo-keep-awake';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import PlaybackBar from './PlaybackBar';
import { NativeModules } from 'react-native';
const { FFmpegWrapper } = NativeModules;
import { APP_TITLE, debugValue, SEGMENT_DURATION } from '../constants/variant';

import {
  RecordingItem, transcribeAudio, summarizeWithMode, summarizeModes, notifyAwsRecordingEvent, SplitPart,
  notitifyWhisperEvent, splitAudioSegments,
  parseDateTimeFromDisplayName, generateDisplayNameParts, generateRecordingMetadata,
} from '../utils/audioHelpers';
import { useFileStorage } from '../utils/useFileStorage';
import { useAudioPlayer } from '../utils/useAudioPlayer';

import MoreMenu from './MoreMenu';
import { handleLogin, loadUserAndSync, COIN_UNIT_MINUTES, COIN_COST_PER_UNIT, COIN_COST_AI } from '../utils/loginHelpers';
import { productIds, productToCoins, purchaseManager, setTopUpProcessingCallback, setTopUpCompletedCallback, waitForTopUp } from '../utils/iap';
import { debugLog, debugWarn, debugError } from '../utils/debugLog';
import { shareRecordingNote, shareRecordingFile, saveEditedRecording, deleteTextRecording, prepareEditing } from '../utils/editingHelpers';
import { useTheme } from '../constants/ThemeContext';
import { useRecordingContext } from '../constants/RecordingContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface Props {
  items: RecordingItem[];
  searchQuery: string;
  setRecordings: React.Dispatch<React.SetStateAction<RecordingItem[]>>;
  isSelectionMode: boolean;
  selectedItems: Set<string>;
  setIsSelectionMode: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedItems: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedPlayingIndex: number | null;
  setSelectedPlayingIndex: React.Dispatch<React.SetStateAction<number | null>>;
  variant?: 'main' | 'sub';
}

const GlobalRecorderState = {
  isRecording: false,
  filePath: '',
  startTime: 0,
};


const RecorderLists: React.FC<Props> = ({
  items,
  searchQuery,
  setRecordings,
  isSelectionMode,
  selectedItems,
  setIsSelectionMode,
  setSelectedItems,
  selectedPlayingIndex,
  setSelectedPlayingIndex,
}) => {
  const { colors, styles, isDarkMode } = useTheme();
  const { recordings } = useRecordingContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const title = APP_TITLE;
  useKeepAwake(); // 保持清醒

  // 核心狀態
  const [recording, setRecording] = useState(false);
  const recordingStartTimestamp = useRef<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const [isTranscribingIndex, setIsTranscribingIndex] = useState<number | null>(null);
  const [summarizingState, setSummarizingState] = useState<{ index: number; mode: string; } | null>(null);
  const [isEditingNotesIndex, setIsEditingNotesIndex] = useState<number | null>(null);
  const isAnyProcessing = isTranscribingIndex !== null || summarizingState !== null || isEditingNotesIndex !== null;
  const [summaryMode, setSummaryMode] = useState('summary');
  const [showNotesIndex, setShowNotesIndex] = useState<number | null>(null);
  const [playbackRates, setPlaybackRates] = useState<Record<string, number>>({});

    const flatListRef = useRef<FlatList>(null);
  const [itemOffsets, setItemOffsets] = useState<Record<number, number>>({});
  const resetEditingState = () => {
    setEditingState({ type: null, index: null, text: '' });
    setIsEditingNotesIndex(null);
  };

  const [summaryMenuContext, setSummaryMenuContext] = useState<{
    index: number;
    position: { x: number; y: number };
  } | null>(null);

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleExpand = async (uri: string) => {
    const found = recordings.find(r => r.uri === uri);
    if (!found) {
      debugWarn(`❌ toggleExpand：找不到錄音 uri: ${uri}`);
      return;
    }

    const hasSplit = found.derivedFiles?.splitParts?.length > 0;

    // 若尚未分段，先進行切割
    if (!hasSplit) {
      debugLog(`🪓 [分段展開] ${found.displayName} 尚未切段，開始切割`);

      const path = uri.replace('file://', '');
      try {
        const metadata = await generateRecordingMetadata(path);
        const totalSec = Math.floor(metadata.durationSec);
        const segmentLength = SEGMENT_DURATION;
        const parts: SplitPart[] = [];

        for (let start = 0; start < totalSec; start += segmentLength) {
          try {
            debugLog(`⏱ 嘗試分段：start=${start}s, duration=${segmentLength}s`);
            const part = await splitAudioSegments(uri, start, segmentLength);
            if (part) {
              debugLog(`✅ 成功分段：${part.displayName}`);
              parts.push(part);
            } else {
              debugWarn(`⚠️ 分段失敗（null）：start=${start}`);
            }
          } catch (e) {
            debugError(`❌ 分段錯誤：start=${start}`, e);
          }
        }

        const updated = recordings.map(r =>
          r.uri === uri
            ? { ...r, derivedFiles: { ...r.derivedFiles, splitParts: parts } }
            : r
        );

        setRecordings(updated);
        await saveRecordings(updated);
        debugLog(`📦 分段完成，共 ${parts.length} 段`);
      } catch (e) {
        debugError(`❌ 分段前 metadata 錯誤: ${path}`, e);
      }
    } else {
      debugLog(`📂 [分段展開] ${found.displayName} 已有 ${found.derivedFiles.splitParts.length} 段，直接展開`);
    }

    // toggle 展開/收合
    setExpandedItems(prev => {
      const copy = new Set(prev);
      copy.has(uri) ? copy.delete(uri) : copy.add(uri);
      return copy;
    });
  };

  const userLang = Localization.getLocales()[0]?.languageTag || 'zh-TW';

  // 音量狀態
  const [currentDecibels, setCurrentDecibels] = useState(-160);
  const recordingTimeRef = useRef(0);

  // 撥放速度
  const pendingPlaybackRateRef = useRef<number>(1.0);

  // 在組件掛載時初始化 IAP
  useEffect(() => {
    const initIAP = async () => {
      const success = await purchaseManager.initialize();
      if (!success) {
        debugWarn('IAP 初始化失敗');
      }
    };
    initIAP();
    return () => {
      purchaseManager.cleanup();
    };
  }, []);

  const [selectedContext, setSelectedContext] = useState<{
    type: 'main' | 'enhanced' | 'trimmed';
    index: number;
    position: { x: number; y: number };
  } | null>(null);

  // 變速播放
  const [speedMenuIndex, setSpeedMenuIndex] = useState<number | null>(null);
  const [speedMenuPosition, setSpeedMenuPosition] = useState<{ x: number; y: number } | null>(null);
  // 轉文字重點摘要
  const [showTranscriptIndex, setShowTranscriptIndex] = useState<number | null>(null);
  const [showSummaryIndex, setShowSummaryIndex] = useState<number | null>(null);

  // 所有的文字編輯宣告
  const [editingState, setEditingState] = useState<{
    type: 'transcript' | 'summary' | 'name' | 'notes' | null;
    index: number | null;
    text: string;
    mode?: string; // ✅ optional，未來加多摘要時會用到
  }>({ type: null, index: null, text: '' });


  const {
    isLoading,
    loadRecordings,
    saveRecordings,
    safeDeleteFile,
    updateRecordingAtIndex
  } = useFileStorage(setRecordings);

  const {
    currentSound,
    isPlaying,
    playingUri,
    currentPlaybackRate,
    setPlaybackRate,
    playbackPosition,
    playbackDuration,
    playRecording,
    togglePlayback,
    setPlaybackPosition,
    stopPlayback,
  } = useAudioPlayer();

  useEffect(() => {
    loadUserAndSync();
  }, []);

  useEffect(() => {
    if (GlobalRecorderState.isRecording) {
      setRecording(true);
      recordingStartTimestamp.current = Date.now();
      const elapsedSec = Math.floor((Date.now() - GlobalRecorderState.startTime) / 1000);
      setRecording(true);
      recordingStartTimestamp.current = Date.now();
      recordingTimeRef.current = Math.floor((Date.now() - GlobalRecorderState.startTime) / 1000);

    }
  }, []);

  // 進度條更新
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isPlaying && currentSound) {
      timer = setInterval(() => {
        currentSound.getCurrentTime((seconds) => {
          setPlaybackPosition(seconds * 1000); // 單位：毫秒
        });
      }, 300); // 每 300 毫秒更新一次
    }
    return () => {
      if (timer) clearInterval(timer);
    };
}, [isPlaying, currentSound, playingUri]);

  useEffect(() => {
    return () => {
      SoundLevel.stop(); // 避免離開頁面還在偵聽
    };
  }, []);


  // 在組件掛載時載入
  useEffect(() => {
    debugLog('🔁 useEffect: 初次掛載，載入錄音');
    loadRecordings();
  }, []);

  // 在錄音列表變更時自動儲存
  useEffect(() => {
    if (!isLoading) {
      saveRecordings(recordings);
    }
  }, [recordings]);

  // 刪除錄音
  const deleteRecording = async (index: number) => {
    Alert.alert(
      "刪除錄音",
      "確定要刪除這個錄音嗎？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "刪除",
          onPress: async () => {
            closeAllMenus();
            try {
              const item = recordings[index];

              // 1. 刪除所有相關音檔
              await safeDeleteFile(item.uri);
              if (item.derivedFiles?.enhanced?.uri) {
                await safeDeleteFile(item.derivedFiles.enhanced.uri);
              }
              if (item.derivedFiles?.trimmed?.uri) {
                await safeDeleteFile(item.derivedFiles.trimmed.uri);
              }
              if (item.derivedFiles?.splitParts?.length) {
                for (const part of item.derivedFiles.splitParts) {
                  await safeDeleteFile(part.uri);
                }
              }

              // 2. 更新 state 並立即儲存
              const updated = [...recordings];
              updated.splice(index, 1);
              setRecordings(updated);

              // 3. 強制寫入 JSON 檔案
              await saveRecordings(updated);

              // 4. 手動刪除外部備份中的對應記錄 (可選)
              try {
                const backupPath = `${RNFS.ExternalDirectoryPath}/recordings_backup.json`;
                if (await RNFS.exists(backupPath)) {
                  const backupContent = await RNFS.readFile(backupPath, 'utf8');
                  const backupData = JSON.parse(backupContent);
                  const updatedBackup = backupData.filter((rec: RecordingItem) => rec.uri !== item.uri);
                  await RNFS.writeFile(backupPath, JSON.stringify(updatedBackup), 'utf8');
                }
              } catch (backupErr) {
                debugWarn("無法更新備份檔案:", backupErr);
              }

            } catch (err) {
              Alert.alert("刪除失敗", (err as Error).message);
            }
          }
        }
      ]
    );
    setSelectedIndex(null);
  };

  // 關閉所有彈出菜單
  const closeAllMenus = (options: {
    preserveEditing?: boolean;
    preserveSummaryMenu?: boolean;
  } = {}) => {
    const { preserveEditing = false, preserveSummaryMenu = false } = options;
    setSelectedIndex(null);
    setSpeedMenuIndex(null);
    setSelectedContext(null);

    if (!preserveSummaryMenu) {
      setSummaryMenuContext(null); // ✅ 保留一次就好
    }

    if (!preserveEditing) {
      resetEditingState();
    }
  };

  // 所有的文字編輯邏輯
  // 確保 startEditing 函數正確處理
  const startEditing = (index: number, type: 'name' | 'transcript' | 'summary' | 'notes') => {
    const editing = prepareEditing(recordings, index, type, summaryMode);
    if (editing) {
      setEditingState(editing);
      setSelectedIndex(null);
    } else {
      debugError('Failed to prepare editing state');
    }
  };

  // 確保 saveEditing 函數正確處理
  const saveEditing = () => {
    try {
      const updated = saveEditedRecording(recordings, editingState, summaryMode);
      if (updated) {
        setRecordings(updated);
        saveRecordings(updated);
        resetEditingState();
      }
    } catch (err) {
      debugError('Failed to save editing:', err);
      Alert.alert('儲存失敗', '無法儲存變更，請稍後再試');
    }
  };

  return (
    <>
      <StatusBar
        backgroundColor={colors.container}
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
      />
      <TouchableWithoutFeedback onPress={() => closeAllMenus({ preserveEditing: false })}>
        <SafeAreaView style={[styles.container, { marginTop: 0, paddingTop: 0 }]}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>
                {Platform.OS === 'android' ? '正在檢查權限...' : '載入錄音列表中...'}
              </Text>
            </View>
          ) : (
            <>
              {/* 錄音列表 */}
              {recordings.length === 0 ? (
                <View style={styles.emptyListContainer}>
                  <Text style={styles.emptyListText}>暫無錄音檔案</Text>
                </View>
              ) : (

                <FlatList
                  ref={flatListRef}
                  onScroll={() => {
                    closeAllMenus({ preserveEditing: true });
                    setSummaryMenuContext(null);
                  }}
                  scrollEnabled={!editingState.type}
                  keyboardShouldPersistTaps="handled"
                  style={[styles.listContainer, {
                    marginTop: 40,
                    marginBottom: 90, // 給 Controls 留出空間
                  }]}
                  data={recordings}  // 使用從父組件傳入的已排序項目
                  keyExtractor={(item) => item.uri}
                  contentContainerStyle={{
                    paddingTop: 10,
                    paddingBottom: 20, // 額外的底部 padding
                  }}
                  initialNumToRender={10}
                  maxToRenderPerBatch={10}
                  windowSize={5}
                  removeClippedSubviews={true}
                  renderItem={({ item, index }) => {
                    const summaries = item.summaries || {};
                    const availableKeys = Object.keys(summaries).filter(k => summaries[k]);
                    const isPlayingThis = isPlaying && playingUri === item.uri;
                    let modeToShow = summaryMode; // 預設是全局 summaryMode

                    if (showSummaryIndex !== index) {
                      // 只有當這個錄音不是正在看的時候，才自動選一個已有內容的 mode
                      if (availableKeys.length > 0) {
                        const preferredOrder = ['summary', 'analysis', 'email', 'news', 'ai_answer'];
                        const selected = preferredOrder.find(key => availableKeys.includes(key));
                        modeToShow = selected || availableKeys[0]; // 找不到就拿第一個有的
                      }
                    }

                    const isCurrentPlaying = selectedPlayingIndex === index;
                    const hasDerivedFiles = item.derivedFiles && (item.derivedFiles.enhanced || item.derivedFiles.trimmed);
                    const isTranscriptView = showTranscriptIndex === index;
                    const isSummaryView = showSummaryIndex === index;
                    const shouldHideDefaultUI = isTranscriptView || isSummaryView;

                    const hasAnyContent = item.transcript || item.summaries?.[summaryMode] || '';
                    const isVisible = showTranscriptIndex === index || showSummaryIndex === index;
                    const canHide = hasAnyContent && isVisible;

                    const visibleMiniType =
                      showNotesIndex === index ? 'notes' :
                        showTranscriptIndex === index ? 'transcript' :
                          showSummaryIndex === index ? 'summary' : null;

                    return (
                      <View
                        key={index}
                        onLayout={(e) => {
                          const { y } = e.nativeEvent.layout;
                          setItemOffsets(prev => ({ ...prev, [index]: y }));
                        }}
                        style={{
                          position: 'relative',
                          zIndex: selectedContext?.index === index ? 999 : 0,
                        }}
                      >
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onLongPress={() => {
                            setIsSelectionMode(true);
                            setSelectedItems(new Set([item.uri]));
                          }}
                          onPress={() => {
                            if (isSelectionMode) {
                              setSelectedItems(prev => {
                                const newSet = new Set(prev);
                                if (newSet.has(item.uri)) {
                                  newSet.delete(item.uri);
                                } else {
                                  newSet.add(item.uri);
                                }
                                return newSet;
                              });
                            }
                          }}
                        >
                          {/* 單個錄音項目的完整 UI */}
                          <View
                            style={[
                              styles.recordingItem,
                              isSelectionMode && selectedItems.has(item.uri) && {
                                borderWidth: 2,
                                borderColor: colors.primary,
                                backgroundColor: colors.primary + '10',
                                borderRadius: 12,
                              }
                            ]}
                          >

                            {/* 勾選框 */}
                            {isSelectionMode && (
                              <View style={{ position: 'absolute', top: 5, right: 10, zIndex: 20 }}>
                                <View style={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: 12,
                                  borderWidth: 2,
                                  borderColor: selectedItems.has(item.uri) ? colors.primary : '#999',
                                  backgroundColor: selectedItems.has(item.uri) ? colors.primary : colors.container,
                                  alignItems: 'center',
                                  justifyContent: 'center'
                                }}>
                                  {selectedItems.has(item.uri) && (
                                    <Text style={{ color: 'white', fontSize: 14, fontWeight: 'bold' }}>✓</Text>
                                  )}
                                </View>
                              </View>
                            )}
                            {/* 大音檔 */}
                            <PlaybackBar
                              item={item}
                              isPlaying={isPlaying && playingUri === item.uri}
                              isVisible={playingUri === item.uri}
                              playbackPosition={playingUri === item.uri ? playbackPosition : 0}
                              playbackDuration={playbackDuration}
                              playbackRate={playingUri === item.uri ? currentPlaybackRate : 1.0}  // ✅ 真正正在播放才顯示當前速度
                              editableName={true}
                              onPlayPause={async () => {
                                closeAllMenus();

                                const rate = playbackRates[item.uri] ?? 1.0; // ✅ 從表裡抓
                                if (currentSound) {
                                  currentSound.setSpeed(rate); // ✅ 撥放前套用速度
                                }

                                await togglePlayback(item.uri, index);
                                setSelectedPlayingIndex(index);
                              }}
                              onSeek={(positionMs) => {
                                if (currentSound) {
                                  currentSound.setCurrentTime(positionMs / 1000);
                                  setPlaybackPosition(positionMs);
                                }
                              }}
                              onEditRename={(newName) => {
                                const updated = [...recordings];
                                updated[index].displayName = newName;
                                setRecordings(updated);
                                saveRecordings(updated);
                              }}
                              onMorePress={(e) => {
                                e.stopPropagation();
                                if (selectedContext?.index === index && selectedContext?.type === 'main') {
                                  setSelectedContext(null);
                                  return;
                                }
                                e.target.measureInWindow((x: number, y: number, width: number, height: number) => {
                                  setSelectedContext({
                                    type: 'main',
                                    index,
                                    position: { x, y: y + height }
                                  });
                                });

                              }}
                              onSpeedPress={(e) => {
                                e.stopPropagation();
                                e.target.measureInWindow((x: number, y: number, width: number, height: number) => {
                                  setSpeedMenuIndex(index);
                                  setSpeedMenuPosition({ x, y: y + height });
                                });
                              }}
                              styles={styles}
                              colors={colors}
                              showSpeedControl={true}
                              editingState={editingState}
                              setEditingState={setEditingState}
                              itemIndex={index}

                              setRecordings={setRecordings}
                              saveRecordings={saveRecordings}
                              renderRightButtons={
                                editingState.type === 'name' && editingState.index === index ? (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <TouchableOpacity onPress={saveEditing}>
                                      <Text style={[styles.transcriptActionButton, { color: colors.primary }]}>💾</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={resetEditingState}>
                                      <Text style={styles.transcriptActionButton}>✖️</Text>
                                    </TouchableOpacity>
                                  </View>
                                ) : null
                              }
                            />
                            {item.durationSec > SEGMENT_DURATION && (
                              <TouchableOpacity
                                onPress={() => toggleExpand(item.uri)}
                                style={{ paddingLeft: 16, paddingTop: 4 }}
                              >
                                <Text style={{ fontSize: 12, color: colors.primary }}>
                                  {expandedItems.has(item.uri) ? '▾ 收合分段' : '▸ 展開分段'}
                                </Text>
                              </TouchableOpacity>
                            )}

{expandedItems.has(item.uri) && item.derivedFiles?.splitParts?.map((part: SplitPart, subIndex: number) => (
  <View
    key={`${item.uri}_split_${subIndex}`}
    style={{
      marginLeft: 16,
      paddingLeft: 8,
      borderLeftWidth: 2,
      borderLeftColor: colors.primary + '40',
    }}
  >
    <PlaybackBar
      item={part}
      isPlaying={isPlaying && playingUri === part.uri}
      isVisible={playingUri === part.uri}
playbackPosition={playbackPosition}
  playbackDuration={(part.durationSec ?? 0) * 1000}
      playbackRate={currentPlaybackRate}
      styles={styles}
      colors={colors}
      showSpeedControl={true}
onPlayPause={async () => {
  closeAllMenus();
  const rate = playbackRates[part.uri] ?? 1.0;
  if (currentSound) {
    currentSound.setSpeed(rate);  }

  await togglePlayback(part.uri, index);
  setSelectedPlayingIndex(-1);
}}
      onSeek={(positionMs) => {
        if (currentSound) {
          currentSound.setCurrentTime(positionMs / 1000);
          setPlaybackPosition(positionMs);
        }
      }}
      onEditRename={undefined}
      onMorePress={() => {}}
      onSpeedPress={(e) => {
        e.stopPropagation();
        e.target.measureInWindow((x: any, y: any, width: any, height: any) => {
          setSpeedMenuIndex(index);
          setSpeedMenuPosition({ x, y: y + height });
        });
      }}
      setRecordings={setRecordings}
      saveRecordings={saveRecordings}
      variant="sub"
    />
  </View>
))}
                            {/* 兩行小字摘要 */}
                            <View pointerEvents="box-none">
                              {(item.notes || item.transcript) && (
                                <TouchableOpacity
                                  onPress={async () => {
                                    closeAllMenus();
                                    setSelectedPlayingIndex(index);

                                    if (item.notes?.trim()) {
                                      setShowNotesIndex(index);
                                      setShowTranscriptIndex(null);
                                      setShowSummaryIndex(null);
                                    } else if (item.transcript?.trim()) {
                                      setShowTranscriptIndex(index);
                                      setShowNotesIndex(null);
                                      setShowSummaryIndex(null);
                                    } else {
                                      setShowTranscriptIndex(null);
                                      setShowSummaryIndex(null);
                                    }
                                  }}
                                >
                                  {/* 小字摘要區塊 */}
                                  <View style={styles.transcriptBlock}>
                                    {item.notes?.trim() ? (
                                      <Text
                                        style={styles.transcriptBlockText}
                                        numberOfLines={1}
                                        ellipsizeMode="tail"
                                      >
                                        {String(item.notes).trim()}
                                      </Text>
                                    ) : item.transcript?.trim() ? (
                                      <Text
                                        style={styles.transcriptBlockText}
                                        numberOfLines={1}
                                        ellipsizeMode="tail"
                                      >
                                        {String(item.transcript).trim()}
                                      </Text>
                                    ) : null}
                                  </View>

                                </TouchableOpacity>
                              )}
                            </View>

                            {/* 轉文字 & 重點摘要按鈕*/}
                            {isCurrentPlaying && (
                              <View style={styles.actionButtons}>
                                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                                  {/* 談話筆記 */}
                                  <TouchableOpacity
                                    style={{
                                      paddingVertical: 5,
                                      paddingHorizontal: 8,
                                      backgroundColor: visibleMiniType === 'notes' ? colors.primary : colors.primary + '80',
                                      borderRadius: 8,
                                      opacity: isAnyProcessing ? 0.4 : 1,
                                    }}
                                    disabled={isAnyProcessing || (editingState.type === 'notes' && editingState.index !== null)}
                                    onPress={() => {
                                      closeAllMenus();
                                      stopPlayback();
                                      navigation.navigate('NoteDetail', {
                                        index,
                                        type: 'notes',
                                      });
                                    }}
                                  >
                                    <Text
                                      style={{
                                        color: visibleMiniType === 'notes' ? colors.text : colors.subtext,
                                        fontSize: 13,
                                        textAlign: 'center',
                                      }}
                                    >
                                      談話筆記
                                    </Text>
                                  </TouchableOpacity>

                                  {/* 錄音文檔 */}
                                  <TouchableOpacity
                                    style={{
                                      paddingVertical: 5,
                                      paddingHorizontal: 8,
                                      backgroundColor: visibleMiniType === 'transcript' ? colors.primary : colors.primary + '80',
                                      borderRadius: 8,
                                      opacity: isAnyProcessing ? 0.4 : 1,
                                    }}
                                    disabled={isAnyProcessing}
                                    onPress={async () => {
                                      closeAllMenus();
                                      stopPlayback();
                                      navigation.navigate('NoteDetail', {
                                        index,
                                        type: 'transcript',
                                        shouldTranscribe: !recordings[index].transcript,
                                      });
                                    }}
                                  >
                                    <Text
                                      style={{
                                        color: visibleMiniType === 'transcript' ? colors.text : colors.subtext,
                                        fontSize: 13,
                                        textAlign: 'center',
                                      }}
                                    >
                                      錄音文檔
                                    </Text>
                                  </TouchableOpacity>

                                  {/* AI工具箱 */}
                                  <TouchableOpacity
                                    style={{
                                      paddingVertical: 5,
                                      paddingHorizontal: 8,
                                      backgroundColor: visibleMiniType === 'summary' ? colors.primary : colors.primary + '80',
                                      borderRadius: 8,
                                      opacity: item.transcript && !isAnyProcessing ? 1 : 0.4,
                                    }}
                                    disabled={!item.transcript || isAnyProcessing}
                                    onPress={() => {
                                      closeAllMenus();
                                      stopPlayback();
                                      navigation.navigate('NoteDetail', {
                                        index,
                                        type: 'summary',
                                        summaryMode,
                                      });
                                    }}
                                  >
                                    <Text
                                      style={{
                                        color: visibleMiniType === 'summary' ? colors.text : colors.subtext,
                                        fontSize: 13,
                                        textAlign: 'center',
                                      }}
                                    >
                                      AI工具箱
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            )}
                          </View>

                        </TouchableOpacity>
                      </View>
                    );
                  }}
                />

              )}

              {/* 三點選單浮動層（全域定位） */}
              {selectedContext && (
                <MoreMenu
                  index={selectedContext.index}
                  item={
                    selectedContext.type === 'main'
                      ? recordings[selectedContext.index]
                      : recordings[selectedContext.index].derivedFiles?.[selectedContext.type]!
                  }
                  isDerived={selectedContext.type !== 'main'}
                  title={title}
                  position={selectedContext.position}
                  styles={styles}
                  closeAllMenus={() => setSelectedContext(null)}
                  onRename={(index) => {
                    setSelectedContext(null);
                    setTimeout(() => {
                      startEditing(index, 'name')
                    }, 0);
                  }}
                  onShare={(uri) => {
                    shareRecordingFile(uri, () => setSelectedIndex(null));
                  }}
                  onDelete={(index) => {
                    deleteRecording(index); // 一次刪整包
                    setShowTranscriptIndex(null);
                    setShowSummaryIndex(null);
                    setShowNotesIndex(null);
                    resetEditingState();
                    setSelectedContext(null);
                  }}
                  showDelete={true}
                />
              )}

              {/* 放在這裡！不要放在 map 循環內部 */}
              {/* 加速器 */}
              {speedMenuIndex !== null && speedMenuPosition && (
                <View style={{
                  position: 'absolute',
                  left: speedMenuPosition.x - 60,
                  top: speedMenuPosition.y + 5,
                  backgroundColor: colors.container,
                  borderRadius: 8,
                  padding: 8,
                  zIndex: 9999,
                  elevation: 10,
                }}>
                  {[0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                    <TouchableOpacity
                      key={rate}
                      style={[
                        styles.optionButton,
                        currentPlaybackRate === rate && { backgroundColor: colors.primary + '20' },
                      ]}
                      onPress={async () => {
                        closeAllMenus();

                        const uri = playingUri;
                        if (!uri) return;
                        setPlaybackRates(prev => ({ ...prev, [uri]: rate })); // ✅ 記住這筆的速度

                        if (isPlaying && playingUri === uri) {
                          await setPlaybackRate(rate); // ✅ 當下正在播放才立即套用
                        }

                        setSpeedMenuIndex(null);
                      }}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          currentPlaybackRate === rate && { fontWeight: 'bold' },
                        ]}
                      >
                        {rate}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

            </>
          )}
          {/* 回頂端的球 */}
          {recordings.length > 10 && editingState.index === null && (
            <TouchableOpacity
              onPress={() => flatListRef.current?.scrollToOffset({ animated: true, offset: 0 })}
              style={{
                position: 'absolute',
                bottom: 90,
                right: 20,
                backgroundColor: colors.primary + '80',
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: 30,
                shadowColor: '#000',
                shadowOpacity: 0.2,
                shadowOffset: { width: 0, height: 2 },
                shadowRadius: 4,
                elevation: 5,
              }}
            >
              <Text style={{ color: 'white', fontSize: 18 }}>↑</Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </TouchableWithoutFeedback>  </>
  );
};

export default RecorderLists;