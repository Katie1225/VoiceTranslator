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
import { useRecordingContext } from '../constants/RecordingContext';
import LoginOverlay from '../components/LoginOverlay';
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

const RecorderPageVoiceNote = () => {
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
  const [currentPartialText, setCurrentPartialText] = useState('');
  const [playbackRates, setPlaybackRates] = useState<Record<string, number>>({});


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

  // 撥放速度
  const pendingPlaybackRateRef = useRef<number>(1.0);



  const resumeAfterTopUp = useRef<
    null | { type: 'transcribe'; index: number } | { type: 'summary'; index: number; mode: string }
  >(null);

  const onTopUpProcessingChangeRef = useRef<(isProcessing: boolean) => void>();


  /*
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
    */

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
  const { isLoggingIn, setIsLoggingIn } = useLoginContext();
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
  const autoSplitTimer = useRef<NodeJS.Timeout | null>(null);
  const startRecording = async () => {
    closeAllMenus();
    stopPlayback();

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
  /*
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
*/
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
              {searchQuery.trim().length > 0 && getFilteredSortedRecordings().length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    const itemsToAnalyze = getFilteredSortedRecordings();
                    navigation.navigate('TopicSummaryPage', {
                      items: itemsToAnalyze,
                      keyword: searchQuery.trim()
                    });
                  }}
                  style={{
                    marginTop: 60,
                    marginHorizontal: 16,
                    paddingVertical: 10,
                    backgroundColor: colors.primary,
                    borderRadius: 10,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: 'white', fontSize: 16 }}>
                    🧠 AI 分析「{searchQuery.trim()}」
                  </Text>
                </TouchableOpacity>
              )}

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
                        >

                          {/* 單個錄音項目的完整 UI */}
                          <View style={[styles.recordingItem]}>

                            {/* 替換原本的播放控制部分 */}
                            <PlaybackBar
                              item={item}
                              isPlaying={isPlayingThis}
                              isVisible={selectedPlayingIndex === index}
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
                              onRename={(newName) => {
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
                              itemIndex={index}
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
                                ) : undefined
                              }
                            />
                            {/* 兩行小字摘要 */}
                            <View pointerEvents="box-none">

                                (item.notes || item.transcript) && (
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
      {item.notes}
    </Text>
  ) : item.transcript?.trim() ? (
    <Text
      style={styles.transcriptBlockText}
      numberOfLines={1}
      ellipsizeMode="tail"
    >
      {item.transcript}
    </Text>
  ) : null}
</View>

                                  </TouchableOpacity>
                                )

                            </View>

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
                                        closeAllMenus();
                                        stopPlayback();
                                        navigation.navigate('NoteDetail', {
                                          item,
                                          index,
                                          type: 'notes'
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

                                      onPress={async () => {
                                        closeAllMenus();
                                        stopPlayback();
                                        navigation.navigate('NoteDetail', {
                                          item: recordings[index],
                                          index,
                                          type: 'transcript',
                                          shouldTranscribe: !recordings[index].transcript // 如果沒有轉文字才觸發
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
                                        closeAllMenus();
                                        stopPlayback();
                                        navigation.navigate('NoteDetail', {
                                          item,
                                          index,
                                          type: 'summary',
                                          summaryMode
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


                            {/* 內容顯示區 
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
                            )} */}

                            {/* 衍生檔案列表 
                            {shouldShowDerivedFiles(title) && !shouldHideDefaultUI && hasDerivedFiles && (
                              <View style={styles.derivedFilesContainer}>
                                // 增強音質版本 
                                {item.derivedFiles?.enhanced && (
                                  <View style={styles.derivedFileRow}>
                                    {renderFilename(item.derivedFiles.enhanced.uri, item.derivedFiles.enhanced.name, index, true, '🔊 增強音質', isPlaying, playingUri ?? '', playRecording, closeAllMenus, styles)}
                                    {renderMoreButton(index, 'enhanced', styles.derivedMoreButton, setSelectedContext, closeAllMenus, styles, selectedContext)}
                                  </View>
                                )}

                                // 靜音剪輯版本
                                {item.derivedFiles?.trimmed && (
                                  <View style={styles.derivedFileRow}>
                                    {renderFilename(item.derivedFiles.trimmed.uri, item.derivedFiles.trimmed.name, index, true, '✂️ 靜音剪輯', isPlaying, playingUri ?? '', playRecording, closeAllMenus, styles)}
                                    {renderMoreButton(index, 'trimmed', styles.derivedMoreButton, setSelectedContext, closeAllMenus, styles, selectedContext)}
                                  </View>
                                )}
                              </View>
                            )}  */}
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
          <LoginOverlay />

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