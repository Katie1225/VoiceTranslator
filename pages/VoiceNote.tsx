import React, { useState, useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  Alert,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Share,
  FlatList,
  Dimensions
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useKeepAwake } from 'expo-keep-awake';
import Slider from '@react-native-community/slider';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import BackgroundService from 'react-native-background-actions';
import RNFS from 'react-native-fs';
import { Linking } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';


import {
  RecordingItem,
  enhanceAudio,
  trimSilence,
  transcribeAudio,
  summarizeWithMode, summarizeModes
} from '../utils/audioHelpers';
import { useFileStorage } from '../utils/useFileStorage';
import { useAudioPlayer } from '../utils/useAudioPlayer';
import { createStyles } from '../styles/audioStyles';
import { ANDROID_AUDIO_ENCODERS, ANDROID_OUTPUT_FORMATS } from '../constants/AudioConstants';
import { lightTheme, darkTheme, additionalColors } from '../constants/Colors';
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
import { productIds, productToCoins, purchaseManager, setTopUpProcessingCallback } from '../utils/iap';
import { APP_VARIANT } from '../constants/variant';
import RecorderHeader from '../components/RecorderHeader';
import { debugLog, debugWarn, debugError } from '../utils/debugLog';
import { shareRecordingNote, shareRecordingFile } from '../utils/editingHelpers';

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

  // useKeepAwake(); // 保持清醒
  const { permissionStatus, requestPermissions } = uFPermissions();
  // 核心狀態
  const [recording, setRecording] = useState(false);
  const recordingStartTimestamp = useRef<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const [dbHistory, setDbHistory] = useState<number[]>([]);
  const audioRecorderPlayer = useRef(new AudioRecorderPlayer()).current;
  const [isTranscribingIndex, setIsTranscribingIndex] = useState<number | null>(null);
  const [isSummarizingIndex, setIsSummarizingIndex] = useState<number | null>(null);
  const [isEditingNotesIndex, setIsEditingNotesIndex] = useState<number | null>(null);
  const isAnyProcessing = isTranscribingIndex !== null || isSummarizingIndex !== null || isEditingNotesIndex !== null;
  const [summaryMode, setSummaryMode] = useState('summary');
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
  const [currentVolume, setCurrentVolume] = useState(0);
  const [currentDecibels, setCurrentDecibels] = useState(-160);
  const recordingTimeRef = useRef(0);



  // 顏色主題
  const [customPrimaryColor, setCustomPrimaryColor] = useState<string | null>(null);

  // 修改顏色主題
  const colors = {
    ...(isDarkMode ? darkTheme : lightTheme),
    primary: customPrimaryColor || (isDarkMode ? darkTheme.primary : lightTheme.primary)
  };
  const styles = createStyles(colors);

  const saveThemePreference = async (isDark: boolean) => {
    await AsyncStorage.setItem('themeMode', isDark ? 'dark' : 'light');
  };

  const savePrimaryColorPreference = async (color: string | null) => {
    await AsyncStorage.setItem('primaryColor', color || '');
  };

  const loadThemePreference = async () => {
    const theme = await AsyncStorage.getItem('themeMode');

    if (theme === 'dark') {
      setIsDarkMode(true);
    } else if (theme === 'light') {
      setIsDarkMode(false);
    } else {
      // 🟢 第一次載入預設為 dark
      setIsDarkMode(true);
      await AsyncStorage.setItem('themeMode', 'dark');
    }
  };


  const loadPrimaryColorPreference = async () => {
    const color = await AsyncStorage.getItem('primaryColor');
    if (color !== null && color !== '') {
      setCustomPrimaryColor(color);
    }
  };


  const toggleTheme = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    saveThemePreference(newMode);
  };

  const handleSetPrimaryColor = (color: string | null) => {
    setCustomPrimaryColor(color);
    savePrimaryColorPreference(color);
  };


  const [resumeAfterTopUp, setResumeAfterTopUp] = useState<null | { index: number }>(null);
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
    try {
      // 1. 請求儲值
      await purchaseManager.requestPurchase(productId);
      setShowTopUpModal(false);

      // 2. 等待金幣更新（不再需要手動同步，因為 handlePurchaseUpdate 已經處理）
      // 3. 清除中斷操作的標記
      setResumeAfterTopUp(null);

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

  // useEffect 初始化桌面色彩
  useEffect(() => {
    loadThemePreference();
    loadPrimaryColorPreference();
  }, []);

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

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (recording) {
      recordingTimeRef.current = 0;
      timer = setInterval(() => {
        recordingTimeRef.current += 1;
      }, 1000);
    }

    return () => clearInterval(timer);
  }, [recording]);


  /*
  const dbHistoryRef = useRef<number[]>([]);
  
  useEffect(() => {
    let dbTimer: NodeJS.Timeout;
  
    if (recording) {
      dbTimer = setInterval(() => {
        dbHistoryRef.current = Array.from({ length: 20 }, () =>
          -Math.floor(Math.random() * 60 + 40)
        );
      }, 500);
    }
  
    return () => clearInterval(dbTimer);
  }, [recording]);
  
  */

  // 在組件掛載時載入
  useEffect(() => {
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
      } as any);

      GlobalRecorderState.isRecording = true;
      GlobalRecorderState.filePath = filePath;
      GlobalRecorderState.startTime = Date.now();
      setRecording(true);
      recordingTimeRef.current = 0;
      setNotesEditing(''); // 重置

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
  const stopRecording = async () => {
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

      if (fileInfo.size > 0) {
        const now = new Date();
        const name = uri.split('/').pop() || `rec_${now.getTime()}.m4a`;

        // 取得錄音長度（秒）

        let durationText = '?秒';

        try {
          const { sound, status } = await Audio.Sound.createAsync({ uri: normalizedUri });
          if (status.isLoaded && status.durationMillis != null) {
            const totalSeconds = Math.round(status.durationMillis / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            if (hours > 0) {
              durationText = `${hours}小${minutes}分${seconds}秒`;
            } else if (minutes > 0) {
              durationText = `${minutes}分${seconds}秒`;
            } else {
              durationText = `${seconds}秒`;
            }
          }
          await sound.unloadAsync();
        } catch (e) {
          debugWarn("⚠️ 無法取得音檔長度", e);
        }

        // 組合顯示名稱
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');
        const dateStr = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
        const displayName = `[錄音] ${durationText} ${hours}:${minutes}:${seconds} ${now.getMonth() + 1}/${now.getDate()}`;

        const newItem: RecordingItem = {
          uri: normalizedUri,
          name,
          displayName,
          derivedFiles: {},
          date: now.toISOString(),
          notes: notesEditing, // ✅ 存進去
        };

        setShowTranscriptIndex(null);   // 🔧 錄音完後，確保不會自動顯示 transcript
        setShowSummaryIndex(null);      // 🔧 順便清掉 summary 展開
        resetEditingState(); // 清除所有編輯狀態

        setRecordings(prev => [newItem, ...prev]);
        setSelectedPlayingIndex(0);

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

        // 讀取音檔長度
        const { sound, status } = await Audio.Sound.createAsync({ uri });
        let durationText = '?秒';
        if (status.isLoaded && status.durationMillis != null) {
          const seconds = Math.round(status.durationMillis / 1000);
          durationText = `${seconds}秒`;
        }
        await sound.unloadAsync();

        // 組 displayName
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const secondsStr = now.getSeconds().toString().padStart(2, '0');

        const displayName = `[錄音] ${durationText} ${hours}:${minutes}:${secondsStr} ${now.getMonth() + 1}/${now.getDate()}`;

        const newItem: RecordingItem = {
          uri,
          name,
          displayName,
          derivedFiles: {},
        };

        setRecordings(prev => [newItem, ...prev]);
      }
    } catch (err) {
      debugError('❌ 選取音檔失敗', err);
    }
  };



  // 關閉所有彈出菜單
  const closeAllMenus = (preserveEditing = false) => {
    setSelectedIndex(null);
    setSpeedMenuIndex(null);
    setSelectedContext(null);
    setSummaryMenuContext(null);

    if (!preserveEditing) {
      resetEditingState(); // 清掉正在編輯的
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
    const raw = type === 'name'
      ? recordings[index]?.displayName || recordings[index]?.name
      : type === 'transcript'
        ? recordings[index]?.transcript
        : type === 'summary'
          ? recordings[index]?.summaries?.[summaryMode] || ''
          : recordings[index]?.notes || '';
    ;

    setEditingState({ type, index, text: raw || '' });
    setSelectedIndex(null);
  };

  const saveEditing = () => {
    const { type, index, text } = editingState;
    if (index === null || !text.trim()) return;

    const updated = recordings.map((rec, i) => {
      if (i !== index) return rec;

      if (type === 'name') {
        return { ...rec, displayName: text };
      } else if (type === 'transcript') {
        return { ...rec, transcript: text };
      } else if (type === 'summary') {
        return {
          ...rec,
          summaries: {
            ...(rec.summaries || {}),
            [summaryMode]: text,
          },
        };
      } else if (type === 'notes') {
        return { ...rec, notes: text };
      }
      return rec;
    });

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
          const updated = recordings.map((rec, i) => {
            if (i !== index) return rec;
            const newSummaries = { ...(rec.summaries || {}) };
            delete newSummaries[summaryMode];
            return { ...rec, summaries: newSummaries };
          });

          setRecordings(updated);
          await saveRecordings(updated);

          // 檢查剩餘可用的摘要模式
          const remainingModes = Object.keys(updated[index]?.summaries || {})
            .filter(k => updated[index]?.summaries?.[k]);

          if (remainingModes.length > 0) {
            // 優先選擇預設模式順序
            const preferredOrder = ['summary', 'analysis', 'email', 'news', 'ai_answer'];
            const nextMode = preferredOrder.find(k => remainingModes.includes(k)) || remainingModes[0];
            setSummaryMode(nextMode); // 更新全局摘要模式
          } else {
            setSummaryMode('summary'); // 重置為預設模式
          }

          setShowSummaryIndex(null);
          setIsSummarizingIndex(null);
        }
        if (type === 'transcript') {
          const updated = recordings.map((rec, i) => {
            if (i !== index) return rec;
            return { ...rec, transcript: '' };
          });

          setRecordings(updated);
          await saveRecordings(updated);
          setShowTranscriptIndex(null);
          setIsTranscribingIndex(null);
        }
        if (type === 'notes') {
          const updated = recordings.map((rec, i) => {
            if (i !== index) return rec;
            return { ...rec, notes: '' };
          });

          setRecordings(updated);
          await saveRecordings(updated);
          resetEditingState();
          setIsEditingNotesIndex(null);
        }
      },

      onShare: async () => {
        await shareRecordingNote(recordings[index], type, summaryMode);
        if (type === 'summary') {
          setIsSummarizingIndex(null);
        }
      },
      styles,
      colors,
    });
  };

  //轉文字邏輯
  const handleTranscribe = async (index: number) => {

    const item = recordings[index];

    if (item.transcript) {
      setShowTranscriptIndex(index);
      setShowSummaryIndex(null);
      return;
    }

    setIsTranscribingIndex(index);

    try {
      const stored = await AsyncStorage.getItem('user');
      debugLog('📦 本地 user 資料:', stored);

      let user = null;

      if (!stored) {
        setIsTranscribingIndex(null);
        Alert.alert("請先登入", "使用錄音筆記功能需要登入", [
          { text: "取消", style: "cancel" },
          {
            text: "登入",
            onPress: () => {
              setIsTranscribingIndex(null);
              handleLogin(setIsLoggingIn);
            }
          }
        ]);
        return;
      }
      user = JSON.parse(stored);

      // 強制同步最新 user 資料
      // await loadUserAndSync();
      // const freshUser = await AsyncStorage.getItem('user');
      // const updatedUser = freshUser ? JSON.parse(freshUser) : user;


      const { sound, status } = await Audio.Sound.createAsync({ uri: item.uri });
      if (!status.isLoaded) throw new Error("無法取得音檔長度");
      const durationSec = Math.ceil((status.durationMillis ?? 0) / 1000);
      await sound.unloadAsync();

      const coinsToDeduct = Math.ceil(durationSec / (COIN_UNIT_MINUTES * 60)) * COIN_COST_PER_UNIT;

      if (user.coins < coinsToDeduct) {

        purchaseManager.addPendingAction({ type: 'transcribe', index });
        Alert.alert(
          "金幣不足",
          `此錄音需要 ${coinsToDeduct} 金幣，你目前剩餘 ${user.coins} 金幣`,
          [
            { text: "取消", onPress: () => setIsTranscribingIndex(null) },
            {
              text: "立即儲值",
              onPress: () => {
                setResumeAfterTopUp({ index });
                setShowTopUpModal(true);
              }
            }
          ]
        );
        return;
      }

      const result = await transcribeAudio(item, async (updatedTranscript) => {
        setRecordings(prev => {
          const updated = prev.map((rec, i) =>
            i === index ? { ...rec, transcript: updatedTranscript } : rec
          );
          saveRecordings(updated).catch(e => debugError('保存失敗:', e));
          return updated;
        });
        setShowTranscriptIndex(index);
        setShowSummaryIndex(null);
      }, userLang.includes('CN') ? 'cn' : 'tw');

      if (!result?.transcript?.text?.trim()) {
        throw new Error("無法取得有效的轉譯結果");
      }

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
        note: `轉文字：${item.displayName || item.name || ''}，長度 ${durationSec}s，扣 ${coinsToDeduct} 金幣`
      });

      if (!coinResult.success) {
        Alert.alert("轉換成功，但扣金幣失敗", coinResult.message || "請稍後再試");
      }


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
    requirePayment: boolean = false
  ) => {

    const item = recordings[index];

    // ✅ 已有摘要就直接顯示
    if (item.summaries?.[mode]) {
      setSummaryMode(mode);
      setShowTranscriptIndex(null);
      setShowSummaryIndex(index);
      return;
    }

    let user: any = null;

    // ✅ 需要付費 → 確認登入與金幣
    if (requirePayment) {
      const stored = await AsyncStorage.getItem('user');
      if (!stored) {
        Alert.alert("請先登入", "使用 AI 工具箱需要登入", [
          { text: "取消", style: "cancel" },
          { text: "登入", onPress: () => handleLogin(setIsLoggingIn) },
        ]);
        return;
      }

      // 取消上雲端節省時間  await loadUserAndSync();
      const fresh = await AsyncStorage.getItem('user');
      if (!fresh) {
        Alert.alert("錯誤", "無法取得使用者資料");
        return;
      }

      user = JSON.parse(fresh);

      if (user.coins < COIN_COST_AI) {
        Alert.alert(
          "金幣不足",
          `「${summarizeModes.find(m => m.key === mode)?.label || 'AI 工具'}」需要 ${COIN_COST_AI} 金幣，你目前剩餘 ${user.coins} 金幣`,
          [
            { text: "取消", style: "cancel" },
            { text: "儲值", onPress: () => setShowTopUpModal(true) },
          ]
        );
        return;
      }
    }

    // ✅ 開始處理摘要
    setIsSummarizingIndex(index);

    try {
      const fullPrompt = item.notes?.trim()
        ? `使用者補充筆記：${item.notes} 錄音文字如下：${item.transcript}`
        : item.transcript || '';

      const summary = await summarizeWithMode(
        fullPrompt,
        mode,
        userLang.includes('CN') ? 'cn' : 'tw'
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

      setRecordings(updated);
      await saveRecordings(updated);

      // ✅ 如果是付費，扣金幣
      if (requirePayment && user) {

        const result = await logCoinUsage({
          id: user.id,
          email: user.email,
          name: user.name,
          action: mode,
          value: -COIN_COST_AI,
          note: `${mode}：${item.displayName || item.name} 扣 ${COIN_COST_AI} 金幣`,
        });
      }

      // ✅ 顯示摘要
      setSummaryMode(mode);
      setShowTranscriptIndex(null);
      setShowSummaryIndex(index);
    } catch (err) {
      Alert.alert("❌ 摘要失敗", (err as Error).message || "處理失敗");
    } finally {
      setIsSummarizingIndex(null);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={() => closeAllMenus(false)}>
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

            {/* 整個上半段白色背景 */}
            <View style={{
              backgroundColor: colors.container,
              paddingHorizontal: 6,
              paddingTop: 20,
              minHeight: 110,
              borderBottomWidth: 3,
              borderBottomColor: colors.primary,
            }}>
              <View style={{
                backgroundColor: colors.container,
              }}>
                <RecorderHeader
                  recording={recording}
                  recordingTimeRef={recordingTimeRef}
                  startRecording={startRecording}
                  stopRecording={stopRecording}
                  pickAudio={pickAudio}
                  setIsLoggingIn={setIsLoggingIn}
                  isDarkMode={isDarkMode}
                  toggleTheme={toggleTheme}
                  customPrimaryColor={customPrimaryColor}
                  setCustomPrimaryColor={handleSetPrimaryColor}
                  styles={styles}
                  colors={colors}
                  title={title}
                />
              </View>
            </View>

            {/* 關鍵筆記 */}

            {recording && (
              <View style={{ paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.container, borderRadius: 12, margin: 10 }}>
                <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 4 }}>📝 談話關鍵字</Text>
                <TextInput
                  placeholder="輸入關鍵字或複製貼上會議通知"
                  placeholderTextColor={colors.text + '80'}
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
                    textAlignVertical: 'top',
                  }}
                />
              </View>
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
                  closeAllMenus(true); // ✅ 不清除正在編輯的內容與按鈕
                  setSummaryMenuContext(null); // 可以額外手動清這些 popup 類的
                }}
                scrollEnabled={!editingState.type}  // 當有任何編輯狀態時禁用滾動
                keyboardShouldPersistTaps="handled"
                style={styles.listContainer}
                data={recordings}
                keyExtractor={(item) => item.uri}  // 改用 uri 作為 key
                contentContainerStyle={{ paddingBottom: 40 }}
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
                                  if (item.transcript) {
                                    setShowTranscriptIndex(index);
                                    setShowSummaryIndex(null);
                                  } else {
                                    setShowTranscriptIndex(null);
                                    setShowSummaryIndex(null);
                                  }
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
                                  <TouchableOpacity onPress={() => startEditing(index, 'name')}>
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
                            {(!isCurrentPlaying) && (
                              <TouchableOpacity
                                onPress={async () => {
                                  closeAllMenus();
                                  setSelectedPlayingIndex(index);

                                  if (item.transcript) {
                                    setShowTranscriptIndex(index);
                                    setShowSummaryIndex(null);
                                  } else {
                                    setShowTranscriptIndex(null);
                                    setShowSummaryIndex(null);
                                  }

                                  const baseDelay = 100;
                                  const extraDelayPerItem = 20;
                                  const delay = baseDelay + (index * extraDelayPerItem);
                                  setTimeout(() => {
                                    flatListRef.current?.scrollToOffset({
                                      offset: index * (ITEM_HEIGHT + 43) - 10,
                                      animated: true,
                                    });
                                  }, delay);

                                  if (item.transcript) {
                                    setShowTranscriptIndex(index);
                                    setShowSummaryIndex(null);
                                  } else {
                                    setShowTranscriptIndex(null);
                                    setShowSummaryIndex(null);
                                  }
                                }}
                              >
                                {/* 小字摘要區塊 */}
                                {!isCurrentPlaying && item.transcript && (
                                  <View style={styles.transcriptBlock}>
                                    <Text
                                      style={styles.transcriptBlockText}
                                      numberOfLines={2}
                                      ellipsizeMode="tail"
                                    >
                                      {item.transcript}
                                    </Text>
                                  </View>
                                )}


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
                                  style={{ flex: 1 }}
                                  minimumValue={0}
                                  maximumValue={playbackDuration}
                                  value={playbackPosition}
                                  onSlidingComplete={async (value) => {
                                    if (currentSound) {
                                      await currentSound.setPositionAsync(value);
                                      setPlaybackPosition(value);
                                    }
                                  }}
                                  minimumTrackTintColor={colors.primary}
                                  maximumTrackTintColor="#ccc"
                                  thumbTintColor={colors.primary}
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

                          {/* 轉文字 & 重點摘要按鈕 */}
                          {(isCurrentPlaying || !item.transcript) && (
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
                                    setShowTranscriptIndex(null);
                                    setShowSummaryIndex(null);
                                    setShowNotesIndex(null);
                                    setShowNotesIndex(index);
                                  }}
                                >
                                  <Text style={{ color: 'white', fontSize: 13 }}>談話筆記</Text>
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
                                    closeAllMenus();
                                    setShowTranscriptIndex(null);
                                    setShowSummaryIndex(null);
                                    setShowNotesIndex(null);
                                    handleTranscribe(index);
                                  }}
                                >
                                  <Text style={{ color: 'white', fontSize: 13 }}>錄音文檔</Text>
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
                                  onPress={(e) => {
                                    closeAllMenus();
                                    setShowTranscriptIndex(null);
                                    setShowSummaryIndex(null);
                                    setShowNotesIndex(null);
                                    // 取得按鈕位置，彈出選單
                                    e.target.measureInWindow((x, y, width, height) => {
                                      setSummaryMenuContext({ index, position: { x, y: y + height } });
                                    });
                                  }}
                                >
                                  <Text style={{ color: 'white', fontSize: 13, textAlign: 'center' }}>AI工具箱</Text>
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
                          {(isTranscribingIndex === index || isSummarizingIndex === index || isEditingNotesIndex !== null) && (
                            <View style={{ marginTop: 6, alignItems: 'flex-start', paddingHorizontal: 12 }}>
                              {isTranscribingIndex === index && (
                                <Text style={{ color: colors.primary }}>⏳ 錄音筆記處理中...</Text>
                              )}
                              {isSummarizingIndex === index && !item.summaries?.[summaryMode] && (
                                <Text style={{ color: colors.primary }}>
                                  ⏳ {summarizeModes.find((m) => m.key === summaryMode)?.label || '重點整理'}處理中...
                                </Text>
                              )}
                            </View>
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

                onTrimSilence={async (index) => {
                  const item = recordings[index];
                  try {
                    const trimmed = await trimSilence(item.uri, item.name);
                    const { sound: originalSound } = await Audio.Sound.createAsync({ uri: item.uri });
                    const { sound: trimmedSound } = await Audio.Sound.createAsync({ uri: trimmed.uri });
                    const origStatus = await originalSound.getStatusAsync();
                    const trimStatus = await trimmedSound.getStatusAsync();
                    await originalSound.unloadAsync();
                    await trimmedSound.unloadAsync();
                    if (origStatus.isLoaded && trimStatus.isLoaded) {
                      const origSec = Math.round((origStatus.durationMillis ?? 0) / 1000);
                      const trimSec = Math.round((trimStatus.durationMillis ?? 0) / 1000);
                      setShowTranscriptIndex(null);
                      setShowSummaryIndex(null);
                      resetEditingState();
                      setRecordings(prev => prev.map((rec, i) =>
                        i === index
                          ? {
                            ...rec,
                            isTrimmed: true,
                            derivedFiles: {
                              ...rec.derivedFiles,
                              trimmed,
                            },
                          }
                          : rec
                      ));

                      Alert.alert('靜音剪輯完成', `${item.name}\n原長：${origSec}s → 剪後：${trimSec}s`);
                    }
                  } catch (err) {
                    Alert.alert('剪輯失敗', (err as Error).message);
                  }
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
              backgroundColor: colors.primary,
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
      </SafeAreaView>
    </TouchableWithoutFeedback>


  );
};

export default RecorderPageVoiceNote;