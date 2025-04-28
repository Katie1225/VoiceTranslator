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
  FlatList
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
import { Keyboard } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  RecordingItem,
  enhanceAudio,
  trimSilence,
  transcribeAudio,
  summarizeTranscript
} from '../utils/audioHelpers';
import { useFileStorage } from '../utils/useFileStorage';
import { useAudioPlayer } from '../utils/useAudioPlayer';
import { createStyles } from '../styles/audioStyles';
import { ANDROID_AUDIO_ENCODERS, ANDROID_OUTPUT_FORMATS } from '../constants/AudioConstants';
import { lightTheme, darkTheme, additionalColors } from '../constants/Colors';
import RecorderButton from '../components/RecorderButton';
import HamburgerMenu from '../components/HamburgerMenu';
import MoreMenu from '../components/MoreMenu';
import {
  renderFilename,
  renderMoreButton,
  renderNoteBlock
} from '../components/AudioItem';
import { uFPermissions } from '../src/hooks/uFPermissions';


const GlobalRecorderState = {
  isRecording: false,
  filePath: '',
  startTime: 0,
};

const RecorderPageVoiceNote = () => {
  const title = "  Voice Note";

  useKeepAwake(); // 保持清醒
  const { permissionStatus, requestPermissions } = uFPermissions();
  // 核心狀態
  const [recording, setRecording] = useState(false);
  const recordingStartTimestamp = useRef<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [dbHistory, setDbHistory] = useState<number[]>([]);
  const audioRecorderPlayer = useRef(new AudioRecorderPlayer()).current;
  const [isTranscribingIndex, setIsTranscribingIndex] = useState<number | null>(null);
  const [isSummarizingIndex, setIsSummarizingIndex] = useState<number | null>(null);
  const isAnyProcessing = isTranscribingIndex !== null || isSummarizingIndex !== null;

  const flatListRef = useRef<FlatList>(null);
  const [itemOffsets, setItemOffsets] = useState<Record<number, number>>({});
  const [selectedPlayingIndex, setSelectedPlayingIndex] = useState<number | null>(null);

  const ITEM_HEIGHT = 80; // 音檔名稱高度

  const shouldShowDerivedFiles = (title: string) => {
    return title === "Voice Clamp";
  };


  // 音量狀態
  const [currentVolume, setCurrentVolume] = useState(0);
  const [currentDecibels, setCurrentDecibels] = useState(-160);
  const [recordingTime, setRecordingTime] = useState(0);



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
    if (theme === 'dark') setIsDarkMode(true);
    else if (theme === 'light') setIsDarkMode(false);
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

  // useEffect 初始化
  useEffect(() => {
    loadThemePreference();
    loadPrimaryColorPreference();
  }, []);



  const [selectedContext, setSelectedContext] = useState<{
    type: 'main' | 'enhanced' | 'trimmed';
    index: number;
    position: { x: number; y: number };
  } | null>(null);

  const [selectedMainIndex, setSelectedMainIndex] = useState<number | null>(null);
  const [mainMenuPosition, setMainMenuPosition] = useState<{ x: number; y: number } | null>(null);
  // 變速播放
  const [speedMenuIndex, setSpeedMenuIndex] = useState<number | null>(null);
  const [speedMenuPosition, setSpeedMenuPosition] = useState<{ x: number; y: number } | null>(null);
  // 轉文字重點摘要
  const [showTranscriptIndex, setShowTranscriptIndex] = useState<number | null>(null);
  const [showSummaryIndex, setShowSummaryIndex] = useState<number | null>(null);

  const [editingTranscriptIndex, setEditingTranscriptIndex] = useState<number | null>(null);
  const [editTranscript, setEditTranscript] = useState('');

  const [editingSummaryIndex, setEditingSummaryIndex] = useState<number | null>(null);
  const [editSummary, setEditSummary] = useState('');

  const shareText = async (text: string, type: 'transcript' | 'summary', filename?: string) => {
    if (!text || text.trim() === '') {
      Alert.alert('無法分享', '內容為空');
      return;
    }

    let prefix = '';
    if (filename) {
      const label = type === 'transcript' ? '錄音筆記' : '重點整理';
      prefix = `${filename} - ${label}\n\n`;
    }

    try {
      await Share.share({ message: prefix + text });
    } catch (err) {
      Alert.alert('分享失敗', (err as Error).message);
    }
  };

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


  useEffect(() => {
    if (GlobalRecorderState.isRecording) {
      setRecording(true);
      recordingStartTimestamp.current = Date.now();
      const elapsedSec = Math.floor((Date.now() - GlobalRecorderState.startTime) / 1000);
      setRecordingTime(elapsedSec);
    }
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (recording && recordingStartTimestamp.current) {
      timer = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - recordingStartTimestamp.current!) / 1000);
        setRecordingTime(elapsedSec);
      }, 1000);
    }

    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    let dbTimer: NodeJS.Timeout;

    if (recording) {
      dbTimer = setInterval(() => {
        const newDb = Array.from({ length: 20 }, () =>
          -Math.floor(Math.random() * 60 + 40)  // random dB：-40 到 -100
        );
        setDbHistory(newDb);
      }, 500);
    }

    return () => clearInterval(dbTimer);
  }, [recording]);


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
      console.error("❌ 無錄音路徑");
      return;
    }

    console.log("🎤 開始錄音任務:", path);

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
      setRecordingTime(sec);
    });

    console.log("✅ 錄音任務啟動完成");
    await new Promise(async (resolve) => {
      while (BackgroundService.isRunning()) {
        await new Promise(res => setTimeout(res, 1000)); // 睡 1 秒 
      }
      resolve(true);
    });

    console.log("🛑 背景任務結束");

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

      console.log("📁 錄音儲存路徑:", filePath);

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
      setRecordingTime(0);

      //測試版用開始
      setTimeout(() => {
        if (GlobalRecorderState.isRecording) {
          stopRecording();
          Alert.alert("⏱ 錄音已達上限", "每段最多錄音 180 分鐘");
        }
      }, 180 * 60 * 1000);
      // 測試版用結束


    } catch (err) {
      console.error("❌ 錄音啟動錯誤：", err);
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


      console.log("📄 錄音檔案資訊:", fileInfo);

      if (fileInfo.size > 0) {
        const now = new Date();
        const name = uri.split('/').pop() || `rec_${now.getTime()}.m4a`;

        // 取得錄音長度（秒）
        let durationText = '?秒';
        try {
          const { sound, status } = await Audio.Sound.createAsync({ uri: normalizedUri });
          if (status.isLoaded && status.durationMillis != null) {
            const seconds = Math.round(status.durationMillis / 1000);
            durationText = `${seconds}秒`;
          }
          await sound.unloadAsync();
        } catch (e) {
          console.warn("⚠️ 無法取得音檔長度", e);
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
        };

        setShowTranscriptIndex(null);   // 🔧 錄音完後，確保不會自動顯示 transcript
        setShowSummaryIndex(null);      // 🔧 順便清掉 summary 展開
        setEditingTranscriptIndex(null); // 🔧 清除編輯狀態（如果你有保留 transcript 編輯功能）

        setRecordings(prev => [newItem, ...prev]);
        setSelectedPlayingIndex(0);

      } else {
        Alert.alert("錄音失敗", "錄音檔案為空");
        await RNFS.unlink(uri); // 刪除空檔案
      }
    } catch (err) {
      console.error("❌ 停止錄音失敗：", err);
      Alert.alert("停止錄音失敗", (err as Error).message);
    }
  };

  // 修改文件名
  const startEditingName = (index: number) => {
    setEditingIndex(index);
    setEditName(recordings[index].displayName || recordings[index].name);
    setSelectedIndex(null); // 關閉菜單
  };

  const saveEditedName = (index: number) => {
    if (editName.trim()) {
      setRecordings(prev =>
        prev.map((item, i) =>
          i === index ? { ...item, displayName: editName } : item
        )
      );
    }
    setEditingIndex(null);
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
                console.warn("無法更新備份檔案:", backupErr);
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


  // 分享錄音
  const shareRecording = async (uri: string) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("分享功能不可用", "您的設備不支持分享功能");
        return;
      }
      await Sharing.shareAsync(uri);
    } catch (err) {
      Alert.alert("分享失敗", (err as Error).message);
    }
    setSelectedIndex(null); // 關閉菜單
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
      console.error('❌ 選取音檔失敗', err);
    }
  };



  // 關閉所有彈出菜單
  const closeAllMenus = () => {
    setSelectedIndex(null);
    setMenuVisible(false);
    setSpeedMenuIndex(null);
    setSelectedContext(null);

    // 退出名稱編輯
    setEditName('');
    setEditingIndex(null);

    // 退出 transcript 編輯
    setEditTranscript('');
    setEditingTranscriptIndex(null);

    // 退出 summary 編輯
    setEditSummary('');
    setEditingSummaryIndex(null);

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
  const renderNoteSection = (index: number, type: 'transcript' | 'summary') => {
    const isTranscript = type === 'transcript';
    const editingIndex = isTranscript ? editingTranscriptIndex : editingSummaryIndex;
    const editValue = isTranscript ? editTranscript : editSummary;
    const itemValue = isTranscript ? recordings[index]?.transcript : recordings[index]?.summary;

    return renderNoteBlock({
      type,
      index,
      value: itemValue || '',
      editingIndex,
      editValue,
      onChangeEdit: (text: string) => {
        if (isTranscript) {
          setEditTranscript(text);
          setEditingTranscriptIndex(index);
        } else {
          setEditSummary(text);
          setEditingSummaryIndex(index);
        }
      },
      onSave: async () => {
        const updated = recordings.map((rec, i) =>
          i === index ? { ...rec, [type]: editValue } : rec
        );
        setRecordings(updated);
        await saveRecordings(updated);

        // 🔥 重點：如果這次是改錄音筆記，而且這筆有 summary，就問要不要更新
        if (type === 'transcript' && recordings[index]?.summary) {
          Alert.alert(
            '更新重點摘要？',
            '錄音筆記已更新，是否需要重新生成新的重點摘要？',
            [
              { text: '否', style: 'cancel' },
              {
                text: '是', onPress: async () => {
                  try {
                    const newSummary = await summarizeTranscript(editValue);
                    const refreshed = recordings.map((rec, i) =>
                      i === index ? { ...rec, summary: newSummary } : rec
                    );
                    setRecordings(refreshed);
                    await saveRecordings(refreshed);
                    Alert.alert('✅ 重點摘要已更新');
                  } catch (err) {
                    Alert.alert('❌ 重點摘要更新失敗', (err as Error).message);
                  }
                }
              }
            ]
          );
        }
        if (isTranscript) setEditingTranscriptIndex(null);
        if (type === 'summary') setEditingSummaryIndex(null);
      },

      onCancel: () => {
        if (isTranscript) {
          setEditTranscript('');
          setEditingTranscriptIndex(null);
        } else {
          setEditSummary('');
          setEditingSummaryIndex(null);
        }
      },
      onDelete: async () => {
        if (type === 'transcript') {
          Alert.alert(
            '⚠️ 注意',
            '刪除錄音筆記後，重點摘要也會一併刪除，若日後需要重新轉換將需重新付費。確定要刪除嗎？',
            [
              { text: '取消', style: 'cancel' },
              {
                text: '刪除',
                style: 'destructive',
                onPress: async () => {
                  const updated = recordings.map((rec, i) =>
                    i === index ? { ...rec, transcript: undefined, summary: undefined } : rec
                  );
                  setRecordings(updated);
                  await saveRecordings(updated);
                  setShowTranscriptIndex(null);
                  setShowSummaryIndex(null);
                }
              }
            ]
          );
        } else {
          // 如果是刪除 summary，就直接刪掉 summary 不需要警告
          const updated = recordings.map((rec, i) =>
            i === index ? { ...rec, summary: undefined } : rec
          );
          setRecordings(updated);
          await saveRecordings(updated);
          setShowSummaryIndex(null);
          setIsSummarizingIndex(null);
        }
      },
      styles,
      colors,
      shareText: (text) => shareText(text, type, recordings[index]?.displayName || recordings[index]?.name),
    });
  };


  return (
    <TouchableWithoutFeedback onPress={closeAllMenus}>
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
              backgroundColor: colors.container, // 你的白色或主背景色
              paddingHorizontal: 12,
              paddingTop: 20,   // ✅只保留 paddingTop
              minHeight: 110,
              borderBottomWidth: 3,          // ✅ 這行
              borderBottomColor: colors.primary, // ✅ 這行
            }}>
              {/* 這個裡面才開始 row 排版 */}
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                {/* 左邊：錄音按鈕 */}
                <View style={{ flexShrink: 1, marginLeft: -2 }}>
                  <RecorderButton
                    title={title}
                    recording={recording}
                    recordingTime={recordingTime}
                    onStart={startRecording}
                    onStop={stopRecording}
                    styles={styles}
                    colors={colors}
                  />
                </View>

                {/* 右邊：☰ 和 ➕ */}
                <View style={{ alignItems: 'center', justifyContent: 'center', marginRight: 12, }}>
                  {/* 漢堡按鈕 */}

                  <TouchableOpacity
                    style={{
                      height: 35,         // ✅ 固定高度
                      justifyContent: 'center',
                      alignItems: 'center',
                      marginBottom: 0,    // 控制兩個按鈕的距離
                    }}
                    onPress={() => {
                      if (menuVisible) {
                        // 如果漢堡本來是打開的，再按一次就關掉
                        setMenuVisible(false);
                      } else {
                        closeAllMenus();
                        setMenuVisible(true);
                      }
                    }}
                  >
                    <Text style={{ fontSize: 20, color: colors.primary }}>☰</Text>
                  </TouchableOpacity>

                  {/* 加號按鈕 */}
                  <TouchableOpacity
                    style={{
                      height: 35,         // ✅ 固定高度，跟上面一樣
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                    onPress={pickAudio}
                  >
                    <Text style={{ fontSize: 20, color: colors.primary }}>＋</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>



            {/* 漢堡菜單內容 */}
            <HamburgerMenu
              visible={menuVisible}
              onClose={closeAllMenus}
              isDarkMode={isDarkMode}
              toggleTheme={toggleTheme}
              customPrimaryColor={customPrimaryColor}
              setCustomPrimaryColor={handleSetPrimaryColor}
              styles={styles}
            />


            {/* 錄音列表 */}
            {recordings.length === 0 ? (
              <View style={styles.emptyListContainer}>
                <Text style={styles.emptyListText}>暫無錄音檔案</Text>
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
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
                  const isCurrentPlaying = selectedPlayingIndex === index;
                  const hasDerivedFiles = item.derivedFiles && (item.derivedFiles.enhanced || item.derivedFiles.trimmed);
                  const isTranscriptView = showTranscriptIndex === index;
                  const isSummaryView = showSummaryIndex === index;
                  const shouldHideDefaultUI = isTranscriptView || isSummaryView;

                  const hasAnyContent = item.transcript || item.summary;
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
                        onLongPress={() => {
                          Alert.alert('刪除錄音', '確定要刪除嗎？', [
                            { text: '取消', style: 'cancel' },
                            { text: '刪除', onPress: () => deleteRecording(index) },
                          ]);
                        }}
                        activeOpacity={0.8}
                      >

                        {/* 單個錄音項目的完整 UI */}
                        <View style={[styles.recordingItem]}>




                          {/* 名稱行 */}
                          <View style={[styles.nameRow, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                            {/* 左邊播放鍵＋檔名 */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
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
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                              >
                                <Text style={styles.playIcon}>
                                  {playingUri === item.uri && isPlaying ? '❚❚' : '▶'}
                                </Text>

                                {/* 檔名顯示：正常是 Text，重新命名時是 TextInput */}
                                {editingIndex === index ? (
                                  <TextInput
                                    style={[
                                      styles.recordingName,
                                      isCurrentPlaying && styles.playingText,
                                      { borderBottomWidth: 1, borderColor: colors.primary }
                                    ]}
                                    value={editName}
                                    onChangeText={setEditName}
                                    autoFocus
                                    textAlign="center"
                                    onSubmitEditing={() => saveEditedName(index)}
                                    onBlur={() => saveEditedName(index)}
                                  />
                                ) : (
                                  <Text
                                    style={[
                                      styles.recordingName,
                                      isCurrentPlaying && styles.playingText
                                    ]}
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                  >
                                    {item.displayName || item.name}
                                  </Text>
                                )}
                              </TouchableOpacity>
                            </View>

                            {/* 右邊：三點選單 or 💾 ✖️ 按鈕 */}
                            {editingIndex === index ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <TouchableOpacity onPress={() => saveEditedName(index)}>
                                  <Text style={[styles.transcriptActionButton, { color: colors.primary }]}>💾</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => {
                                  setEditingIndex(null);
                                  setEditName('');
                                }}>
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
                                {/* 轉文字按鈕 */}
                                <TouchableOpacity
                                  style={{
                                    paddingVertical: 6,
                                    paddingHorizontal: 12,
                                    backgroundColor: colors.primary,
                                    borderRadius: 8,
                                    opacity: isAnyProcessing ? 0.4 : 1,
                                  }}
                                  disabled={isAnyProcessing}
                                  onPress={async () => {
                                    closeAllMenus();
                                    if (item.transcript) {
                                      // 已轉過文字就直接顯示，不重複呼叫 API
                                      setShowTranscriptIndex(index);
                                      setShowSummaryIndex(null);
                                      return;
                                    }

                                    setIsTranscribingIndex(index);
                                    setIsTranscribingIndex(index);

                                    try {
                                      await transcribeAudio(item, (updatedTranscript) => {
                                        setRecordings(prev =>
                                          prev.map((rec, i) =>
                                            i === index ? { ...rec, transcript: updatedTranscript } : rec
                                          )
                                        );

                                        if (showTranscriptIndex !== index) {
                                          setShowTranscriptIndex(index);
                                          setShowSummaryIndex(null); // 可選，不做 summary 也沒差
                                        }
                                      });
                                    } catch (err) {
                                      Alert.alert("❌ 轉文字失敗", (err as Error).message);
                                    } finally {
                                      setIsTranscribingIndex(null);
                                    }
                                  }}
                                >
                                  <Text style={{ color: 'white', fontSize: 14 }}>錄音筆記</Text>
                                </TouchableOpacity>
                                {/* 重點摘要按鈕 */}
                                <TouchableOpacity
                                  style={{
                                    paddingVertical: 6,
                                    paddingHorizontal: 12,
                                    backgroundColor: colors.primary,
                                    borderRadius: 8,
                                    opacity: item.transcript && !isAnyProcessing ? 1 : 0.4,
                                  }}
                                  disabled={!item.transcript || isAnyProcessing}
                                  onPress={async () => {
                                    closeAllMenus();
                                    if (!item.transcript) {
                                      Alert.alert('⚠️ 無法摘要', '請先執行「轉文字」功能');
                                      return;
                                    }
                                    setIsSummarizingIndex(index); // ⬅️ 加這個，開始 loading
                                    if (item.summary) {
                                      setShowTranscriptIndex(null);
                                      setShowSummaryIndex(index);
                                      return;
                                    }

                                    try {
                                      const summary = await summarizeTranscript(item.transcript);

                                      const updated = recordings.map((rec, i) =>
                                        i === index ? { ...rec, summary } : rec
                                      );
                                      setRecordings(updated);
                                      await saveRecordings(updated); // ✅ 寫入本地 JSON

                                      setShowTranscriptIndex(null);
                                      setShowSummaryIndex(index);
                                    } catch (err) {
                                      Alert.alert('❌ 摘要失敗', (err as Error).message);
                                    } finally {
                                      setIsSummarizingIndex(null); // ⬅️ 不管成不成功，結束 loading
                                    }
                                  }}
                                >
                                  <Text style={{ color: 'white', fontSize: 14 }}>重點摘要</Text>
                                </TouchableOpacity>
                                {/* 隱藏按鈕（只有已顯示 transcript 或 summary 才能點） */}
                                <TouchableOpacity
                                  disabled={!canHide}
                                  onPress={() => {
                                    closeAllMenus();
                                    setShowTranscriptIndex(null);
                                    setShowSummaryIndex(null);
                                  }}
                                  style={{
                                    paddingVertical: 6,
                                    paddingHorizontal: 12,
                                    backgroundColor: canHide ? colors.primary : '#ccc',
                                    borderRadius: 8
                                  }}
                                >
                                  <Text style={{ color: 'white', fontSize: 14 }}>隱藏</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          )}

  {/* 處理中loading（兄弟，不包進 actionButtons） */}
  {(isTranscribingIndex === index || isSummarizingIndex === index) && (
    <View style={{ marginTop: 6, alignItems: 'flex-start', paddingHorizontal: 12 }}>
      {isTranscribingIndex === index && !item.transcript && (
        <Text style={{ color: colors.primary }}>⏳ 錄音筆記處理中...</Text>
      )}
      {isSummarizingIndex === index && !item.summary && (
        <Text style={{ color: colors.primary }}>⏳ 重點整理處理中...</Text>
      )}
    </View>
  )}

                          {/* 內容顯示區 */}

                          {(isCurrentPlaying) && (
                            <>
                              {showTranscriptIndex === index && renderNoteSection(index, 'transcript')}
                              {showSummaryIndex === index && renderNoteSection(index, 'summary')}
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
                    startEditingName(index);
                  }, 0);
                }}
                onShare={(uri) => {
                  shareRecording(uri);
                }}
                onDelete={(index) => {
                  const isMain = selectedContext.type === 'main';
                  if (isMain) {
                    deleteRecording(index);
                  } else {
                    const type = selectedContext.type;
                    if (type !== 'enhanced' && type !== 'trimmed') return;
                    const uri = recordings[index].derivedFiles?.[type]?.uri;
                    if (!uri) return;
                    safeDeleteFile(uri).then(() => {
                      setRecordings(prev => prev.map((rec, i) => {
                        if (i !== index) return rec;
                        const newDerivedFiles = { ...rec.derivedFiles };
                        delete newDerivedFiles[type];
                        return { ...rec, derivedFiles: newDerivedFiles };
                      }));
                      saveRecordings(recordings);
                      Alert.alert("刪除成功", "已刪除衍生檔案");
                    }).catch(err => {
                      Alert.alert("刪除失敗", (err as Error).message);
                    }).finally(() => {
                      setSelectedContext(null);
                    });
                  }
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
                      setEditingTranscriptIndex(null);

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



            {/* 放在這裡！不要放在 map 循環內部 */}
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
        {recordings.length > 10 && (
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

      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
};

export default RecorderPageVoiceNote;