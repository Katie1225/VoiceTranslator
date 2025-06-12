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
import Sound from 'react-native-sound';
import * as FileSystem from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import Slider from '@react-native-community/slider';
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
  renderMoreButton,
  renderNoteBlock
} from '../components/AudioItem';
import { uFPermissions } from '../src/hooks/uFPermissions';
import { logCoinUsage } from '../utils/googleSheetAPI';
import { handleLogin, loadUserAndSync, COIN_UNIT_MINUTES, COIN_COST_PER_UNIT, COIN_COST_AI } from '../utils/loginHelpers';
import TopUpModal from '../components/TopUpModal';
import { productIds, productToCoins, purchaseManager, setTopUpProcessingCallback, setTopUpCompletedCallback, waitForTopUp } from '../utils/iap';
import { APP_VARIANT } from '../constants/variant';
import RecorderControls from '../components/RecorderControls';
import { debugLog, debugWarn, debugError } from '../utils/debugLog';
import { shareRecordingNote, shareRecordingFile, saveEditedRecording, deleteTextRecording, prepareEditing } from '../utils/editingHelpers';
import SplitPromptModal, { splitTimeInSeconds } from '../components/SplitPromptModal';
import { useTheme } from '../constants/ThemeContext';
import { partBackgrounds, additionalColors } from '../constants/Colors';

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

const RecorderPageVoiceNote = () => {
  const title = "  Voice Note";

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useKeepAwake(); // 保持清醒
  const { permissionStatus, requestPermissions } = uFPermissions();
  // 核心狀態
  const [recording, setRecording] = useState(false);
  const recordingStartTimestamp = useRef<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const { colors, styles, isDarkMode, toggleTheme, customPrimaryColor, setCustomPrimaryColor } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<'latest' | 'oldest' | 'size' | 'name-asc' | 'name-desc'>('latest');
  const audioRecorderPlayer = useRef(new AudioRecorderPlayer()).current;
  const [pendingTranscribe, setPendingTranscribe] = useState<{ index: number; durationSec: number } | null>(null);
  const [showSplitPrompt, setShowSplitPrompt] = useState(false);
  const [isTranscribingIndex, setIsTranscribingIndex] = useState<number | null>(null);
  const [summarizingState, setSummarizingState] = useState<{ index: number; mode: string; } | null>(null);
  const [isEditingNotesIndex, setIsEditingNotesIndex] = useState<number | null>(null);
  const isAnyProcessing = isTranscribingIndex !== null || summarizingState !== null || isEditingNotesIndex !== null;
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [summaryMode, setSummaryMode] = useState('summary');
  const [noteTitleEditing, setNoteTitleEditing] = useState('');
  const [notesEditing, setNotesEditing] = useState<string>('');
  const [showNotesIndex, setShowNotesIndex] = useState<number | null>(null);
  

  const flatListRef = useRef<FlatList>(null);
  const [itemOffsets, setItemOffsets] = useState<Record<number, number>>({});
  const [selectedPlayingIndex, setSelectedPlayingIndex] = useState<number | null>(null);
  const resetEditingState = () => {
    setEditingState({ type: null, index: null, text: '' });
    setIsEditingNotesIndex(null);
  };

  const [summaryMenuContext, setSummaryMenuContext] = useState<{
    index: number;
    position: { x: number; y: number };
  } | null>(null);


  const userLang = Localization.getLocales()[0]?.languageTag || 'zh-TW';

  const ITEM_HEIGHT = 80; // 音檔名稱高度

  const shouldShowDerivedFiles = (title: string) => {
    return title === "Voice Clamp";
  };


  // 音量狀態
  const [currentDecibels, setCurrentDecibels] = useState(-160);
  const recordingTimeRef = useRef(0);

  const resumeAfterTopUp = useRef<
    null | { type: 'transcribe'; index: number } | { type: 'summary'; index: number; mode: string }
  >(null);

  const onTopUpProcessingChangeRef = useRef<(isProcessing: boolean) => void>();

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
              const indexToResume = action.index;
              purchaseManager.clearPendingActions();
              setSelectedPlayingIndex(indexToResume);
              setTimeout(() => {
                handleTranscribe(indexToResume);
              }, 500);
            }
          }
        }
      }
    };

    checkPendingActions();
  }, [purchaseManager]); // 依賴 purchaseManager 實例


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

  // 購買畫面
  const [showTopUpModal, setShowTopUpModal] = useState(false);

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

  const [recordings, setRecordings] = useState<RecordingItem[]>([]);

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
    setPlaybackPosition
  } = useAudioPlayer();

  // WAV錄音配置
  const recordingOptions = {
    android: {
      extension: '.m4a',
      outputFormat: ANDROID_OUTPUT_FORMATS.MPEG_4,
      audioEncoder: ANDROID_AUDIO_ENCODERS.AAC,
      sampleRate: 48000,
      numberOfChannels: 1,
      bitRate: 320000,
      audioSource: 1,
      enableAcousticEchoCanceler: true,
      enableNoiseSuppressor: true,
      keepAudioSessionAlive: true  // 新增這行
    },
    ios: {
      extension: '.m4a',
      outputFormat: 2, // MPEG4AAC
      audioQuality: 2, // MAX
      sampleRate: 48000,
      numberOfChannels: 1,
      bitRate: 320000,
      linearPCMBitDepth: 24,
      keepAudioSessionAlive: true,  // 新增這行
    },
    isMeteringEnabled: true
  };

  // 帳號登入
  const [isLoggingIn, setIsLoggingIn] = useState(false);
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


  // 錄音工作
  const task = async (args: any) => {
    const path = args?.path;
    if (!path) {
      debugError("❌ 無錄音路徑");
      return;
    }

    debugLog("🎤 開始錄音任務:", path);

    await audioRecorderPlayer.startRecorder(path, {
      AudioSourceAndroid: 1,
      OutputFormatAndroid: 2,
      AudioEncoderAndroid: 3,
      AudioSamplingRateAndroid: 48000,
      AudioChannelsAndroid: 1,
      AudioEncodingBitRateAndroid: 320000,
    });

    audioRecorderPlayer.addRecordBackListener((e) => {
      const sec = Math.floor(e.currentPosition / 1000);
      recordingTimeRef.current = sec;
    });

    debugLog("✅ 錄音任務啟動完成");
    await new Promise(async (resolve) => {
      while (BackgroundService.isRunning()) {
        await new Promise(res => setTimeout(res, 1000)); // 睡 1 秒 
      }
      resolve(true);
    });
    debugLog("🛑 背景任務結束");
  };

  const labelMap: Record<string, string> = {
    latest: '最新在上',
    oldest: '最舊在上',
    size: '依大小排序',
    'name-asc': '名稱 A → Z',
    'name-desc': '名稱 Z → A',
  };

  // 篩選排序
  const getFilteredSortedRecordings = () => {
    let filtered = recordings;

    // 搜尋
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.displayName?.toLowerCase().includes(query) ||
        r.name?.toLowerCase().includes(query)
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
        filtered.sort((a, b) =>
          (a.displayName || a.name || '').localeCompare(b.displayName || b.name || '')
        );
        break;
      case 'name-desc':
        filtered.sort((a, b) =>
          (b.displayName || b.name || '').localeCompare(a.displayName || a.name || '')
        );
        break;
    }

    return filtered;
  };

  // 開始錄音（帶音量檢測）
  const startRecording = async () => {
    closeAllMenus();

    // 如果權限已被拒絕，直接顯示提示
    if (permissionStatus === 'denied') {
      Alert.alert(
        '權限不足',
        '需要麥克風和儲存權限才能錄音',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '前往設定',
            onPress: () => Linking.openSettings()
          }
        ]
      );
      return;
    }

    try {
      const now = new Date();
      const filename = `rec_${now.getTime()}.m4a`;
      const filePath = `${RNFS.ExternalDirectoryPath}/${filename}`;

      debugLog("📁 錄音儲存路徑:", filePath);

      // ✅ 先啟動 BackgroundService，讓它來啟動錄音
      await BackgroundService.start(task, {
        taskName: '錄音中',
        taskTitle: '背景錄音中',
        taskDesc: '請勿關閉 App，錄音持續中...',
        taskIcon: {
          name: 'ic_launcher',
          type: 'mipmap',
        },
        parameters: { path: filePath },
        allowWhileIdle: true,
        foregroundServiceType: 'microphone',
      } as any);

      GlobalRecorderState.isRecording = true;
      GlobalRecorderState.filePath = filePath;
      GlobalRecorderState.startTime = Date.now();
      setRecording(true);
      recordingTimeRef.current = 0;

      //測試版用開始
      setTimeout(() => {
        if (GlobalRecorderState.isRecording) {
          stopRecording();
          Alert.alert("⏱ 錄音已達上限", "每段最多錄音 180 分鐘");
        }
      }, 180 * 60 * 1000);
      // 測試版用結束
    } catch (err) {
      debugError("❌ 錄音啟動錯誤：", err);
      Alert.alert("錄音失敗", (err as Error).message || "請檢查權限或儲存空間");
      setRecording(false);
    }
  };

  // 停止錄音
  let stopInProgress = false; // 👈 加在模組頂部最外層

  const stopRecording = async () => {
    if (stopInProgress) {
      debugWarn('⛔️ stopRecording 已在執行中，跳過');
      return;
    }
    stopInProgress = true;
    try {
      const uri = await audioRecorderPlayer.stopRecorder();
      await audioRecorderPlayer.removeRecordBackListener();
      setRecording(false);
      recordingStartTimestamp.current = null;
      GlobalRecorderState.isRecording = false;
      GlobalRecorderState.filePath = '';
      GlobalRecorderState.startTime = 0;

      // ✅ 停止前景通知
      await BackgroundService.stop();

      // 確保路徑格式正確
      const normalizedUri = uri.startsWith('file://') ? uri : `file://${uri}`;

      // 使用 RNFS 檢查檔案
      const fileExists = await RNFS.exists(uri);
      if (!fileExists) {
        Alert.alert(
          "錄音失敗",
          "錄音檔案未建立成功，請確認權限已開啟，並將「背景限制」設為不限制。"
        );
        return;
      }

      const fileInfo = await RNFS.stat(uri);

      // ✅ 加強判斷：如果檔案太小，就刪除！
      if (fileInfo.size < 3000) { // 小於 3KB 視為失敗錄音
        await RNFS.unlink(uri);
        Alert.alert("錄音失敗", "錄音檔案太小，已自動刪除");
        return;
      }

      debugLog("📄 錄音檔案資訊:", fileInfo);
      const name = uri.split('/').pop() || `rec_${Date.now()}.m4a`;

      if (fileInfo.size > 0) {
        const { displayName, date, durationSec, size } = await generateRecordingMetadata(normalizedUri);

        // 替換 [錄音] 為使用者筆記第一行（如果有）
        let finalDisplayName = displayName;
        const firstLine = noteTitleEditing.trim();
        if (firstLine && displayName.includes('[錄音]')) {
          finalDisplayName = displayName.replace('[錄音]', `[${firstLine}]`);
        }

        const newItem: RecordingItem = {
          size: fileInfo.size,
          uri: normalizedUri,
          name,
          displayName: displayName.replace('[錄音]', `[${firstLine || '錄音'}]`),
          derivedFiles: {},
          date,
          notes: notesEditing,
        };

        setShowTranscriptIndex(null);   // 🔧 錄音完後，確保不會自動顯示 transcript
        setShowSummaryIndex(null);      // 🔧 順便清掉 summary 展開
        resetEditingState(); // 清除所有編輯狀態


        // 換下面那些log   setRecordings(prev => [newItem, ...prev]);
        debugLog('📌 準備建立新錄音項目', { name, displayName, date });

        setRecordings(prev => {
          const now = Date.now();
          const recentItem = prev[0];
          if (recentItem && Math.abs(now - parseInt(recentItem.name.replace('rec_', '').replace('.m4a', ''))) < 2000) {
            debugWarn('⛔️ 距離上一筆錄音太近，疑似重複寫入，已跳過');
            return prev;
          }
          return [newItem, ...prev];
        });
        setShowNotesModal(false);
        setNotesEditing('');
        setNoteTitleEditing('');

      } else {
        Alert.alert("錄音失敗", "錄音檔案為空");
        await RNFS.unlink(uri); // 刪除空檔案
      }
    } catch (err) {
      debugError("❌ 停止錄音失敗：", err);
      Alert.alert("停止錄音失敗", (err as Error).message);
    }
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

  // 取得音檔
  const pickAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const { uri, name } = asset;

        const metadata = await generateRecordingMetadata(uri);

        const newItem: RecordingItem = {
          uri,
          name,
          displayName: metadata.displayName,
          derivedFiles: {},
          date: metadata.date,
          notes: notesEditing,
          size: metadata.size ?? 0, // ✅ 明確設定 size
        };

        debugLog('📥 匯入錄音 metadata:', {
          name,
          displayName: metadata.displayName,
          date: metadata.date,
          durationSec: metadata.durationSec,
        });

        setRecordings(prev => [newItem, ...prev]);
      }
    } catch (err) {
      debugError('❌ 選取音檔失敗', err);
    }
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

  // 刪除 summary 其中一項的對應邏輯
  const handleDeleteSummary = async (index: number) => {
    const updated = deleteTextRecording(recordings, index, 'summary', summaryMode);
    setRecordings(updated);
    await saveRecordings(updated);

    const remainingModes = Object.keys(updated[index]?.summaries || {})
      .filter(k => updated[index]?.summaries?.[k]);

    if (remainingModes.length > 0) {
      const preferredOrder = ['summary', 'analysis', 'email', 'news', 'ai_answer'];
      const nextMode = preferredOrder.find(k => remainingModes.includes(k)) || remainingModes[0];
      setSummaryMode(nextMode);
    } else {
      setSummaryMode('summary'); // reset
      setShowSummaryIndex(null);
    }

    setSummarizingState(null);
  };

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


  // 修改文字內容
  const renderNoteSection = (index: number, type: 'transcript' | 'summary' | 'notes') => {
    const isTranscript = type === 'transcript';
    const isNotes = type === 'notes';
    const editingIndex = editingState.type === type ? editingState.index : null;
    const editValue = editingState.type === type && editingState.index === index ? editingState.text : '';
    const itemValue =
      isTranscript
        ? recordings[index]?.transcript
        : type === 'summary'
          ? recordings[index]?.summaries?.[summaryMode] || ''
          : recordings[index]?.notes || '';
    debugLog('[renderNoteSection] index=', index, 'type=', type, 'editing=', editingIndex === index);


    return renderNoteBlock({
      type,
      index,
      value: itemValue || '',
      editingIndex,
      editValue,
      onChangeEdit: (text: string) => {
        setEditingState({ type, index, text });
        if (type === 'notes') {
          setIsEditingNotesIndex(index);
        }
      },
      onSave: () => {
        saveEditing();
        setIsEditingNotesIndex(null);
      },
      onCancel: () => {
        resetEditingState();
        setIsEditingNotesIndex(null);
      },
      onDelete: async () => {
        if (type === 'summary') {
          await handleDeleteSummary(index);
        } else {
          const updated = deleteTextRecording(recordings, index, type, summaryMode);
          setRecordings(updated);
          await saveRecordings(updated);
          resetEditingState();

          if (type === 'transcript') {
            setShowTranscriptIndex(null);  // 控制「哪一筆錄音顯示 transcript 區塊」
            setIsTranscribingIndex(null);  // 控制「哪一筆正在轉文字（轉錄）中」
          } else if (type === 'notes') {
            setIsEditingNotesIndex(null);
          }
        }
      },

      onShare: async () => {
        await shareRecordingNote(recordings[index], type, summaryMode);
        if (type === 'summary') {
          setSummarizingState(null);
        }
      },
      styles,
      colors,
    });
  };

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
  const handleTranscribe = async (index: number, forceFull = false) => {
    setSelectedPlayingIndex(index);
    const item = recordings[index];
    if (item.transcript) {
      setShowTranscriptIndex(index);
      setShowSummaryIndex(null);
      return;
    }
    setIsTranscribingIndex(index);

    try {
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

      const coinsToDeduct = Math.ceil(durationSec / (COIN_UNIT_MINUTES * 60)) * COIN_COST_PER_UNIT;

      const ok = await ensureCoins(coinsToDeduct);

      if (!ok) {
        setIsTranscribingIndex(null);
        return;
      }
      const stored = await AsyncStorage.getItem('user');
      const user = JSON.parse(stored!);

      const result = await transcribeAudio(item, async (updatedTranscript) => {
        setRecordings(prev => {
          const updated = prev.map((rec, i) =>
            i === index ? { ...rec, transcript: updatedTranscript } : rec
          );
          saveRecordings(updated).catch(e => debugError('保存失敗:', e));
          return updated;
        });
        debugLog('✅render 1');
        setShowTranscriptIndex(index);
        setShowSummaryIndex(null);
      }, userLang.includes('CN') ? 'cn' : 'tw');

      const skippedMinutes = Math.floor(result.skippedSilentSegments / 2);
      /*if (skippedMinutes > 0) {
        Alert.alert(`已跳過 ${skippedMinutes} 分鐘靜音`,'\n靜音部分不扣金幣');
      } */

      /*   if (!result?.transcript?.text?.trim()) {
           throw new Error("無法取得有效的轉譯結果");
         }*/
      debugLog('✅render 2', skippedMinutes);
      setShowTranscriptIndex(index);
      setShowSummaryIndex(null);

      let finalUpdated = recordings.map((rec, i) =>
        i === index ? { ...rec, transcript: result.transcript.text } : rec
      );

      try {
        const summary = await summarizeWithMode(result.transcript.text, 'summary', userLang.includes('CN') ? 'cn' : 'tw');
        finalUpdated = finalUpdated.map((rec, i) =>
          i === index
            ? {
              ...rec,
              summaries: {
                ...(rec.summaries || {}),
                summary,
              },
            }
            : rec
        );
      } catch (err) {
        debugWarn('❌ 自動摘要失敗:', err);
      }
      debugLog('✅render 3: skippedMinutes');
      setRecordings(finalUpdated);
      await saveRecordings(finalUpdated);
      setShowTranscriptIndex(null);
      setShowSummaryIndex(index);
      setSummaryMode('summary');

      const coinResult = await logCoinUsage({
        id: user.id,
        email: user.email,
        name: user.name,
        action: 'transcript',
        value: -coinsToDeduct,
        // value: -coinsToDeduct+skippedMinutes,
        note: `轉文字：${item.displayName || item.name || ''}，長度 ${durationSec}s，扣 ${coinsToDeduct} 金幣`
      });

      if (!coinResult.success) {
        Alert.alert("轉換成功，但扣金幣失敗", coinResult.message || "請稍後再試");
      }
      debugLog('✅render 4');
      setSummaryMode('summary');
      setShowSummaryIndex(index);
      setShowTranscriptIndex(null);

    } catch (err) {
      Alert.alert("❌ 錯誤", (err as Error).message || "轉換失敗，這次不會扣金幣");
    } finally {
      setIsTranscribingIndex(null);
    }
  };

  // 重點摘要AI工具箱邏輯
  const handleSummarize = async (
    index: number,
    mode: string = 'summary',
    requirePayment?: boolean  // ← 可選
  ) => {
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
      setShowTranscriptIndex(null);
      setShowSummaryIndex(index);
      return;
    }

    debugLog('2', mode);
    let user: any = null;

    if (pay) {
      const ok = await ensureCoins(COIN_COST_AI);
      if (!ok) return;

      const fresh = await AsyncStorage.getItem('user');
      if (!fresh) {
        Alert.alert("錯誤", "無法取得使用者資料");
        return;
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

      const updated = recordings.map((rec, i) =>
        i === index
          ? {
            ...rec,
            summaries: {
              ...(rec.summaries || {}),
              [mode]: summary,
            },
          }
          : rec
      );

      debugLog('6', mode);
      setRecordings(updated);
      await saveRecordings(updated);

      // ✅ 顯示摘要
      setSummaryMode(mode);
      setShowTranscriptIndex(null);
      setShowSummaryIndex(index);
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
                    marginTop: 40, // 給 Header 留出空間
                    marginBottom: 90, // 給 Controls 留出空間
                  }]}
                  data={getFilteredSortedRecordings()}
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
                          /*   onLongPress={() => {
                               Alert.alert('刪除錄音', '確定要刪除嗎？', [
                                 { text: '取消', style: 'cancel' },
                                 { text: '刪除', onPress: () => deleteRecording(index) },
                               ]);
                             }}
                               */
                          activeOpacity={0.8}
                        >

                          {/* 單個錄音項目的完整 UI */}
                          <View style={[styles.recordingItem]}>

                            {/* 名稱行 */}
                            <View style={[styles.nameRow, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                              {/* 左邊播放鍵＋檔名 */}
                              <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                                {/* ▶ 播放鍵 */}
                                <TouchableOpacity
onPress={async () => {
  closeAllMenus();
  await togglePlayback(item.uri, index);
  setSelectedPlayingIndex(index);


    setShowTranscriptIndex(null);
    setShowSummaryIndex(null);
    setShowNotesIndex(null);
  }}

                                  style={{ marginRight: 8 }}
                                >
                                  <Text style={styles.playIcon}>
                                    {playingUri === item.uri && isPlaying ? '❚❚' : '▶'}
                                  </Text>
                                </TouchableOpacity>

                                {/* 檔名顯示或編輯 */}
                                {
                                  editingState.type === 'name' && editingState.index === index ? (
                                    <TextInput
                                      style={[styles.recordingName, isCurrentPlaying && styles.playingText, { borderBottomWidth: 1, borderColor: colors.primary }]}
                                      value={editingState.text}
                                      onChangeText={(text) => setEditingState({ type: 'name', index, text })}
                                      autoFocus
                                      textAlign="center"
                                      onSubmitEditing={saveEditing}
                                      onBlur={saveEditing}
                                    />
                                  ) : (
                                    <TouchableOpacity
                                      onPress={async () => {
                                        closeAllMenus();
                                        await togglePlayback(item.uri, index);
                                        setSelectedPlayingIndex(index);
                                        if (item.transcript) {
                                          setShowTranscriptIndex(index);
                                          setShowSummaryIndex(null);
                                        } else {
                                          setShowTranscriptIndex(null);
                                          setShowSummaryIndex(null);
                                        }
                                      }}
                                      onLongPress={() => startEditing(index, 'name')}
                                    >
                                      <Text
                                        style={[styles.recordingName, isCurrentPlaying && styles.playingText]}
                                        numberOfLines={1}
                                        ellipsizeMode="tail"
                                      >
                                        {item.displayName || item.name}
                                      </Text>
                                    </TouchableOpacity>

                                  )
                                }
                              </View>


                              {/* 右邊：三點選單 or 💾 ✖️ 按鈕 */}
                              {editingState.type === 'name' && editingState.index === index ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <TouchableOpacity onPress={saveEditing}>
                                    <Text style={[styles.transcriptActionButton, { color: colors.primary }]}>💾</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity onPress={resetEditingState}>
                                    <Text style={styles.transcriptActionButton}>✖️</Text>
                                  </TouchableOpacity>
                                </View>
                              ) : (
                                renderMoreButton(index, 'main', styles.moreButton, setSelectedContext, closeAllMenus, styles, selectedContext)
                              )}

                            </View>

                            {/* 第二行：兩行小字摘要 */}
                            <View pointerEvents="box-none">
{showTranscriptIndex !== index &&
 showSummaryIndex !== index &&
 showNotesIndex !== index &&
 (item.notes || item.transcript) && (
                                  <TouchableOpacity
                                    onPress={async () => {
                                      closeAllMenus();
                                      setSelectedPlayingIndex(index);

                                      if (item.transcript) {
                                        setShowTranscriptIndex(index);
                                        setShowSummaryIndex(null);
                                      } else if (item.notes) {
                                        setShowNotesIndex(index);
                                        setShowTranscriptIndex(null);
                                        setShowSummaryIndex(null);
                                      } else {
                                        setShowTranscriptIndex(null);
                                        setShowSummaryIndex(null);
                                      }
{/*
                                      setTimeout(() => {
                                        flatListRef.current?.scrollToOffset({
                                          offset: index * (ITEM_HEIGHT + 43) - 10,
                                          animated: true,
                                        });
                                      }, 100 + index * 20); */}
                                    }}
                                  >
                                    {/* 小字摘要區塊 */}
                                    <View style={styles.transcriptBlock}>
                                      {item.notes ? (
                                        <Text
                                          style={styles.transcriptBlockText}
                                          numberOfLines={1}
                                          ellipsizeMode="tail"
                                        >
                                          {item.notes}
                                        </Text>
                                      ) : (
                                        <Text
                                          style={styles.transcriptBlockText}
                                          numberOfLines={1}
                                          ellipsizeMode="tail"
                                        >
                                          {item.transcript}
                                        </Text>
                                      )}
                                    </View>
                                  </TouchableOpacity>
                                )}

                            </View>

                            {/* 播放進度條 */}
                            {isCurrentPlaying && ((playingUri === item.uri ||
                              playingUri === item.derivedFiles?.enhanced?.uri ||
                              playingUri === item.derivedFiles?.trimmed?.uri) && (
                                <View style={styles.progressContainer}>
                                  {/* 進度條和時間顯示 */}
                                  <Slider
                                    minimumValue={0}
                                    maximumValue={playingUri === item.uri ? playbackDuration : 1}
                                    value={playingUri === item.uri ? playbackPosition : 0}
                                    onSlidingComplete={(value) => {
                                      if (playingUri === item.uri && currentSound) {
                                        currentSound.setCurrentTime(value / 1000);
                                        setPlaybackPosition(value);
                                      }
                                    }}
                                  />
                                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                    <Text style={styles.timeText}>
                                      {formatTime(playbackPosition)} / {formatTime(playbackDuration)}
                                    </Text>
                                    <TouchableOpacity
                                      onPress={(e) => {
                                        closeAllMenus();
                                        e.target.measureInWindow((x, y, width, height) => {
                                          setSpeedMenuIndex(index);
                                          setSpeedMenuPosition({ x, y: y + height });
                                        });
                                      }}
                                    >
                                      <Text style={[styles.timeText]}>{currentPlaybackRate}x</Text>
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              ))}

                            {/* 轉文字 & 重點摘要按鈕*/}
                            {(isCurrentPlaying 
                              ) && (
                                <View style={styles.actionButtons}>
                                  <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                                    {/* 談話筆記 */}
                                    <TouchableOpacity
                                      style={{
                                        paddingVertical: 5,
                                        paddingHorizontal: 8,
                                        backgroundColor: showNotesIndex === index
                                          ? colors.primary
                                          : colors.primary + '80',
                                        borderRadius: 8,
                                        opacity: isAnyProcessing ? 0.4 : 1,
                                      }}
                                      disabled={isAnyProcessing || (editingState.type === 'notes' && editingState.index !== null)}

onPress={() => {
  navigation.navigate('NoteDetail', {
    item,
    index,
    type: 'notes',
  });
}}
                                    >
                                      <Text
                                        style={{
                                          color: showNotesIndex === index ? colors.text : colors.subtext,
                                          fontSize: 13,
                                          textAlign: 'center',
                                          fontWeight: showNotesIndex === index ? 'bold' : 'normal',
                                        }}
                                      >談話筆記</Text>
                                    </TouchableOpacity>

                                    {/* 轉文字按鈕 */}
                                    <TouchableOpacity
                                      style={{
                                        paddingVertical: 5,
                                        paddingHorizontal: 8,
                                        backgroundColor: showTranscriptIndex === index
                                          ? colors.primary
                                          : colors.primary + '80',
                                        borderRadius: 8,
                                        opacity: isAnyProcessing ? 0.4 : 1,
                                      }}
                                      disabled={isAnyProcessing}
onPress={() => {
  navigation.navigate('NoteDetail', {
    item,
    index,
    type: 'transcript',
  });
}}
                                    >
                                      <Text
                                        style={{
                                          color: showTranscriptIndex === index ? colors.text : colors.subtext,
                                          fontSize: 13,
                                          textAlign: 'center',
                                          fontWeight: showTranscriptIndex === index ? 'bold' : 'normal',
                                        }}
                                      >錄音文檔</Text>
                                    </TouchableOpacity>

                                    {/* AI工具箱按鈕 */}
                                    <TouchableOpacity
                                      style={{
                                        paddingVertical: 5,
                                        paddingHorizontal: 8,
                                        backgroundColor: showSummaryIndex === index
                                          ? colors.primary
                                          : colors.primary + '80',
                                        borderRadius: 8,
                                        opacity: item.transcript && !isAnyProcessing ? 1 : 0.4,
                                      }}
                                      disabled={!item.transcript || isAnyProcessing}
onPress={() => {
  navigation.navigate('NoteDetail', {
    item,
    index,
    type: 'summary',
          summaryMode: 'summary',
  });
}}
                                    >
                                      <Text
                                        style={{
                                          color: showSummaryIndex === index ? colors.text : colors.subtext,
                                          fontSize: 13,
                                          textAlign: 'center',
                                          fontWeight: showSummaryIndex === index ? 'bold' : 'normal',
                                        }}
                                      >AI工具箱</Text>
                                    </TouchableOpacity>


                                    {/* 隱藏按鈕（只有已顯示 transcript 或 summary 才能點） */}
                                    <TouchableOpacity
                                      disabled={!canHide}
                                      onPress={() => {
                                        closeAllMenus();
                                        setShowTranscriptIndex(null);
                                        setShowSummaryIndex(null);
                                        setShowNotesIndex(null);
                                      }}
                                      style={{
                                        paddingVertical: 5,
                                        paddingHorizontal: 8,
                                        backgroundColor: canHide ? colors.primary : '#ccc',
                                        borderRadius: 8
                                      }}
                                    >
                                      <Text style={{ color: 'white', fontSize: 13 }}>-</Text>
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              )}

                            {/* 處理中loading（兄弟，不包進 actionButtons） */}
                            {(isTranscribingIndex === index || summarizingState?.index === index) && (
                              <Text style={{ color: colors.primary }}>
                                ⏳ {isTranscribingIndex === index
                                  ? '錄音筆記處理中...'
                                  : summarizeModes.find((m) => m.key === summarizingState?.mode)?.label + '處理中...'
                                }
                              </Text>
                            )}


                            {/* 內容顯示區 */}
                            {(isCurrentPlaying) && (
                              <>
                                {(showTranscriptIndex === index || showSummaryIndex === index || showNotesIndex === index) && (
                                  <>
                                    {renderNoteSection(index,
                                      showTranscriptIndex === index ? 'transcript'
                                        : showSummaryIndex === index ? 'summary'
                                          : showNotesIndex === index ? 'notes'
                                            : 'transcript')}
                                  </>
                                )}
                              </>
                            )}

                            {/* 衍生檔案列表 */}
                            {shouldShowDerivedFiles(title) && !shouldHideDefaultUI && hasDerivedFiles && (
                              <View style={styles.derivedFilesContainer}>
                                {/* 增強音質版本 */}
                                {item.derivedFiles?.enhanced && (
                                  <View style={styles.derivedFileRow}>
                                    {renderFilename(item.derivedFiles.enhanced.uri, item.derivedFiles.enhanced.name, index, true, '🔊 增強音質', isPlaying, playingUri ?? '', playRecording, closeAllMenus, styles)}
                                    {renderMoreButton(index, 'enhanced', styles.derivedMoreButton, setSelectedContext, closeAllMenus, styles, selectedContext)}
                                  </View>
                                )}

                                {/* 靜音剪輯版本 */}
                                {item.derivedFiles?.trimmed && (
                                  <View style={styles.derivedFileRow}>
                                    {renderFilename(item.derivedFiles.trimmed.uri, item.derivedFiles.trimmed.name, index, true, '✂️ 靜音剪輯', isPlaying, playingUri ?? '', playRecording, closeAllMenus, styles)}
                                    {renderMoreButton(index, 'trimmed', styles.derivedMoreButton, setSelectedContext, closeAllMenus, styles, selectedContext)}
                                  </View>
                                )}
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
                />
              )}

              {/* 摘要模式選單 (全域定位) */}
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
                            : recordings[summaryMenuContext.index]?.summaries?.[mode.key]
                              ? colors.primary + '10'
                              : 'transparent',
                        borderRadius: 4,
                      }}
                      onPress={() => {
                        closeAllMenus();
                        const idx = summaryMenuContext.index;
                        setSummaryMenuContext(null);
                        const isFree = mode.key === 'summary'; // ✅ 只有 summary 不收費
                        handleSummarize(idx, mode.key, !isFree);
                      }}
                    >
                      <Text style={{
                        color: colors.text,
                        fontWeight: recordings[summaryMenuContext.index]?.summaries?.[mode.key]
                          ? 'bold'
                          : 'normal',
                      }}>
                        {mode.label}
                        {recordings[summaryMenuContext.index]?.summaries?.[mode.key] ? ' ✓' : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
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
                        await setPlaybackRate(rate);
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
                  mode="main"
                  onPickAudio={pickAudio}
                  onCloseAllMenus={closeAllMenus}
                  sortOption={sortOption}
                  setSortOption={setSortOption}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  setIsLoggingIn={setIsLoggingIn}
                />

              </View>

              {/* 底部背景 */}
              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.container, paddingVertical: 10, borderTopWidth: 3, borderTopColor: colors.primary, }}>
                <RecorderControls
                  recording={recording}
                  recordingTimeRef={recordingTimeRef}
                  startRecording={startRecording}
                  stopRecording={stopRecording}
                  pickAudio={pickAudio}
                  setIsLoggingIn={setIsLoggingIn}
                  title={title}
                  currentDecibels={currentDecibels}
                  onToggleNotesModal={() => {
                    closeAllMenus();
                    if (showNotesModal && notesEditing && showNotesIndex !== null) {
                      const updated = [...recordings];
                      updated[showNotesIndex].notes = notesEditing;
                      setRecordings(updated);
                      saveRecordings(updated);
                    }
                    setShowNotesModal(prev => !prev);
                  }}

                />
              </View>

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
          {/* 登入遮罩 */}
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
          )}
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

          <TopUpModal
            visible={showTopUpModal}
            onClose={() => setShowTopUpModal(false)}
            onSelect={handleTopUp}
            styles={styles}
            colors={colors}
            products={productIds.map(id => ({ id, coins: productToCoins[id] }))} // 傳遞產品資訊
          />
          {/* 分割音檔 */}
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
              await handleTranscribe(pendingTranscribe.index, true); // ⬅️ forceFull
              setPendingTranscribe(null);
            }}
          />

          {/* 關鍵筆記 */}
          {showNotesModal && (
            <View style={{
              position: 'absolute',
              bottom: 95,
              left: 10,
              right: 10,
              backgroundColor: colors.container,
              borderRadius: 12,
              borderColor: colors.primary,
              padding: 12,
              elevation: 10,
              zIndex: 999,
            }}>
              <Text style={{
                color: colors.text,
                fontSize: 16,
                fontWeight: 'bold',
                marginBottom: 8,
              }}>談話筆記</Text>

              {/* 單行主標題輸入 */}
              <TextInput
                placeholder="輸入主標題（如：報價進度）"
                placeholderTextColor="#888"
                value={noteTitleEditing}
                onChangeText={setNoteTitleEditing}
                style={{
                  height: 36,
                  paddingHorizontal: 10,
                  backgroundColor: colors.background,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: colors.primary,
                  color: colors.text,
                  marginBottom: 12
                }}
              />

              {/* 多行補充內容 */}
              <TextInput
                placeholder="補充說明內容（可留空）"
                placeholderTextColor="#888"
                value={notesEditing}
                onChangeText={setNotesEditing}
                multiline
                style={{
                  minHeight: 60,
                  padding: 10,
                  backgroundColor: colors.background,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: colors.primary,
                  color: colors.text,
                  textAlignVertical: 'top'
                }}
              />
            </View>
          )}
        </SafeAreaView>
      </TouchableWithoutFeedback>  </>
  );
};

export default RecorderPageVoiceNote;