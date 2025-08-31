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
import { useTranslation } from '../constants/i18n';

import {
  RecordingItem, transcribeAudio, summarizeWithMode, summarizeModes, notifyAwsRecordingEvent,
  notitifyWhisperEvent, splitAudioSegments,
  parseDateTimeFromDisplayName, generateDisplayNameParts, generateRecordingMetadata,
} from '../utils/audioHelpers';

import { useAudioPlayer } from '../utils/useAudioPlayer';

import MoreMenu from './MoreMenu';
import { handleLogin, loadUserAndSync, COIN_UNIT_MINUTES, COIN_COST_PER_UNIT, COIN_COST_AI } from '../utils/loginHelpers';
import { productIds, productToCoins, purchaseManager, setTopUpProcessingCallback, setTopUpCompletedCallback, waitForTopUp } from '../utils/iap';
import { debugLog, debugWarn, debugError } from '../utils/debugLog';
import { shareRecordingNote, shareRecordingFile, saveEditedRecording, deleteTextRecording, prepareEditing } from '../utils/editingHelpers';
import { useTheme } from '../constants/ThemeContext';
import { useRecordingContext, } from '../constants/RecordingContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface Props {
  items: RecordingItem[];
  searchQuery: string;
  setRecordings: React.Dispatch<React.SetStateAction<RecordingItem[]>>;
  isLoading: boolean;
  saveRecordings: (data: RecordingItem[]) => Promise<void>;
  safeDeleteFile: (uri: string) => Promise<void>;
  isSelectionMode: boolean;
  selectedItems: Set<string>;
  setIsSelectionMode: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedItems: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedPlayingIndex: number | null;
  setSelectedPlayingIndex: React.Dispatch<React.SetStateAction<number | null>>;
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
  isLoading,
  selectedItems,
  setIsSelectionMode,
  setSelectedItems,
  selectedPlayingIndex,
  setSelectedPlayingIndex,
  saveRecordings,
  safeDeleteFile,
}) => {
  const { colors, styles, isDarkMode } = useTheme();
  const {
    recordings,
    lastVisitedRecording,
    setLastVisitedRecording
  } = useRecordingContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const title = APP_TITLE;
  useKeepAwake(); // 保持清醒
  const { t } = useTranslation();

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
  const [splittingUri, setSplittingUri] = useState<string | null>(null);

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

    const hasSplit = !!found.derivedFiles?.splitParts?.length;

    // 若尚未分段，先進行切割
    if (!hasSplit) {

      if (splittingUri) {
        debugLog(`⏳ 分段處理中，忽略重複點擊: ${splittingUri}`);
        return;
      }

      setSplittingUri(uri);
      debugLog(`🪓 [分段展開] ${found.displayName} 尚未切段，開始切割`);

      const path = uri.replace('file://', '');
      try {
        const metadata = await generateRecordingMetadata(path);
        const totalSec = Math.floor(metadata.durationSec);
        const segmentLength = SEGMENT_DURATION;
        const parts: RecordingItem[] = [];

        for (let start = 0; start < totalSec; start += segmentLength) {
          try {
            debugLog(`⏱ 嘗試分段：start=${start}s, duration=${segmentLength}s`);
            const part = await splitAudioSegments(uri, start, segmentLength, t, found.displayName);
            if (part) {

                    // ✅ 複製主音檔 notes 到小音檔（避免覆寫既有 notes）
      if (!part.notes?.trim() && found.notes?.trim()) {
        part.notes = found.notes;
      }

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
        setSplittingUri(null);
        setExpandedItems(prev => new Set([...prev, uri]));
      } catch (e) {
        debugError(`❌ 分段前 metadata 錯誤: ${path}`, e);
        setSplittingUri(null);
      }
    } else {
      const numParts = found.derivedFiles?.splitParts?.length ?? 0;
      debugLog(`📂 [分段展開] ${found.displayName} 已有 ${numParts} 段，直接展開`);

      // toggle 展開/收合
      setExpandedItems(prev => {
        const copy = new Set(prev);
        copy.has(uri) ? copy.delete(uri) : copy.add(uri);
        return copy;
      });
    }
  };


  const userLang = Localization.getLocales()[0]?.languageTag || 'zh-TW';

  // 音量狀態
  const [currentDecibels, setCurrentDecibels] = useState(-160);
  const recordingTimeRef = useRef(0);

  // 撥放速度
  const pendingPlaybackRateRef = useRef<number>(1.0);

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
  // 子音檔三點選單
  const [selectedSplitContext, setSelectedSplitContext] = useState<{
    parentIndex: number;
    partUri: string;
    position: { x: number; y: number };
  } | null>(null);

  // 所有的文字編輯宣告
  const [editingState, setEditingState] = useState<{
    type: 'transcript' | 'summary' | 'name' | 'notes' | null;
    index: number | null;
    text: string;
    mode?: string; // ✅ optional，未來加多摘要時會用到
  }>({ type: null, index: null, text: '' });


  const {
    currentSound,
    isPlaying,
    playingUri,
    setPlayingUri,
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
    if (GlobalRecorderState.isRecording) {
      setRecording(true);
      recordingStartTimestamp.current = Date.now();
      const elapsedSec = Math.floor((Date.now() - GlobalRecorderState.startTime) / 1000);
      setRecording(true);
      recordingStartTimestamp.current = Date.now();
      recordingTimeRef.current = Math.floor((Date.now() - GlobalRecorderState.startTime) / 1000);

    }
  }, []);

  // 紀錄現在位置
  useEffect(() => {
    if (lastVisitedRecording && flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: lastVisitedRecording.index,
          animated: true,
        });
      }, 400);
      // 展開小音檔對應的主音檔
      if (lastVisitedRecording.uri) {
        const parent = recordings[lastVisitedRecording.index];
        if (parent && parent.derivedFiles?.splitParts?.some((p: { uri: string | undefined; }) => p.uri === lastVisitedRecording.uri)) {
          setExpandedItems(prev => new Set([...prev, parent.uri]));
        }
      }
    }
  }, [lastVisitedRecording]);

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

  useEffect(() => {
    if (!playingUri) return;

    const parent = recordings.find(r =>
      r.derivedFiles?.splitParts?.some((p: RecordingItem) => p.uri === playingUri)
    );

    if (parent) {
      setExpandedItems(prev => {
        const next = new Set(prev);
        next.add(parent.uri); // ✅ 只有在播放子段時展開
        return next;
      });
    }
  }, [playingUri]);

  useEffect(() => {
    setExpandedItems(prev => {
      const newSet = new Set([...prev]);
      for (const uri of prev) {
        const item = recordings.find(r => r.uri === uri);
        const isThisOrChildPlaying =
          item?.uri === playingUri ||
          (item?.derivedFiles?.splitParts?.some((p: RecordingItem) => p.uri === playingUri) ?? false);
        if (!isThisOrChildPlaying) {
          newSet.delete(uri); // ✅ 收合不是播放中的項目
        }
      }
      return newSet;
    });
  }, [playingUri]);

  useEffect(() => {
    if (selectedPlayingIndex === 0 && recordings.length > 0) {
      const first = recordings[0];
      const hasSplit = !!first?.derivedFiles?.splitParts?.length;
      if (hasSplit && (first.durationSec ?? 0) > SEGMENT_DURATION) {
        setExpandedItems(prev => {
          const next = new Set(prev);
          next.add(first.uri);
          return next;
        });
      }
    }
  }, [selectedPlayingIndex, recordings]);



  // 刪除錄音
  const deleteRecording = async (index: number) => {
    Alert.alert(
      t('deleteRecordingTitle'), // 刪除錄音
      t('deleteRecordingMessage'), // 確定要刪除這個錄音嗎？
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
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
              Alert.alert(t('deleteFailed'), (err as Error).message);
            }
          }
        }
      ]
    );
    setSelectedIndex(null);
  };

  const deleteSplitPart = (parentIndex: number, partUri: string) => {
    const updated = [...recordings];

    const parent = updated[parentIndex];
    if (!parent || !parent.derivedFiles?.splitParts) return;

    parent.derivedFiles.splitParts = parent.derivedFiles.splitParts.filter(
      (p: { uri: string; }) => p.uri !== partUri
    );

    setRecordings(updated);
    saveRecordings(updated);
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
  const startEditing = (
    index: number,
    type: 'name' | 'transcript' | 'summary' | 'notes',
    uri?: string
  ) => {
    const editing = prepareEditing(recordings, index, type, summaryMode, uri); // ← 傳入 uri
    if (editing) {
      setEditingState(editing);
      setSelectedIndex(null);
    } else {
      debugError('Failed to prepare editing state');
    }
  };


  // 確保 saveEditing 函數正確處理
const saveEditing = () => {
  if (editingState.type === 'name' && typeof editingState.index === 'number') {
    const newName = editingState.text?.trim() || '';
    if (!newName) return;

    const updated = [...recordings];
    const main = updated[editingState.index];
    if (!main) return;

    // 1) 改主音檔名稱
    main.displayName = newName;

    // 2) 同步所有 splitParts 的前綴
    const parts = main.derivedFiles?.splitParts;
    if (Array.isArray(parts)) {
      parts.forEach((part) => {
        // 取原本的後綴，例如 "00:00-00:30" 或你現在的 " | " 後半段
        const suffix = part.displayName?.split('|')[1]?.trim();
        part.displayName = suffix ? `${newName} | ${suffix}` : newName;
      });
    }

    setRecordings(updated);
    saveRecordings(updated);
    // 清編輯狀態
    setEditingState({ type: null, index: null, text: '' });
    return;
  }

  // ⬇️ 其他類型（transcript/summary/notes）走舊邏輯
  const updated = saveEditedRecording(recordings, editingState, summaryMode);
  setRecordings(updated);
  saveRecordings(updated);
  setEditingState({ type: null, index: null, text: '' });
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
                {Platform.OS === 'android'
                  ? t('checkingPermissions')
                  : t('loadingRecordings')}
              </Text>
            </View>
          ) : (
            <>
              {/* 錄音列表 */}
              {recordings.length === 0 ? (
                <View style={styles.emptyListContainer}>
                  <Text style={styles.emptyListText}>{t('noRecordings')}</Text>
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
                  data={items}  // 使用從父組件傳入的已排序項目
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
                    const isLastVisitedMainOrChild =
                      lastVisitedRecording?.index === index && (
                        !lastVisitedRecording?.uri ||  // 主音檔
                        recordings[index]?.derivedFiles?.splitParts?.some((p: { uri: string | undefined; }) => p.uri === lastVisitedRecording?.uri)  // 子音檔
                      );
                    const isPlayingThis = isPlaying && playingUri === item.uri;
                    const isCardPlaying =
                      playingUri === item.uri ||
                      (item.derivedFiles?.splitParts?.some((p: RecordingItem) => {
                        return typeof p.uri === 'string' && p.uri === playingUri;
                      }) ?? false);
                    const isThisMainOrSubPlaying =
                      playingUri === item.uri ||
                      (item.derivedFiles?.splitParts?.some((p: RecordingItem) => p.uri === playingUri) ?? false)
  const parts = item.derivedFiles?.splitParts || [];
  const hasSplit = parts.length > 0;
  const hasMainText = !!item.transcript?.trim()?.length;

  const shortMainReady = !hasSplit && hasMainText; // 短音檔：主音檔自己有文字
  const longMainReady =
    hasSplit &&
    parts.length > 0 &&
    parts.every((p: any) => (p?.transcript || '').trim().length > 0); // 長音檔：全部小音檔都有文字

  const canUseToolboxMain = shortMainReady || longMainReady;
                    const isPrimarySelected =
                      isPlaying
                        ? isCardPlaying
                        : selectedPlayingIndex === index || isLastVisitedMainOrChild;
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
                            } else {
                              setLastVisitedRecording(null);
                              setSelectedPlayingIndex(index);
                              setPlayingUri(item.uri);       // ✅ 標示這張卡片被選中
                              setExpandedItems(prev => new Set([...prev, item.uri])); // ✅ 自動展開
                            }
                          }}
                          onLongPress={() => {
                            setIsSelectionMode(true);
                            setSelectedItems(new Set([item.uri]));
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
                              },
                              (isPrimarySelected) && {
                                borderWidth: 3,
                                borderColor: colors.primary,
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
                                const updated = recordings.map((rec, i) => {
                                  if (i !== index) return rec;

                                  // 處理子音檔 displayName
                                  const updatedParts = rec.derivedFiles?.splitParts?.map((part: { displayName: string; }) => {
                                    const suffix = part.displayName?.split('|')[1]?.trim(); // 取出 "30 ~ 60 分鐘" 這段
                                    return {
                                      ...part,
                                      displayName: suffix ? `${newName} | ${suffix}` : newName,
                                    };
                                  });

                                  return {
                                    ...rec,
                                    displayName: newName,
                                    derivedFiles: {
                                      ...rec.derivedFiles,
                                      splitParts: updatedParts ?? rec.derivedFiles?.splitParts,
                                    },
                                  };
                                });

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
                            {/* 兩行小字摘要 */}
                            <View pointerEvents="box-none">
                              {(item.notes || item.transcript) && (
                                <TouchableOpacity
                                  onPress={() => {
                                    closeAllMenus();
                                    stopPlayback();
                                    setSelectedPlayingIndex(null);

                                    const type = item.notes?.trim()
                                      ? 'notes'
                                      : item.transcript?.trim()
                                        ? 'transcript'
                                        : null;

                                    if (type) {
                                      navigation.navigate('NoteDetail', {
                                        index,
                                        type,
                                        shouldTranscribe: type === 'transcript' && !item.transcript,
                                      });
                                      setLastVisitedRecording({ index, type: 'transcript' });
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
                                      setSelectedPlayingIndex(null);
                                      navigation.navigate('NoteDetail', {
                                        index,
                                        type: 'notes',
                                      });
                                      setLastVisitedRecording({ index, type: 'notes' });
                                    }}
                                  >
                                    <Text
                                      style={{
                                        color: visibleMiniType === 'notes' ? colors.text : colors.subtext,
                                        fontSize: 13,
                                        textAlign: 'center',
                                      }}
                                    >
                                      {t('notes')}
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
                                      setSelectedPlayingIndex(null);
                                      navigation.navigate('NoteDetail', {
                                        index,
                                        type: 'transcript',
                                        shouldTranscribe: !recordings[index].transcript,
                                      });
                                      setLastVisitedRecording({ index, type: 'transcript' });
                                    }}
                                  >
                                    <Text
                                      style={{
                                        color: visibleMiniType === 'transcript' ? colors.text : colors.subtext,
                                        fontSize: 13,
                                        textAlign: 'center',
                                      }}
                                    >
                                      {t('transcript')}
                                    </Text>
                                  </TouchableOpacity>

                                  {/* AI工具箱 */}
                                  <TouchableOpacity
                                    style={{
                                      paddingVertical: 5,
                                      paddingHorizontal: 8,
                                      backgroundColor: visibleMiniType === 'summary' ? colors.primary : colors.primary + '80',
                                      borderRadius: 8,
                                      opacity: canUseToolboxMain && !isAnyProcessing ? 1 : 0.4,
                                    }}
                                    disabled={!canUseToolboxMain || isAnyProcessing}
                                    onPress={() => {
                                      closeAllMenus();
                                      stopPlayback();
                                      setSelectedPlayingIndex(null);
                                      navigation.navigate('NoteDetail', {
                                        index,
                                        type: 'summary',
                                        summaryMode,
                                      });
                                      setLastVisitedRecording({ index, type: 'summary' });
                                    }}
                                  >
                                    <Text
                                      style={{
                                        color: visibleMiniType === 'summary' ? colors.text : colors.subtext,
                                        fontSize: 13,
                                        textAlign: 'center',
                                      }}
                                    >
                                      {t('toolbox')}
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            )}

                            {item.durationSec > SEGMENT_DURATION && (
                              <TouchableOpacity
                                onPress={() => toggleExpand(item.uri)}
                                disabled={splittingUri === item.uri}
                                style={{ paddingLeft: 16, paddingTop: 4 }}
                              >
                                <Text style={{ fontSize: 12, color: colors.primary }}>
                                  {splittingUri === item.uri
                                    ? t('splittingInProgress') // ⏳ 分段中...
                                    : expandedItems.has(item.uri)
                                      ? t('collapseSegments')  // ▾ 收合分段
                                      : t('expandSegments') // ▸ 展開分段
                                  }
                                </Text>
                              </TouchableOpacity>
                            )}

                            {expandedItems.has(item.uri) && item.derivedFiles?.splitParts?.map((part: RecordingItem, subIndex: number) => {
                              const isThisSplitPlaying = playingUri === part.uri;
                                  const partHasText = !!(part?.transcript || '').trim().length;
    const canUseToolboxPart = partHasText;

                              return (
                                <View
                                  key={part.uri}
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
                                        currentSound.setSpeed(rate);
                                      }

                                      debugLog('▶️ 點擊 splitPart 播放:', {
                                        uri: part.uri,
                                      });

                                      await togglePlayback(part.uri, index);
                                      setSelectedPlayingIndex(-1);
                                    }}
                                    onSeek={(positionMs) => {
                                      if (currentSound) {
                                        currentSound.setCurrentTime(positionMs / 1000);
                                        setPlaybackPosition(positionMs);
                                      }
                                    }}
                                    onEditRename={(newName) => {
                                      const updated = [...recordings];
                                      const parent = updated[index];

                                      if (!parent.derivedFiles?.splitParts) return;

                                      const newParts = parent.derivedFiles.splitParts.map((p: { uri: string; }) =>
                                        p.uri === part.uri
                                          ? { ...p, displayName: newName }
                                          : p
                                      );

                                      updated[index] = {
                                        ...parent,
                                        derivedFiles: {
                                          ...parent.derivedFiles,
                                          splitParts: newParts,
                                        },
                                      };

                                      setRecordings(updated);
                                      saveRecordings(updated);
                                    }}

                                    onMorePress={(e) => {
                                      e.stopPropagation();

                                      if (
                                        selectedSplitContext &&
                                        selectedSplitContext.parentIndex === index &&
                                        selectedSplitContext.partUri === part.uri
                                      ) {
                                        // 如果點的是同一個 → 關閉選單
                                        setSelectedSplitContext(null);
                                        return;
                                      }
                                      e.target.measureInWindow((x: number, y: number, width: number, height: number) => {
                                        setSelectedSplitContext({
                                          parentIndex: index,
                                          partUri: part.uri,
                                          position: { x, y: y + height },
                                        });
                                      });
                                    }}
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
                                  {/* 一行小字摘要：針對小音檔 */}
                                  <View pointerEvents="box-none">
                                    {(part.notes || part.transcript) && (
                                      <TouchableOpacity
                                        onPress={async () => {
                                          closeAllMenus();
                                          stopPlayback();
                                          setSelectedPlayingIndex(null);
                                          const targetType = part.notes?.trim()
                                            ? 'notes'
                                            : part.transcript?.trim()
                                              ? 'transcript'
                                              : null;

                                          if (targetType) {
                                            navigation.navigate('NoteDetail', {
                                              index,
                                              uri: part.uri, // ✅ 這是子音檔
                                              type: targetType,
                                              shouldTranscribe: targetType === 'transcript' && !part.transcript, // ✅ 沒轉過才跑
                                            });
                                            setLastVisitedRecording({ index, uri: part.uri, type: 'notes' });
                                          }
                                        }}
                                      >

                                        <View style={styles.transcriptBlock}>
                                          <Text
                                            style={styles.transcriptBlockText}
                                            numberOfLines={1}
                                            ellipsizeMode="tail"
                                          >
                                            {String(part.notes || part.transcript).trim()}
                                          </Text>
                                        </View>
                                      </TouchableOpacity>
                                    )}
                                  </View>
                                  {/* 三顆按鈕：針對小音檔 */}
                                  {isThisSplitPlaying && (
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
                                          disabled={isAnyProcessing}
                                          onPress={() => {
                                            closeAllMenus();
                                            stopPlayback();
                                            setSelectedPlayingIndex(null);
                                            navigation.navigate('NoteDetail', {
                                              index,
                                              uri: part.uri, // ✅ 指定是這段小音檔
                                              type: 'notes',
                                            });
                                            setLastVisitedRecording({ index, uri: part.uri, type: 'notes' });
                                          }}
                                        >
                                          <Text style={{
                                            color: visibleMiniType === 'notes' ? colors.text : colors.subtext,
                                            fontSize: 13,
                                            textAlign: 'center',
                                          }}>
                                            {t('notes')}
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
                                          onPress={() => {
                                            closeAllMenus();
                                            stopPlayback();
                                            setSelectedPlayingIndex(null);
                                            navigation.navigate('NoteDetail', {
                                              index,
                                              uri: part.uri,
                                              type: 'transcript',
                                              shouldTranscribe: !part.transcript, // ✅ 對應小音檔的 transcript
                                            });
                                            setLastVisitedRecording({ index, uri: part.uri, type: 'transcript' });

                                          }}
                                        >
                                          <Text style={{
                                            color: visibleMiniType === 'transcript' ? colors.text : colors.subtext,
                                            fontSize: 13,
                                            textAlign: 'center',
                                          }}>
                                            {t('transcript')}
                                          </Text>
                                        </TouchableOpacity>

                                        {/* AI工具箱 */}
                                        <TouchableOpacity
                                          style={{
                                            paddingVertical: 5,
                                            paddingHorizontal: 8,
                                            backgroundColor: visibleMiniType === 'summary' ? colors.primary : colors.primary + '80',
                                            borderRadius: 8,
                                            opacity: canUseToolboxPart && !isAnyProcessing ? 1 : 0.4,
                                          }}
                                          disabled={!canUseToolboxPart || isAnyProcessing}
                                          onPress={() => {
                                            closeAllMenus();
                                            stopPlayback();
                                            setSelectedPlayingIndex(null);
                                            navigation.navigate('NoteDetail', {
                                              index,
                                              uri: part.uri,        // ✅ 傳入小音檔 uri
                                              type: 'summary',
                                              summaryMode,
                                            });
                                            setLastVisitedRecording({ index, uri: part.uri, type: 'summary' });
                                          }}
                                        >
                                          <Text style={{
                                            color: visibleMiniType === 'summary' ? colors.text : colors.subtext,
                                            fontSize: 13,
                                            textAlign: 'center',
                                          }}>
                                            {t('toolbox')}
                                          </Text>
                                        </TouchableOpacity>
                                      </View>
                                    </View>
                                  )}
                                </View>
                              );
                            })}
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
                    setSelectedSplitContext(null);
                    setTimeout(() => {
                      startEditing(index, 'name');
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

              {selectedSplitContext && (
                <MoreMenu
                  index={selectedSplitContext.parentIndex}
                  item={
                    recordings[selectedSplitContext.parentIndex]
                      .derivedFiles?.splitParts?.find((p: { uri: string; }) => p.uri === selectedSplitContext.partUri)!
                  }
                  isDerived={true}
                  title={title}
                  position={selectedSplitContext.position}
                  styles={styles}
                  closeAllMenus={() => setSelectedSplitContext(null)}
                  onRename={(index) => {
                    setSelectedSplitContext(null);
                    const partUri = selectedSplitContext?.partUri;
                    setTimeout(() => {
                      startEditing(index, 'name', partUri); // ✅ 把子音檔 uri 傳入
                    }, 0);
                  }}
                  onShare={(uri) => {
                    shareRecordingFile(uri, () => setSelectedIndex(null));
                  }}
                  onDelete={() => {
                    deleteSplitPart(
                      selectedSplitContext.parentIndex,
                      selectedSplitContext.partUri
                    );
                    setSelectedSplitContext(null);
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