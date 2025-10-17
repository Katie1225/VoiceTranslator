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
  ScrollView,
  Dimensions
} from 'react-native';
import SoundLevel from 'react-native-sound-level';
import * as FileSystem from 'expo-file-system'; // ✅ 統一使用 expo-file-system
import { useKeepAwake } from 'expo-keep-awake';
import {
  useAudioRecorder,
  useAudioRecorderState,
  setAudioModeAsync,
  RecordingOptions,
  RecordingPresets
} from 'expo-audio';
import BackgroundService from 'react-native-background-actions';
import { Linking } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { useLoginContext } from '../constants/LoginContext';
import PlaybackBar from '../components/PlaybackBar';
import { useTranslation } from '../constants/i18n';
import {
  RecordingItem, transcribeAudio, summarizeWithMode, summarizeModes, notifyAwsRecordingEvent,
  notitifyWhisperEvent, splitAudioSegments,
  parseDateTimeFromDisplayName, generateDisplayNameParts, generateRecordingMetadata,
} from '../utils/audioHelpers';

import { useFileStorage } from '../utils/useFileStorage';
import { useAudioPlayer } from '../utils/useAudioPlayer';
import { ANDROID_AUDIO_ENCODERS, ANDROID_OUTPUT_FORMATS } from '../constants/AudioConstants';
import RecorderHeader from '../components/RecorderHeader';

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
import { APP_TITLE, debugValue, SEGMENT_DURATION, setSegmentDuration } from '../constants/variant';

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { MaterialCommunityIcons } from '@expo/vector-icons';

GoogleSignin.configure({
  webClientId: '732781312395-blhdm11hejnni8c2k9orf7drjcorp1pp.apps.googleusercontent.com',
  offlineAccess: true,
});

const GlobalRecorderState = {
  isRecording: false,
  filePath: '',
  startTime: 0,
};

const RecorderPageVoiceNote = () => {
  const title = APP_TITLE;
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useKeepAwake();
  const { permissionStatus, requestPermissions } = uFPermissions();

  // 核心狀態
  const [recording, setRecording] = useState(false);
  const recordingStartTimestamp = useRef<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const { colors, styles, isDarkMode, toggleTheme, customPrimaryColor, setCustomPrimaryColor } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<'latest' | 'oldest' | 'size' | 'name-asc' | 'name-desc' | 'starred'>('latest');
  const notesScrollRef = useRef<ScrollView>(null);

  // ✅ 使用 expo-audio 錄音器
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

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
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

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
  const ITEM_HEIGHT = 80;

  // 音量狀態
  const [currentDecibels, setCurrentDecibels] = useState(-160);
  const recordingTimeRef = useRef(0);

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

  // 切分音檔
  useEffect(() => {
    AsyncStorage.getItem('VN_SEGMENT_DURATION').then(v => {
      if (v) setSegmentDuration(Number(v));
    });
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

  // 在元件內加入「分段狀態」與小工具
  type NoteSeg = {
    startSec: number;
    endSec: number;
    label: string;
    text: string;
  };

  const [noteSegs, setNoteSegs] = useState<NoteSeg[]>([]);
  const lastSegIdxRef = useRef<number>(-1);
  const [draftLine, setDraftLine] = useState('');

  // 小工具：時間 → 00:00
  const mmss = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const segLabel = (start: number, end: number) => `${mmss(start)}–${mmss(end)}`;

  // 確保目前時間所在的段已經建立（灰色分隔條）
  const ensureSegForTime = (sec: number, totalSec?: number) => {
    const segIdx = Math.floor(sec / SEGMENT_DURATION);
    if (segIdx > lastSegIdxRef.current) {
      const start = segIdx * SEGMENT_DURATION;
      const end = totalSec ? Math.min(start + SEGMENT_DURATION, totalSec) : start + SEGMENT_DURATION;
      setNoteSegs(prev => [
        ...prev,
        { startSec: start, endSec: end, label: segLabel(start, end), text: '' }
      ]);
      lastSegIdxRef.current = segIdx;
    }
  };

  // 按 Enter 時，把這一行收進「當下」那一段
  const submitDraftLine = () => {
    const text = draftLine.trim();
    if (!text) return;

    ensureSegForTime(recordingTimeRef.current);

    setNoteSegs(prev => {
      const idx = Math.floor(recordingTimeRef.current / SEGMENT_DURATION);
      const arr = [...prev];
      const before = arr[idx]?.text || '';
      arr[idx] = { ...arr[idx], text: before ? `${before}\n${text}` : text };
      return arr;
    });

    setDraftLine('');
  };

  // 展平成純文字（相容你現有的 notes 儲存）
  // 修復筆記儲存邏輯 - 只儲存有實際內容的筆記
  const flattenNoteSegs = (segs: NoteSeg[]) => {
    const validSegs = segs.filter(s => s.text.trim());
    if (validSegs.length === 0) return '';

    return validSegs
      .map(s => `${s.label}\n${s.text.trim()}`)
      .join('\n\n');
  };

  // 筆記模態框相關效果
  useEffect(() => {
    if (!showNotesModal) return;

    ensureSegForTime(Math.max(0, recordingTimeRef.current));

    const id = setInterval(() => {
      ensureSegForTime(recordingTimeRef.current);
    }, 500);

    return () => clearInterval(id);
  }, [showNotesModal]);

  // 清掉上一段錄音筆記
  const resetNotesDraft = () => {
    setNoteSegs([]);
    lastSegIdxRef.current = -1;
    setDraftLine('');
    setNoteTitleEditing('');
    setNotesEditing('');
  };

  // 所有的文字編輯宣告
  const [editingState, setEditingState] = useState<{
    type: 'transcript' | 'summary' | 'name' | 'notes' | null;
    index: number | null;
    text: string;
    mode?: string;
  }>({ type: null, index: null, text: '' });

  const { recordings, setRecordings, setLastVisitedRecording } = useRecordingContext();

  const {
    isLoading,
    loadRecordings,
    saveRecordings,
    safeDeleteFile,
    updateRecordingAtIndex,
    saveAudioFile, // ✅ 添加這一行
    getRecordingsDirectory // ✅ 添加這一行
  } = useFileStorage(setRecordings);

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

  // 分貝
  useEffect(() => {
    if (recording) {
      SoundLevel.start();
      SoundLevel.onNewFrame = (data) => {
        setCurrentDecibels(data.value);
      };
    } else {
      SoundLevel.stop();
    }

    return () => {
      SoundLevel.stop();
    };
  }, [recording]);

  useEffect(() => {
    return () => {
      SoundLevel.stop();
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

  // ✅ 背景錄音任務 - 使用 expo-file-system
  const task = async (args: any) => {
    const path = args?.path;
    const startTime = args?.startTime || Date.now();

    if (!path) {
      debugError("❌ 無錄音路徑");
      return;
    }

    debugLog("🎤 開始背景錄音任務:", path);

    try {
      // ✅ 設定音訊模式
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
      });

      // ✅ 使用 expo-audio 開始錄音
      await recorder.prepareToRecordAsync();
      recorder.record();

      debugLog("✅ expo-audio 背景錄音啟動完成");

      // ✅ 保持背景任務運行並手動計算時間
      await new Promise(async (resolve) => {
        while (BackgroundService.isRunning()) {
          // 🚨 基於開始時間計算經過的秒數
          const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
          recordingTimeRef.current = elapsedSec;

          await new Promise(res => setTimeout(res, 1000));
        }
        resolve(true);
      });

      debugLog("🛑 背景任務結束");

    } catch (err) {
      debugError("❌ 背景錄音任務錯誤：", err);
      GlobalRecorderState.isRecording = false;
    }
  };

  // 篩選排序
  const getFilteredSortedRecordings = () => {
    const query = searchQuery.trim().toLowerCase();
    let filtered: RecordingItem[];

    if (!query) {
      filtered = recordings;
    } else {
      filtered = recordings.filter((r) => {
        const matchSelf =
          r.displayName?.toLowerCase().includes(query) ||
          r.name?.toLowerCase().includes(query) ||
          r.notes?.toLowerCase().includes(query) ||
          r.transcript?.toLowerCase().includes(query) ||
          (query === 'star' && r.isStarred);

        const matchSplitParts = r.derivedFiles?.splitParts?.some((p) =>
          (p.displayName || '').toLowerCase().includes(query) ||
          (p.notes || '').toLowerCase().includes(query) ||
          (p.transcript || '').toLowerCase().includes(query)
        );

        return matchSelf || matchSplitParts;
      });
    }

    // 排序邏輯
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
          return bStar - aStar;
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

  // ✅ 開始錄音 - 使用 expo-file-system
  const autoSplitTimer = useRef<NodeJS.Timeout | null>(null);
  const startRecording = async () => {
    closeAllMenus();
    stopPlayback();

    if (permissionStatus === 'denied') {
      Alert.alert(
        t('permissionDeniedTitle'),
        t('permissionDeniedMessage'),
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('goToSettings'),
            onPress: () => Linking.openSettings()
          }
        ]
      );
      return;
    }

    try {
      const now = new Date();
      const filename = `rec_${now.getTime()}.m4a`;

      // ✅ 使用 expo-file-system 的目錄
      const recordingsDir = await getRecordingsDirectory();
      const filePath = `${recordingsDir}${filename}`;

      debugLog("📁 錄音儲存路徑:", filePath);

      // 🚨 記錄開始時間
      const recordingStartTime = Date.now();
      GlobalRecorderState.startTime = recordingStartTime;
      recordingTimeRef.current = 0; // 重置為0

      // ✅ 先設定音訊模式
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
      });

      // ✅ 啟動 BackgroundService
      await BackgroundService.start(task, {
        taskName: '錄音中',
        taskTitle: '背景錄音中',
        taskDesc: '請勿關閉 App，錄音持續中...',
        taskIcon: {
          name: 'ic_launcher',
          type: 'mipmap',
        },
        parameters: {
          path: filePath,
          startTime: recordingStartTime
        },
        allowWhileIdle: true,
        foregroundServiceType: 'microphone',
      } as any);

      // 更新狀態
      GlobalRecorderState.isRecording = true;
      GlobalRecorderState.filePath = filePath;
      GlobalRecorderState.startTime = Date.now();
      setRecording(true);

      recordingTimeRef.current = 0;
      resetNotesDraft();
      setShowNotesModal(true);

      // 錄音時間上限
      setTimeout(() => {
        if (GlobalRecorderState.isRecording) {
          stopRecording();
          Alert.alert(t('recordingLimitReachedTitle'), t('recordingLimitReachedMessage'));
        }
      }, 180 * 60 * 1000);

      const userId = 'Katie';
      await notifyAwsRecordingEvent('start', {
        timestamp: Date.now(),
        userId,
      });

      await notitifyWhisperEvent('start', {
        timestamp: Date.now(),
        userId,
      });

      debugLog("✅ 前景和背景錄音都啟動成功");

    } catch (err) {
      debugError("❌ 錄音啟動錯誤：", err);
      Alert.alert(t('recordingFailed'), (err as Error).message || t('checkPermissionOrStorage'));
      setRecording(false);
      GlobalRecorderState.isRecording = false;
    }
  };

  // ✅ 停止錄音 - 使用 expo-file-system
  let stopInProgress = false;
  const stopRecording = async () => {
    if (stopInProgress) {
      debugWarn('⛔️ stopRecording 已在執行中，跳過');
      return;
    }
    stopInProgress = true;

    try {
      // ✅ 先停止背景服務
      await BackgroundService.stop();

      // ✅ 停止 expo-audio 錄音
      if (recorderState.isRecording) {
        await recorder.stop();
      }

      setRecording(false);
      recordingStartTimestamp.current = null;
      GlobalRecorderState.isRecording = false;

      // ✅ 取得錄音檔案 URI
      const uri = recorder.uri;
      if (!uri) {
        Alert.alert(t('recordingFailed'), t('recordFileMissing'));
        return;
      }

      // 使用 expo-file-system 檢查檔案
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        Alert.alert(t('recordingFailed'), t('recordFileMissing'));
        return;
      }

      debugLog("📄 錄音檔案資訊:", fileInfo);

      // ✅ 加強判斷：如果檔案太小，就刪除！
      if (fileInfo.size < 1000) {
        await FileSystem.deleteAsync(uri);
        return;
      }

      const name = `rec_${Date.now()}.m4a`;

      // ✅ 使用 saveAudioFile 將檔案保存到永久位置
      const permanentUri = await saveAudioFile(uri, name);

      if (fileInfo.size > 0) {
        const metadata = await generateRecordingMetadata(permanentUri);
        const { label, metadataLine } = generateDisplayNameParts(noteTitleEditing, metadata.durationSec, t);
        const displayName = label;
        const displayDate = metadataLine;
        const flatNotes = flattenNoteSegs(noteSegs);
        const finalNotes = flatNotes || notesEditing || '';

        const newItem: RecordingItem = {
          size: fileInfo.size,
          uri: permanentUri,
          name,
          displayName,
          displayDate,
          derivedFiles: {},
          date: metadata.date,
          notes: finalNotes, // 只有當有實際內容時才設置
          durationSec: metadata.durationSec,
        };
        (newItem as any).tempNoteSegs = noteSegs;

        debugLog('📌 建立新錄音項目', { name, displayName, uri: permanentUri });

        setRecordings(prev => {
          const now = Date.now();
          const recentItem = prev[0];
          if (
            recentItem &&
            Math.abs(now - parseInt(recentItem.name.replace('rec_', '').replace('.m4a', ''))) < 2000
          ) {
            debugWarn('⛔️ 距離上一筆錄音太近，疑似重複寫入，已跳過');
            return prev;
          }
          return [newItem, ...prev];
        });

        setShowTranscriptIndex(null);
        setShowSummaryIndex(null);
        resetEditingState();
        setShowNotesModal(false);
        resetNotesDraft();
        setNotesEditing('');
        setNoteTitleEditing('');
        setSelectedPlayingIndex(0);
        setPlayingUri(permanentUri); // ✅ 使用永久路徑
        setLastVisitedRecording(null);

        setTimeout(() => maybePromptTranscribe(0), 300);
      } else {
        Alert.alert(t('recordingFailed'), t('recordFileEmpty'));
        await FileSystem.deleteAsync(permanentUri);
      }

      GlobalRecorderState.filePath = '';
      GlobalRecorderState.startTime = 0;

    } catch (err) {
      debugError("❌ 停止錄音失敗：", err);
      Alert.alert(t('stopRecordingFailed'), (err as Error).message);
    } finally {
      stopInProgress = false;
    }
  };

  // 創建文字筆記
  const createTextNote = async () => {
    try {
      const timestamp = Date.now();
      const newUri = `textnote-${timestamp}`;
      const displayName = t('textNote');

      const newItem: RecordingItem = {
        uri: newUri,
        name: displayName,             // ✅ 加上 name
        displayName,
        isTextRecord: true,            // ✅ 標記為文字筆記
        notes: '',                     // ✅ 初始內容空白
        transcript: '',                // ✅ 空轉錄欄位
        summaries: {},                 // ✅ 空摘要
        isStarred: false,              // ✅ 預設未收藏
        date: new Date().toISOString(),
        displayDate: new Date().toLocaleString(),
        durationSec: 0,                // ✅ 沒有音訊長度
        derivedFiles: {},              // ✅ 沒有附屬檔
      };

      // ✅ 正確順序：先組好 updated，再存檔
      const updated = [newItem, ...recordings];
      setRecordings(updated);

      // ✅ 確保真的寫入檔案
      await saveRecordings(updated);

      // ✅ 導向筆記頁開始編輯
      navigation.navigate('NoteDetail', {
        uri: newUri,
        type: 'notes',
        shouldEdit: true,
      });
    } catch (err) {
      console.error('建立文字筆記失敗:', err);
    }
  };

  const PREF_KEY = 'VN_TRANSCRIBE_PROMPT_PREF';
  const maybePromptTranscribe = async (newIndex: number) => {
    const goTranscribe = () => navigation.navigate('NoteDetail', {
      index: newIndex, uri: undefined, type: 'transcript', shouldTranscribe: true,
    });

    const pref = await AsyncStorage.getItem(PREF_KEY);
    if (pref === 'auto') { goTranscribe(); return; }
    if (pref === 'off') { return; }

    Alert.alert(
      t('transcribePromptTitle'),
      t('transcribePromptMessage'),
      [
        { text: t('transcribePromptLater'), style: 'cancel' },
        {
          text: t('transcribePromptNow'),
          onPress: () => {
            navigation.navigate('NoteDetail', {
              index: newIndex,
              uri: undefined,
              type: 'transcript',
              shouldTranscribe: true,
            });
          },
        },
      ],
      { cancelable: true }
    );
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

  // ✅ 取得音檔 - 使用 expo-file-system
  const pickAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const { uri, name: originalName } = asset;

        // ✅ 使用 saveAudioFile 保存到永久位置
        const fileName = `import_${Date.now()}_${originalName}`;
        const permanentUri = await saveAudioFile(uri, fileName);

        const metadata = await generateRecordingMetadata(permanentUri);
        const { label, metadataLine } = generateDisplayNameParts(
          noteTitleEditing,
          metadata.durationSec,
          t
        );
        const displayName = label;
        const displayDate = metadataLine;

        debugLog('📥 匯入錄音 metadata:', {
          name: fileName,
          displayName,
          date: metadata.date,
          durationSec: metadata.durationSec,
        });

        const newItem: RecordingItem = {
          uri: permanentUri,
          name: fileName,
          displayName,
          displayDate,
          derivedFiles: {},
          date: metadata.date,
          notes: '',
          size: metadata.size ?? 0,
          durationSec: metadata.durationSec,
        };

        // ✅ 添加到錄音列表
        const updated = [newItem, ...recordings];
        setRecordings(updated);
        await saveRecordings(updated); // 確保立即保存

        setSelectedPlayingIndex(0);
        setPlayingUri(permanentUri);

        debugLog('✅ 音檔匯入成功，已添加到列表');

        // ✅ 使用與錄音後相同的轉文字提示邏輯
        await maybePromptTranscribe(0); // 新項目在索引 0
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
      setSummaryMenuContext(null);
    }

    if (!preserveEditing) {
      resetEditingState();
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
          <>
            {/* 錄音列表 */}
            <RecorderLists
              items={getFilteredSortedRecordings()}
              searchQuery={searchQuery}
              setRecordings={setRecordings}
              isSelectionMode={isSelectionMode}
              isLoading={isLoading}
              selectedItems={selectedItems}
              setIsSelectionMode={setIsSelectionMode}
              setSelectedItems={setSelectedItems}
              selectedPlayingIndex={selectedPlayingIndex}
              setSelectedPlayingIndex={setSelectedPlayingIndex}
              saveRecordings={saveRecordings}
              safeDeleteFile={safeDeleteFile}
            />

            {/* 整個上半段背景 */}
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.container, zIndex: 100, }}>
              <RecorderHeader
                mode="main"
                onPickAudio={pickAudio}
                onCloseAllMenus={closeAllMenus}
                sortOption={sortOption}
                setSortOption={setSortOption}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                setIsLoggingIn={setIsLoggingIn}
                rightSlot={
                  searchQuery.trim() ? (
                    <TouchableOpacity
                      onPress={() => {
                        const itemsToAnalyze = getFilteredSortedRecordings();
                        navigation.navigate('TopicSummaryPage', {
                          items: itemsToAnalyze,
                          keyword: searchQuery.trim(),
                        });
                      }}
                    >
                      <Text style={{ color: colors.primary, fontWeight: 'bold' }}>
                        {t('keywordSummaryPrefix')}{searchQuery.trim()}{t('keywordSummarySuffix')}
                      </Text>
                    </TouchableOpacity>
                  ) : undefined
                }
              />
            </View>

            {/* 底部工具列 */}
            {searchQuery.trim() !== '' ? (
              <SearchToolbar
                resultCount={getFilteredSortedRecordings().length}
                onCancelSearch={() => setSearchQuery('')}
              />
            ) : (
              <View style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                backgroundColor: colors.container,
                paddingVertical: 10,
                borderTopWidth: 3,
                borderTopColor: colors.primary,
                zIndex: 100,
              }}>
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
                    if (showNotesModal) {
                      if (draftLine.trim()) submitDraftLine();

                      const flat = flattenNoteSegs(noteSegs);
                      const merged = flat || notesEditing || '';

                      if (merged && showNotesIndex !== null) {
                        const updated = [...recordings];
                        updated[showNotesIndex].notes = merged;
                        (updated[showNotesIndex] as any).tempNoteSegs = noteSegs;
                        setRecordings(updated);
                        saveRecordings(updated);
                      }
                      resetNotesDraft();
                      setNoteSegs([]);
                      lastSegIdxRef.current = -1;
                      setDraftLine('');
                    }
                    setShowNotesModal(prev => !prev);
                  }}
                  isNotesVisible={showNotesModal}
                  onCreateTextNote={createTextNote}
                />
              </View>
            )}
          </>

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
              borderWidth: 3,
              padding: 12,
              elevation: 10,
              zIndex: 999,
            }}>
              {/* 標題欄 - 新增收起按鈕 */}
              <View style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}>
                <Text style={{
                  color: colors.text,
                  fontSize: 16,
                  fontWeight: 'bold',
                }}>{t('notes')}</Text>

                {/* 收起按鈕 */}
                <TouchableOpacity
                  onPress={() => {
                    // 關閉之前：若草稿有字，先收進當下段
                    if (draftLine.trim()) submitDraftLine();

                    const flat = flattenNoteSegs(noteSegs);
                    const merged = flat || notesEditing || '';

                    if (merged && showNotesIndex !== null) {
                      const updated = [...recordings];
                      updated[showNotesIndex].notes = merged;
                      (updated[showNotesIndex] as any).tempNoteSegs = noteSegs;
                      setRecordings(updated);
                      saveRecordings(updated);
                    }

                    setShowNotesModal(false);
                  }}
                >
                  <MaterialCommunityIcons
                    name="minus"
                    size={24}
                    color={colors.text}
                  />
                </TouchableOpacity>
              </View>

              {/* 單行主標題輸入 */}
              <TextInput
                placeholder={t('enterTitle')}
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
              <ScrollView
                ref={notesScrollRef}
                style={{ maxHeight: 200, marginBottom: 8 }}
                contentContainerStyle={{ paddingBottom: 4, gap: 8 }}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() => {
                  notesScrollRef.current?.scrollToEnd({ animated: true });
                }}
              >
                {noteSegs.length === 0 ? (
                  <Text style={{ color: '#888' }}>
                    {t('notesPlaceholderLine1')}
                  </Text>
                ) : (
                  noteSegs.map((seg, i) => (
                    <View key={`${seg.startSec}-${i}`} style={{ gap: 6 }}>
                      {/* 灰色時間條（不可編） */}
                      <Text
                        style={{
                          color: '#888',
                          fontSize: 13,
                          backgroundColor: colors.background,
                          paddingVertical: 4,
                          paddingHorizontal: 8,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: colors.primary + '55',
                        }}
                      >
                        {seg.label}
                      </Text>

                      {/* 這一段的可編輯框框 */}
                      <TextInput
                        placeholder={t('enterDescription')}
                        placeholderTextColor="#888"
                        value={seg.text}
                        onChangeText={(txt) => {
                          setNoteSegs(prev => {
                            const arr = [...prev];
                            arr[i] = { ...arr[i], text: txt };
                            return arr;
                          });
                        }}
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
                  ))
                )}
              </ScrollView>
            </View>
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

export default RecorderPageVoiceNote;