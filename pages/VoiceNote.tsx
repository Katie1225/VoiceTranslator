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

GoogleSignin.configure({
  webClientId: '732781312395-blhdm11hejnni8c2k9orf7drjcorp1pp.apps.googleusercontent.com',
  offlineAccess: true, // 可選
});

const GlobalRecorderState = {
  isRecording: false,
  filePath: '',
  startTime: 0,
};

const TRANSCRIBE_PROMPT_KEY = 'VN_DISABLE_TRANSCRIBE_PROMPT';

const RecorderPageVoiceNote = () => {
  const title = APP_TITLE;
  const { t } = useTranslation();

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
const notesScrollRef = useRef<ScrollView>(null);

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
    text: string; // ← 每段只有一個文字
  };

  const [noteSegs, setNoteSegs] = useState<NoteSeg[]>([]);
  const lastSegIdxRef = useRef<number>(-1);
  const [draftLine, setDraftLine] = useState(''); // 使用者正在打的一行

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

    // 先確保當下時間的分段已經存在（會用 SEGMENT_DURATION 自動建立）
    ensureSegForTime(recordingTimeRef.current);

    // 把草稿字串追加到「當下那一段」的 text（換行後續寫起來比較舒服）
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
  const flattenNoteSegs = (segs: NoteSeg[]) =>
    segs
      .map(s => (s.text.trim() ? `${s.label}\n${s.text.trim()}` : s.label))
      .join('\n\n');



  // 放在 RecorderPageVoiceNote 內 useEffect 區塊們之間
  useEffect(() => {
    if (!showNotesModal) return;
    // 一打開就先放入第一個分隔條（0–SEGMENT_DURATION）
    ensureSegForTime(Math.max(0, recordingTimeRef.current));

    const id = setInterval(() => {
      // 每 500ms 檢查是否跨到下一段，如果是就插入下一個灰條
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
    mode?: string; // ✅ optional，未來加多摘要時會用到
  }>({ type: null, index: null, text: '' });

  const { recordings, setRecordings, setLastVisitedRecording } = useRecordingContext();

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

  // 篩選排序
  const getFilteredSortedRecordings = () => {
    const query = searchQuery.trim().toLowerCase();

    let filtered: RecordingItem[];

    if (!query) {
      // 沒有搜尋，回傳全部
      filtered = recordings;
    } else {
      filtered = recordings.filter((r) => {
        const matchSelf =
          r.displayName?.toLowerCase().includes(query) ||
          r.name?.toLowerCase().includes(query) ||
          r.notes?.toLowerCase().includes(query) ||
          r.transcript?.toLowerCase().includes(query) ||
          (query === 'star' && r.isStarred);

        const matchSplitParts = r.derivedFiles?.splitParts?.some((p /*: RecordingItem*/) =>
          (p.displayName || '').toLowerCase().includes(query) ||
          (p.notes || '').toLowerCase().includes(query) ||
          (p.transcript || '').toLowerCase().includes(query)
        );


        return matchSelf || matchSplitParts; // ✅ 至少主音檔或其中一個子音檔有符合
      });
    }

    // 排序邏輯保持不變
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


  // 開始錄音（帶音量檢測）
  const autoSplitTimer = useRef<NodeJS.Timeout | null>(null);
  const startRecording = async () => {
    closeAllMenus();
    stopPlayback();

    // 如果權限已被拒絕，直接顯示提示
    if (permissionStatus === 'denied') {
      //權限不足設定
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
      resetNotesDraft(); // 確保新錄音筆記是空的
      setShowNotesModal(true);

      //錄音時間上限
      setTimeout(() => {
        if (GlobalRecorderState.isRecording) {
          stopRecording();
          Alert.alert(t('recordingLimitReachedTitle'), t('recordingLimitReachedMessage'));
        }
      }, 180 * 60 * 1000);
      // 測試版用結束
      const userId = 'Katie';



      await notifyAwsRecordingEvent('start', {
        timestamp: Date.now(),
        userId,
      });

      await notitifyWhisperEvent('start', {
        timestamp: Date.now(),
        userId,
      });

    } catch (err) {
      debugError("❌ 錄音啟動錯誤：", err);
      // 錄音失敗
      Alert.alert(t('recordingFailed'), (err as Error).message || t('checkPermissionOrStorage'));

      setRecording(false);
    }
  };

  // ✅ 放在元件內（如 stopRecording 之前），使用現有的 useTranslation() / navigation
  const PREF_KEY = 'VN_TRANSCRIBE_PROMPT_PREF';
  const maybePromptTranscribe = async (newIndex: number) => {
    const goTranscribe = () => navigation.navigate('NoteDetail', {
      index: newIndex, uri: undefined, type: 'transcript', shouldTranscribe: true,
    });

    const pref = await AsyncStorage.getItem(PREF_KEY);
    if (pref === 'auto') { goTranscribe(); return; } // 直接轉
    if (pref === 'off') { return; }                // 什麼都不做（不提示）


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
              shouldTranscribe: true, // 進 NoteDetail 自動開跑轉寫
            });
          },
        },
      ],
      { cancelable: true }
    );
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
          //    "錄音失敗",
          //   "錄音檔案未建立成功，請確認權限已開啟，並將「背景限制」設為不限制。"
          t('recordingFailed'), t('recordFileMissing')
        );
        return;
      }

      const fileInfo = await RNFS.stat(uri);

      // ✅ 加強判斷：如果檔案太小，就刪除！
      if (fileInfo.size < 1000) { // 小於 1KB 視為失敗錄音
        await RNFS.unlink(uri);
        return;
      }

      debugLog("📄 錄音檔案資訊:", fileInfo);
      const name = uri.split('/').pop() || `rec_${Date.now()}.m4a`;

      if (fileInfo.size > 0) {
        const metadata = await generateRecordingMetadata(normalizedUri);
        const { label, metadataLine } = generateDisplayNameParts(noteTitleEditing, metadata.durationSec, t);
        const displayName = label;
        const displayDate = metadataLine;
        const flatNotes = flattenNoteSegs(noteSegs); 
        const newItem: RecordingItem = {
          size: fileInfo.size,
          uri: normalizedUri,
          name,
          displayName,
          displayDate,
          derivedFiles: {},
          date: metadata.date,
  notes: flatNotes || notesEditing || '', 
          durationSec: metadata.durationSec,
        };
(newItem as any).tempNoteSegs = noteSegs;   
        debugLog('📌 建立新錄音項目', { name, displayName });

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
        setPlayingUri(normalizedUri);
        setLastVisitedRecording(null);

        setTimeout(() => maybePromptTranscribe(0), 300);  /* ✅提示是否要馬上轉文字 */
      }
      else {
        Alert.alert(t('recordingFailed'), t('recordFileEmpty'));
        // Alert.alert("錄音失敗", "錄音檔案為空");
        await RNFS.unlink(uri); // 刪除空檔案
      }
    } catch (err) {
      debugError("❌ 停止錄音失敗：", err);
      // Alert.alert("停止錄音失敗", (err as Error).message);
      Alert.alert(t('stopRecordingFailed'), (err as Error).message);
    }
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

        const normalizedUri = uri.replace('file://', '');
        const metadata = await generateRecordingMetadata(normalizedUri);
        const { label, metadataLine } = generateDisplayNameParts(noteTitleEditing, metadata.durationSec, t);
        const displayName = label;
        const displayDate = metadataLine;
        debugLog('📥 匯入錄音 metadata:', {
          name,
          displayName,
          date: metadata.date,
          durationSec: metadata.durationSec,
        });

        const newItem: RecordingItem = {
          uri: normalizedUri,
          name,
          displayName,
          displayDate,
          derivedFiles: {},
          date: metadata.date,
          notes: '',
          size: metadata.size ?? 0,
        };

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
          <Text style={styles.loadingText}>  ⚠️ {t('permissionRequiredMessage')}</Text> {/* ⚠️ 請開啟錄音與儲存權限才能使用此 App*/}
          <TouchableOpacity onPress={() => requestPermissions()}>
            <Text style={[styles.loadingText, { color: colors.primary, marginTop: 12 }]}>{t('retryPermissionCheck')}</Text> {/*重新檢查權限 */}
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
              isSelectionMode={isSelectionMode}  // 	畫面要不要顯示「勾選框 UI」的開關
              isLoading={isLoading}
              selectedItems={selectedItems}      // 	哪些錄音（用 URI）目前已被選中
              setIsSelectionMode={setIsSelectionMode}  // 切換多選模式（進入／退出）
              setSelectedItems={setSelectedItems}  // 新增／移除已選項目，或清空全部
              selectedPlayingIndex={selectedPlayingIndex}  // 選擇想撥放的音檔
              setSelectedPlayingIndex={setSelectedPlayingIndex}         // 哪個音檔是被選中的
              saveRecordings={saveRecordings} // ✅ 新增
              safeDeleteFile={safeDeleteFile} // ✅ 新增
            />

            {/* 放在這裡！不要放在 map 循環內部 */}

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
                      // 關閉之前：若草稿有字，先收進當下段
                      if (draftLine.trim()) submitDraftLine();

                      const flat = flattenNoteSegs(noteSegs);
                      const merged = flat || notesEditing || '';

                      if (merged && showNotesIndex !== null) {
                        const updated = [...recordings];
                        updated[showNotesIndex].notes = merged;  // 先走相容欄位 notes
                        (updated[showNotesIndex] as any).tempNoteSegs = noteSegs;
                        setRecordings(updated);
                        saveRecordings(updated);
                      }

                      // 清空暫存（下次打開再長）
                      resetNotesDraft();
                      setNoteSegs([]);
                      lastSegIdxRef.current = -1;
                      setDraftLine('');
                    }
                    setShowNotesModal(prev => !prev);

                  }}
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
              borderWidth: 3,                            // ✅ 加上這行
              padding: 12,
              elevation: 10,
              zIndex: 999,
            }}>
              <Text style={{
                color: colors.text,
                fontSize: 16,
                fontWeight: 'bold',
                marginBottom: 8,
              }}>{t('notes')}</Text> {/*談話筆記*/}

              {/* 單行主標題輸入 */}
              <TextInput
                placeholder={t('enterTitle')}
                // placeholder="輸入主標題（如：報價進度）"
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
              {/* 中間：分段清單 */}
<ScrollView
  ref={notesScrollRef}
  style={{ maxHeight: 200, marginBottom: 8 }}
  contentContainerStyle={{ paddingBottom: 4, gap: 8 }}
  keyboardShouldPersistTaps="handled"
  onContentSizeChange={() => {
    // 內容高度一變（新增時間段或文字變高）就自動捲到底
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