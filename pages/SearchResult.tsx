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
import * as FileSystem from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import BackgroundService from 'react-native-background-actions';
import RNFS from 'react-native-fs';
import { Linking } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { useLoginContext } from '../constants/LoginContext';
import PlaybackBar from '../components/PlaybackBar';

import {
  RecordingItem,
  enhanceAudio, trimSilence,
  transcribeAudio, summarizeWithMode, summarizeModes,
  parseDateTimeFromDisplayName, generateRecordingMetadata,
  splitAudioByInterval,
} from '../utils/audioHelpers';
import { useFileStorage } from '../utils/useFileStorage';
import { useAudioPlayer } from '../utils/useAudioPlayer';
import { ANDROID_AUDIO_ENCODERS, ANDROID_OUTPUT_FORMATS } from '../constants/AudioConstants';
import RecorderHeader from '../components/RecorderHeader';

import MoreMenu from '../components/MoreMenu';
import {
  renderFilename,
  renderNoteBlock
} from '../components/AudioItem';
import { uFPermissions } from '../src/hooks/uFPermissions';
import { handleLogin, loadUserAndSync, COIN_UNIT_MINUTES, COIN_COST_PER_UNIT, COIN_COST_AI } from '../utils/loginHelpers';
import { productIds, productToCoins, purchaseManager, setTopUpProcessingCallback, setTopUpCompletedCallback, waitForTopUp } from '../utils/iap';
import RecorderControls from '../components/RecorderToolbar';
import { debugLog, debugWarn, debugError } from '../utils/debugLog';
import { shareRecordingNote, shareRecordingFile, saveEditedRecording, deleteTextRecording, prepareEditing } from '../utils/editingHelpers';
import { useTheme } from '../constants/ThemeContext';
import { useRecordingContext } from '../constants/RecordingContext';
import LoginOverlay from '../components/LoginOverlay';
import RecorderLists from '../components/RecorderLists';
import SelectionToolbar from '../components/SelectionToolbar';
import SearchToolbar from '../components/SearchToolbar';
import { APP_TITLE } from '../constants/variant';

import { GoogleSignin } from '@react-native-google-signin/google-signin';
GoogleSignin.configure({
  webClientId: '732781312395-blhdm11hejnni8c2k9orf7drjcorp1pp.apps.googleusercontent.com',
  offlineAccess: true, // 可選
});

const GlobalRecorderState = {
  isRecording: false,
  filePath: '',
  startTime: 0,
};

const SearchResultPage = () => {
  const title = APP_TITLE;

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useKeepAwake(); // 保持清醒
  const { permissionStatus, requestPermissions } = uFPermissions();
  // 核心狀態
  const [recording, setRecording] = useState(false);
  const recordingStartTimestamp = useRef<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const { colors, styles, isDarkMode, toggleTheme, customPrimaryColor, setCustomPrimaryColor } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<'latest' | 'oldest' | 'size' | 'name-asc' | 'name-desc' | 'starred'>('latest');

  const audioRecorderPlayer = useRef(new AudioRecorderPlayer()).current;
  const [isTranscribingIndex, setIsTranscribingIndex] = useState<number | null>(null);
  const [summarizingState, setSummarizingState] = useState<{ index: number; mode: string; } | null>(null);
  const [isEditingNotesIndex, setIsEditingNotesIndex] = useState<number | null>(null);
  const isAnyProcessing = isTranscribingIndex !== null || summarizingState !== null || isEditingNotesIndex !== null;
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [summaryMode, setSummaryMode] = useState('summary');
  const [noteTitleEditing, setNoteTitleEditing] = useState('');
  const [notesEditing, setNotesEditing] = useState<string>('');
  const [showNotesIndex, setShowNotesIndex] = useState<number | null>(null);
  const [playbackRates, setPlaybackRates] = useState<Record<string, number>>({});
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [searchKeyword, setSearchKeyword] = useState('');

  const flatListRef = useRef<FlatList>(null);
  const [selectedPlayingIndex, setSelectedPlayingIndex] = useState<number | null>(null);
  const resetEditingState = () => {
    setEditingState({ type: null, index: null, text: '' });
    setIsEditingNotesIndex(null);
  };

  const [summaryMenuContext, setSummaryMenuContext] = useState<{
    index: number;
    position: { x: number; y: number };
  } | null>(null);


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

  const { recordings, setRecordings } = useRecordingContext();

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
  }, [isPlaying, currentSound]);

  // 分貝
  useEffect(() => {
    if (recording) {
      SoundLevel.start();

      SoundLevel.onNewFrame = (data) => {
        setCurrentDecibels(data.value);
      };
    } else {
      SoundLevel.stop(); // 當錄音關閉時停止
    }

    return () => {
      SoundLevel.stop(); // 安全保底：離開頁面或重新啟動時清除
    };
  }, [recording]);


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


  // 篩選排序
  const getFilteredSortedRecordings = () => {
    let filtered = recordings;

    // 搜尋
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.displayName?.toLowerCase().includes(query)
        || r.name?.toLowerCase().includes(query)
        || r.notes?.toLowerCase().includes(query)
        || r.transcript?.toLowerCase().includes(query)
        || (query === 'star' && r.isStarred)
        // || r.summaries?.summary?.toLowerCase().includes(query)   ✅ 只搜尋一種 summary
      );
    }

    // 排序
    switch (sortOption) {
      case 'oldest':
        filtered.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        break;
      case 'latest':
        filtered.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        break;
      case 'size':
        filtered.sort((a, b) => (b.size || 0) - (a.size || 0));
        break;
      case 'name-asc':
        filtered.sort((a, b) => {
          const nameA = (a.displayName || a.name || '').toLowerCase();
          const nameB = (b.displayName || b.name || '').toLowerCase();
          return nameA.localeCompare(nameB);
        });
        break;
      case 'name-desc':
        filtered.sort((a, b) => {
          const nameA = (a.displayName || a.name || '').toLowerCase();
          const nameB = (b.displayName || b.name || '').toLowerCase();
          return nameB.localeCompare(nameA);
        });
        break;
      case 'starred':
        filtered.sort((a, b) => {
          const aStar = a.isStarred ? 1 : 0;
          const bStar = b.isStarred ? 1 : 0;
          return bStar - aStar; // ✅ 已加星排前面
        });
        break;
    }

    return filtered;
  };

  // 批次處理 
  const handleDeleteSelected = async () => {
    const updated = recordings.filter(r => !selectedItems.has(r.uri));

    for (let r of recordings) {
      if (selectedItems.has(r.uri)) {
        await safeDeleteFile(r.uri);
        if (r.derivedFiles?.enhanced?.uri) await safeDeleteFile(r.derivedFiles.enhanced.uri);
        if (r.derivedFiles?.trimmed?.uri) await safeDeleteFile(r.derivedFiles.trimmed.uri);
      }
    }

    setRecordings(updated);
    await saveRecordings(updated);
    setIsSelectionMode(false);
    setSelectedItems(new Set());
  };


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

  // 格式化時間
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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


  if (!isLoading && permissionStatus === 'denied') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>⚠️ 請開啟錄音與儲存權限才能使用此 App</Text>
          <TouchableOpacity onPress={() => requestPermissions()}>
            <Text style={[styles.loadingText, { color: colors.primary, marginTop: 12 }]}>重新檢查權限</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 所有的文字編輯邏輯
  const startEditing = (index: number, type: 'name' | 'transcript' | 'summary' | 'notes') => {
    const editing = prepareEditing(recordings, index, type, summaryMode);
    setEditingState(editing);
    setSelectedIndex(null);
  };

  const saveEditing = () => {
    const updated = saveEditedRecording(recordings, editingState, summaryMode);

    setRecordings(updated);
    saveRecordings(updated);
    resetEditingState();
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
              {/* 搜尋列表 */}
              {searchQuery.trim().length > 0 && getFilteredSortedRecordings().length > 0 && (
                <View style={{
                  position: 'absolute',
                  top: 53,
                  left: 0,
                  right: 0,
                  paddingHorizontal: 60,
                  paddingVertical: 10,
                  backgroundColor: colors.background, // ✅ 背景鋪底（加透明度讓比較柔和）
                  zIndex: 10,
                }}>
                  <TouchableOpacity
                    onPress={() => {
                      const itemsToAnalyze = getFilteredSortedRecordings();
                      navigation.navigate('TopicSummaryPage', {
                        items: itemsToAnalyze,
                        keyword: searchQuery.trim()
                      });
                    }}
                    style={{
                      //       marginTop: 70,
                      //       marginHorizontal: 16,
                      paddingVertical: 10,
                      paddingHorizontal: 20,
                      backgroundColor: colors.primary,
                      borderRadius: 50,
                      alignItems: 'center',
                      minWidth: 200, // ✅ 最小寬度
                      alignSelf: 'center', // ✅ 讓按鈕寬度隨內容變化且置中（非必要）
                    }}
                  >
                    <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>
                      「{searchQuery.trim()}」重點整理
                    </Text>
                  </TouchableOpacity>
                </View>
              )}


              {/* 錄音列表 */}
              <RecorderLists
                items={getFilteredSortedRecordings()}
                searchQuery={searchQuery}
                setRecordings={setRecordings}
                isSelectionMode={isSelectionMode}
                selectedItems={selectedItems}
                setIsSelectionMode={setIsSelectionMode}
                setSelectedItems={setSelectedItems}
              />

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

                        const uri = recordings[speedMenuIndex].uri;
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

              {/* 整個上半段背景 */}
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.container, }}>
        <RecorderHeader
        mode="detail" 
          onBack={() => navigation.goBack()}
          searchQuery={searchKeyword}
          setSearchQuery={setSearchKeyword}
                />
              </View>
              {/* 底部工具列 */}
                <SearchToolbar
                  resultCount={getFilteredSortedRecordings().length}
                  onCancelSearch={() => setSearchQuery('')}
                />
            </>
          )}
          {/* 批量處理音檔 */}
          {isSelectionMode && (
            <SelectionToolbar
              selectedCount={selectedItems.size}
              onDelete={handleDeleteSelected}
              onCancel={() => {
                setIsSelectionMode(false);
                setSelectedItems(new Set());
              }}
            />
          )}
        </SafeAreaView>
      </TouchableWithoutFeedback>
    </>
  );
};

export default SearchResultPage;