import React, { useState, useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import {
  View,
  Text,
  TouchableOpacity,
  // StyleSheet,
  ScrollView,
  SafeAreaView,
  TextInput,
  Alert,
  ActivityIndicator,
  TouchableWithoutFeedback
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
//import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import { useKeepAwake } from 'expo-keep-awake';
import Slider from '@react-native-community/slider';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import BackgroundService from 'react-native-background-actions';
import RNFS from 'react-native-fs';
import { AppState } from 'react-native';

import {
  RecordingItem,
  enhanceAudio,
  trimSilence,
  transcribeAudio,
  summarizeTranscript
} from './utils/audioHelpers';
import { createStyles } from './styles/audioStyles';
import { ANDROID_AUDIO_ENCODERS, ANDROID_OUTPUT_FORMATS } from './constants/AudioConstants';
import { lightTheme, darkTheme, additionalColors } from './constants/Colors';
import { Linking } from 'react-native'; // ✅ 正確寫法

const GlobalRecorderState = {
  isRecording: false,
  filePath: '',
  startTime: 0,
};


const AudioRecorder = () => {
  useKeepAwake(); // 保持清醒
  // 核心狀態
  const [recording, setRecording] = useState(false);
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const recordingStartTimestamp = useRef<number | null>(null);

  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [dbHistory, setDbHistory] = useState<number[]>([]);
  const audioRecorderPlayer = useRef(new AudioRecorderPlayer()).current;


  // 音量狀態
  const [currentVolume, setCurrentVolume] = useState(0);
  const [currentDecibels, setCurrentDecibels] = useState(-160);
  const [recordingTime, setRecordingTime] = useState(0);

  // 播放進度狀態
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const progressUpdateInterval = useRef<NodeJS.Timeout | null>(null);
  const [progressBarWidth, setProgressBarWidth] = useState(0);

  // 顏色主題
  const [customPrimaryColor, setCustomPrimaryColor] = useState<string | null>(null);

  // 修改顏色主題
  const colors = {
    ...(isDarkMode ? darkTheme : lightTheme),
    primary: customPrimaryColor || (isDarkMode ? darkTheme.primary : lightTheme.primary)
  };
  const styles = createStyles(colors);

  const [selectedDerivedIndex, setSelectedDerivedIndex] = useState<{
    type: 'enhanced' | 'trimmed';
    index: number;
    position?: { x: number; y: number }; // 添加這個可選屬性
  } | null>(null);

  const [selectedMainIndex, setSelectedMainIndex] = useState<number | null>(null);
  const [mainMenuPosition, setMainMenuPosition] = useState<{ x: number; y: number } | null>(null);
  // 變速播放
  const [currentPlaybackRate, setCurrentPlaybackRate] = useState(1.0);
  const [speedMenuIndex, setSpeedMenuIndex] = useState<number | null>(null);
  const [speedMenuPosition, setSpeedMenuPosition] = useState<{ x: number; y: number } | null>(null);
  // 轉文字重點摘要
  const [showTranscriptIndex, setShowTranscriptIndex] = useState<number | null>(null);
  const [showSummaryIndex, setShowSummaryIndex] = useState<number | null>(null);

  const setPlaybackRate = async (rate: number) => {
    setCurrentPlaybackRate(rate); // 儲存當前播放速度
    if (currentSound) {
      try {
        const status = await currentSound.getStatusAsync();
        if (status.isLoaded) {
          await currentSound.setRateAsync(rate, true); // true 代表啟用 pitch 校正
          console.log("✅ 播放速度已設定為", rate);
        }
      } catch (err) {
        console.error("❌ 設定播放速度失敗：", err);
      }
    }
  };


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



  // 儲存原始檔案及其處理版本
  const processRecording = async (uri: string, name: string) => {
    try {
      // 創建原始錄音項目
      const originalRecording: RecordingItem = {
        uri,
        name,
        derivedFiles: {}
      };

      // 創建並儲存增強版本
      const enhancedRecording = await enhanceAudio(uri, name);
      originalRecording.derivedFiles!.enhanced = enhancedRecording;

      // 創建並儲存剪輯版本
      const trimmedRecording = await trimSilence(uri, name);
      originalRecording.derivedFiles!.trimmed = trimmedRecording;

      // 更新 recordings 陣列
      setRecordings(prev => [originalRecording, ...prev]);

      Alert.alert("處理完成", "已儲存原始檔案與衍生版本");
    } catch (err) {
      Alert.alert("處理失敗", (err as Error).message);
    }
  };
  // 新增狀態
  const [isLoading, setIsLoading] = useState(true);

  // 儲存錄音列表到本地檔案
  const saveRecordings = async (items: RecordingItem[]) => {
    try {
      await FileSystem.writeAsStringAsync(
        `${FileSystem.documentDirectory}recordings.json`,
        JSON.stringify(items)
      );
    } catch (err) {
      console.error('儲存錄音列表失敗:', err);
    }
  };

  // 從本地檔案載入錄音列表
  const loadRecordings = async () => {
    try {
      const path = `${FileSystem.documentDirectory}recordings.json`;
      const fileInfo = await FileSystem.getInfoAsync(path);

      if (fileInfo.exists) {
        const content = await FileSystem.readAsStringAsync(path);
        const loadedRecordings = JSON.parse(content);

        // 驗證每個錄音檔是否仍然存在
        const validRecordings = [];
        for (const item of loadedRecordings) {
          const fileInfo = await FileSystem.getInfoAsync(item.uri);
          if (fileInfo.exists) {
            validRecordings.push(item);
          } else {
            // 如果主檔案不存在，嘗試刪除其衍生檔案
            if (item.derivedFiles?.enhanced?.uri) {
              try {
                await FileSystem.deleteAsync(item.derivedFiles.enhanced.uri, { idempotent: true });
              } catch (e) { }
            }
            if (item.derivedFiles?.trimmed?.uri) {
              try {
                await FileSystem.deleteAsync(item.derivedFiles.trimmed.uri, { idempotent: true });
              } catch (e) { }
            }
          }
        }

        setRecordings(validRecordings);
        if (loadedRecordings.length !== validRecordings.length) {
          await saveRecordings(validRecordings); // 更新儲存檔
        }
      }
    } catch (err) {
      console.error('載入錄音列表失敗:', err);
    } finally {
      setIsLoading(false);
    }
  };

  
  const checkMissingPermissions = async (): Promise<string[]> => {
    const FOREGROUND_MIC = 'android.permission.FOREGROUND_SERVICE_MICROPHONE';
  
    const required: { label: string; key: string; condition?: boolean }[] = [
      { label: '麥克風', key: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO },
      { label: '儲存空間', key: PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE, condition: Number(Platform.Version) < 30 },
      { label: '背景錄音', key: FOREGROUND_MIC, condition: Number(Platform.Version) >= 34 },
    ];
  
    const missing: string[] = [];
  
    for (const { label, key, condition = true } of required) {
      if (!condition) continue;
      const granted = await PermissionsAndroid.check(key as any);
      if (!granted) {
        missing.push(label);
      }
    }
  
    return missing;
  };
  

  const requestPermissions = async (): Promise<boolean> => {
    const FOREGROUND_MIC = 'android.permission.FOREGROUND_SERVICE_MICROPHONE';
    const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  
    if (Number(Platform.Version) < 30) {
      permissions.push(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
    }
    if (Number(Platform.Version) >= 34) {
      permissions.push(FOREGROUND_MIC as any);
    }
  
    // 🧠 檢查缺少哪些權限
    const missing = await checkMissingPermissions();
    if (missing.length > 0) {
      Alert.alert(
        '權限不足',
        `請開啟以下權限以啟用錄音功能：\n${missing.join('、')}`,
        [
          { text: '取消', style: 'cancel' },
          { text: '前往設定', onPress: () => Linking.openSettings() }
        ]
      );
    }
  
    const granted = await PermissionsAndroid.requestMultiple(permissions);
  
    const hasAudio =
      (granted['android.permission.RECORD_AUDIO'] ?? '') === PermissionsAndroid.RESULTS.GRANTED;
  
    const hasStorage =
      Number(Platform.Version) < 30
        ? (granted['android.permission.WRITE_EXTERNAL_STORAGE'] ?? '') === PermissionsAndroid.RESULTS.GRANTED
        : true;
  
    const hasForegroundMic =
      Number(Platform.Version) >= 34
        ? ((granted as Record<string, string>)[FOREGROUND_MIC] ?? '') === PermissionsAndroid.RESULTS.GRANTED
        : true;
  
    if (!hasAudio || !hasStorage || !hasForegroundMic) {
      return false;
    }
  
    return true;
  };
  
  


  //掛載時加入權限檢查
  useEffect(() => {
    const checkPermissions = async () => {
      const granted = await requestPermissions();
      if (granted) {
        loadRecordings(); // 只在權限通過時才載入錄音
      }
      
    };

    checkPermissions();
  }, []);

  //開啟權限後自動跳出
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        const granted = await requestPermissions();
        if (granted) {
          console.log("✅ 使用者設定後權限已開啟");
          // 你可以在這裡更新任何與權限有關的狀態
        }
      }
    });
  
    return () => subscription.remove();
  }, []);
  

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
    if (!isLoading && recordings.length > 0) {
      saveRecordings(recordings);
    }
  }, [recordings, isLoading]);



  // 清理資源
  useEffect(() => {
    return () => {
      if (currentSound) {
        currentSound.unloadAsync();
      }
      if (progressUpdateInterval.current) {
        clearInterval(progressUpdateInterval.current);
      }
    };
  }, [currentSound]);

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

    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    const now = new Date();
    const filename = `rec_${now.getTime()}.m4a`;
    const filePath = `${RNFS.ExternalDirectoryPath}/${filename}`;

    console.log("📁 錄音儲存路徑:", filePath);

    try {
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
    } catch (err) {
      console.error("❌ 錄音啟動錯誤：", err);
      Alert.alert("錄音失敗", (err as Error).message || "請檢查權限或儲存空間");
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
      }

      const fileInfo = await RNFS.stat(uri);
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
        const displayName = `${hours}:${minutes}:${seconds}  ${durationText}  ${dateStr}`;


        const newItem: RecordingItem = {
          uri: normalizedUri,
          name,
          displayName,
          derivedFiles: {},
        };

        setRecordings(prev => [newItem, ...prev]);
      } else {
        Alert.alert("錄音失敗", "錄音檔案為空");
        await RNFS.unlink(uri); // 刪除空檔案
      }
    } catch (err) {
      console.error("❌ 停止錄音失敗：", err);
      Alert.alert("停止錄音失敗", (err as Error).message);
    }
  };

  const togglePlayback = async (uri: string, index: number) => {
    if (currentSound && playingUri === uri) {
      if (isPlaying) {
        await currentSound.pauseAsync();
        setIsPlaying(false);
        clearProgressTimer();
      } else {
        await currentSound.playAsync();
        setIsPlaying(true);
        startProgressTimer();
      }
    } else {
      await playRecording(uri, index);
    }
  };



  // 播放錄音（帶進度更新）
  const playRecording = async (uri: string, index: number) => {
    try {

      const uriForPlayback = uri.startsWith('file://') ? uri : `file://${uri}`;
      if (currentSound && playingUri === uri) {
        if (isPlaying) {
          await currentSound.pauseAsync();
          setIsPlaying(false);
          clearProgressTimer();
        } else {
          await currentSound.playAsync();
          setIsPlaying(true);
          startProgressTimer();
        }
      } else {
        if (currentSound) await currentSound.unloadAsync();

        const uriForPlayback = uri.startsWith('file://') ? uri : `file://${uri}`;

        const { sound, status } = await Audio.Sound.createAsync(
          { uri: uriForPlayback },
          {
            shouldPlay: true,
            rate: currentPlaybackRate,
            shouldCorrectPitch: true,
            progressUpdateIntervalMillis: 250
          },
          (status) => {
            if (status.isLoaded) {
              if (status.durationMillis != null) {
                setPlaybackDuration(status.durationMillis);
              }
              setPlaybackPosition(status.positionMillis || 0);
              if (status.didJustFinish) {
                setIsPlaying(false);
                setPlayingUri(null);
                setPlaybackPosition(0);
              }
            }
          }
        );


        setCurrentSound(sound);
        setPlayingUri(uri);
        setIsPlaying(true);
        startProgressTimer();
      }
    } catch (err) {
      Alert.alert("播放失敗", (err as Error).message);
    }
  };


  // 啟動進度定時器
  const startProgressTimer = () => {
    progressUpdateInterval.current = setInterval(async () => {
      if (currentSound) {
        const status = await currentSound.getStatusAsync();
        if (status.isLoaded && status.positionMillis) {
          setPlaybackPosition(status.positionMillis);
        }
      }
    }, 250);
  };

  // 清除進度定時器
  const clearProgressTimer = () => {
    if (progressUpdateInterval.current) {
      clearInterval(progressUpdateInterval.current);
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
              // 刪除主檔案
              await FileSystem.deleteAsync(item.uri, { idempotent: true });
              // 刪除衍生檔案
              if (item.derivedFiles?.enhanced?.uri) {
                await FileSystem.deleteAsync(item.derivedFiles.enhanced.uri, { idempotent: true });
              }
              if (item.derivedFiles?.trimmed?.uri) {
                await FileSystem.deleteAsync(item.derivedFiles.trimmed.uri, { idempotent: true });
              }

              const newRecordings = [...recordings];
              newRecordings.splice(index, 1);
              setRecordings(newRecordings);
            } catch (err) {
              Alert.alert("刪除失敗", (err as Error).message);
            }
          }
        }
      ]
    );
    setSelectedIndex(null); // 關閉菜單
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


  // 關閉所有彈出菜單
  const closeAllMenus = () => {
    setSelectedIndex(null);
    setMenuVisible(false);
    setSpeedMenuIndex(null);
    setSelectedDerivedIndex(null);
    setSelectedMainIndex(null);
    setMainMenuPosition(null);

    if (editingIndex !== null) {
      saveEditedName(editingIndex);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={closeAllMenus}>
      <SafeAreaView style={styles.container}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            {/* 使用 ActivityIndicator 作為載入動畫 */}
            <ActivityIndicator
              size="large"
              color={colors.primary}
            />
            <Text style={styles.loadingText}>載入錄音列表中...</Text>
          </View>
        ) : (
          <>

            {/* 漢堡菜單按鈕 */}
            <TouchableOpacity
              style={styles.menuButton}
              onPress={() => { closeAllMenus(); setMenuVisible(!menuVisible); }}
            >
              <Text style={styles.menuIcon}>☰</Text>
            </TouchableOpacity>

            {/* 漢堡菜單內容 */}
            {menuVisible && (
              <View style={styles.menuContainer}>
                <Text style={styles.menuItem}>版本: v1.1.7</Text>

                {/* 深淺色切換 */}
                <TouchableOpacity
                  onPress={() => { closeAllMenus(); setIsDarkMode(!isDarkMode); }}
                  style={styles.menuItemButton}
                >
                  <Text style={styles.menuItem}>
                    {isDarkMode ? '切換淺色模式' : '切換深色模式'}
                  </Text>
                </TouchableOpacity>

                {/* 顏色選擇 */}
                <Text style={styles.menuHeader}>主題顏色</Text>
                <View style={styles.colorOptionsContainer}>
                  {/* 預設顏色 */}
                  <TouchableOpacity
                    style={[
                      styles.colorOption,
                      { backgroundColor: isDarkMode ? darkTheme.primary : lightTheme.primary },
                      !customPrimaryColor && styles.selectedColor
                    ]}
                    onPress={() => { closeAllMenus(); setCustomPrimaryColor(null); }}
                  />

                  {/* 額外顏色選項 */}
                  {Object.entries(additionalColors).map(([name, color]) => (
                    <TouchableOpacity
                      key={name}
                      style={[
                        styles.colorOption,
                        { backgroundColor: color },
                        customPrimaryColor === color && styles.selectedColor
                      ]}
                      onPress={() => { closeAllMenus(); setCustomPrimaryColor(color); }}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* 錄音按鈕 & 音量顯示 */}
            <View style={[styles.recordSection, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={[styles.volumeText, { color: colors.primary, marginRight: 12 }]}>
                {recording ? `⏱ ${formatTime(recordingTime * 1000)}  ` : 'Voice Notes'}
              </Text>

              <TouchableOpacity
                style={recording ? styles.stopButton : styles.recordButton}
                onPress={recording ? stopRecording : startRecording}
              >
                <Text style={styles.buttonText}>
                  {recording ? '停止錄音' : '開始錄音'}
                </Text>
              </TouchableOpacity>
            </View>




            {/* 錄音列表 */}
            <ScrollView style={styles.listContainer}>
              {recordings.length === 0 ? (
                <View style={styles.emptyListContainer}>
                  <Text style={styles.emptyListText}>暫無錄音檔案</Text>
                </View>
              ) : (
                // 這裡開始是 recordings.map 的內容
                recordings.map((item, index) => {
                  const isCurrentPlaying = playingUri === item.uri;
                  const hasDerivedFiles = item.derivedFiles && (item.derivedFiles.enhanced || item.derivedFiles.trimmed);
                  const isTranscriptView = showTranscriptIndex === index;
                  const isSummaryView = showSummaryIndex === index;
                  const shouldHideDefaultUI = isTranscriptView || isSummaryView;
                  
                  return (
                    <View key={index} style={{ position: 'relative', zIndex: selectedDerivedIndex?.index === index ? 999 : 0 }}>
                      {/* 單個錄音項目的完整 UI */}
                      <View style={styles.recordingItem}>
                        {/* 名稱行 */}
                        <View style={styles.nameRow}>
                          {/* 播放按鈕 */}
                          <TouchableOpacity
                            style={styles.playIconContainer}
                            onPress={() => {
                              closeAllMenus();
                              togglePlayback(item.uri, index);
                            }}
                          >
                            <Text style={styles.playIcon}>
                              {isCurrentPlaying && isPlaying ? '❚❚' : '▶'}
                            </Text>
                          </TouchableOpacity>


                          {/* 名稱顯示/編輯 */}
                          <View style={styles.nameContainer}>
                            {editingIndex === index ? (
                              <TextInput
                                style={styles.nameInput}
                                value={editName}
                                onChangeText={setEditName}
                                onSubmitEditing={() => saveEditedName(index)}
                                autoFocus
                                onBlur={() => saveEditedName(index)}
                              />
                            ) : (
                              <TouchableOpacity
                                onPress={() => {
                                  closeAllMenus();
                                  togglePlayback(item.uri, index);
                                }}
                              >
                                <Text
                                  style={[styles.recordingName, playingUri === item.uri && styles.playingText]}
                                  numberOfLines={1}
                                  ellipsizeMode="tail"
                                >
                                  {item.displayName || item.name}
                                </Text>
                              </TouchableOpacity>

                            )}
                          </View>

                          {/* 更多按鈕 */}
                          {(isCurrentPlaying || !isPlaying) && (
                            <TouchableOpacity
                              style={styles.moreButton}
                              onPress={(e) => {
                                e.stopPropagation();
                                closeAllMenus();
                                if (selectedMainIndex === index) {
                                  setSelectedMainIndex(null);
                                  setMainMenuPosition(null);
                                  return;
                                }
                                e.target.measureInWindow((x, y, width, height) => {
                                  setMainMenuPosition({ x, y: y + height });
                                  setSelectedMainIndex(index);
                                });
                              }}
                            >
                              <Text style={styles.moreIcon}>⋯</Text>
                            </TouchableOpacity>
                          )}
                        </View>

                        {/* 播放進度條 */}
                        {!shouldHideDefaultUI && ((playingUri === item.uri ||
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

                        <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                          {/* 轉文字按鈕 */}
                          <TouchableOpacity
                            style={{
                              paddingVertical: 6,
                              paddingHorizontal: 12,
                              backgroundColor: colors.primary,
                              borderRadius: 8,
                              opacity: 1,
                            }}
                            onPress={async () => {
                              try {
                                const { trimmedRecording, transcript } = await transcribeAudio(item);

                                setRecordings(prev =>
                                  prev.map((rec, i) =>
                                    i === index
                                      ? {
                                        ...rec,
                                        derivedFiles: {
                                          ...rec.derivedFiles,
                                          trimmed: {
                                            ...trimmedRecording,
                                            transcript: transcript,
                                          },
                                        },
                                      }
                                      : rec
                                  )
                                );

                                Alert.alert('✅ 語音轉文字成功', transcript);
                              } catch (err) {
                                Alert.alert('❌ 轉文字失敗', (err as Error).message);
                              }
                              setShowTranscriptIndex(index);
                              setShowSummaryIndex(null);
                            }}
                          >
                            <Text style={{ color: 'white', fontSize: 14 }}>轉文字</Text>
                          </TouchableOpacity>

                          {/* 重點摘要按鈕 */}
                          <TouchableOpacity
                            style={{
                              paddingVertical: 6,
                              paddingHorizontal: 12,
                              backgroundColor: colors.primary,
                              borderRadius: 8,
                              opacity: item.derivedFiles?.trimmed?.transcript ? 1 : 0.4,
                            }}
                            disabled={!item.derivedFiles?.trimmed?.transcript}
                            onPress={async () => {
                              if (!item.derivedFiles?.trimmed?.transcript) return;

                              try {
                                const summary = await summarizeTranscript(item.derivedFiles.trimmed.transcript);
                                setRecordings(prev =>
                                  prev.map((rec, i) =>
                                    i === index
                                      ? {
                                        ...rec,
                                        derivedFiles: {
                                          ...rec.derivedFiles,
                                          trimmed: {
                                            uri: rec.derivedFiles?.trimmed?.uri ?? '',
                                            name: rec.derivedFiles?.trimmed?.name ?? '',
                                            displayName: rec.derivedFiles?.trimmed?.displayName,
                                            transcript: rec.derivedFiles?.trimmed?.transcript,
                                            summary,
                                          },
                                        },
                                      }
                                      : rec
                                  )
                                );




                                setShowTranscriptIndex(null); // 隱藏轉文字內容
                                setShowSummaryIndex(index);   // 顯示摘要內容
                              } catch (err) {
                                Alert.alert('❌ 摘要失敗', (err as Error).message);
                              }
                            }}

                          >
                            <Text style={{ color: 'white', fontSize: 14 }}>重點摘要</Text>
                          </TouchableOpacity>
                        </View>
                        {showTranscriptIndex === index && (
                          <View style={styles.transcriptContainer}>
                            <View style={styles.bar} />
                            <Text style={styles.transcriptText}>
                              {item.derivedFiles?.trimmed?.transcript}
                            </Text>
                          </View>
                        )}
                        
                        {showSummaryIndex === index && (
                          <View style={styles.transcriptContainer}>
                            <View style={styles.bar} />
                            <Text style={styles.transcriptText}>
                              {item.derivedFiles?.trimmed?.summary || '（尚未摘要）'}
                            </Text>
                          </View>
                        )}

                        {/* 衍生檔案列表 */}
                        {!shouldHideDefaultUI && hasDerivedFiles && (
                          <View style={styles.derivedFilesContainer}>
                            {/* 增強音質版本 */}
                            {item.derivedFiles?.enhanced && (
                              <View style={styles.derivedFileRow}>
                                <TouchableOpacity
                                  style={[styles.derivedFileItem, { flex: 1 }]}
                                  onPress={() => playRecording(item.derivedFiles!.enhanced!.uri, index)}
                                >
                                  <Text
                                    style={[
                                      styles.derivedFileName,
                                      playingUri === item.derivedFiles?.enhanced?.uri && styles.playingText
                                    ]}
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                  >
                                    🔊 增強音質 {item.derivedFiles.enhanced.name}
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.derivedMoreButton}
                                  onPress={(e) => {
                                    e.stopPropagation();
                                    closeAllMenus();
                                    if (selectedDerivedIndex?.index === index && selectedDerivedIndex?.type === 'enhanced') {
                                      setSelectedDerivedIndex(null);
                                      return;
                                    }
                                    e.target.measure((x, y, width, height, pageX, pageY) => {
                                      setSelectedDerivedIndex({
                                        type: 'enhanced',
                                        index,
                                        position: { x: pageX, y: pageY }
                                      });
                                    });
                                  }}
                                >
                                  <Text style={styles.moreIcon}>⋯</Text>
                                </TouchableOpacity>
                              </View>
                            )}

                            {/* 靜音剪輯版本 */}
                            {item.derivedFiles?.trimmed && (
                              <View style={styles.derivedFileRow}>
                                <TouchableOpacity
                                  style={[styles.derivedFileItem, { flex: 1 }]}
                                  onPress={() => playRecording(item.derivedFiles!.trimmed!.uri, index)}
                                >
                                  <Text
                                    style={[
                                      styles.derivedFileName,
                                      playingUri === item.derivedFiles?.trimmed?.uri && styles.playingText
                                    ]}
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                  >
                                    ✂️ 靜音剪輯 {item.derivedFiles.trimmed.name}
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.derivedMoreButton}
                                  onPress={(e) => {
                                    e.stopPropagation();
                                    closeAllMenus();
                                    if (selectedDerivedIndex?.index === index && selectedDerivedIndex?.type === 'trimmed') {
                                      setSelectedDerivedIndex(null);
                                      return;
                                    }
                                    e.target.measure((x, y, width, height, pageX, pageY) => {
                                      setSelectedDerivedIndex({
                                        type: 'trimmed',
                                        index,
                                        position: { x: pageX, y: pageY }
                                      });
                                    });
                                  }}
                                >
                                  <Text style={styles.moreIcon}>⋯</Text>
                                </TouchableOpacity>
                              </View>
                            )}

                            {/* 文字轉錄內容 */}
                            {typeof item.derivedFiles?.trimmed?.transcript === 'string' && (
                              <View style={styles.transcriptContainer}>
                                <View style={styles.bar} />
                                <Text style={styles.transcriptText}>
                                  {item.derivedFiles.trimmed.transcript}
                                </Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            {/* 三點選單浮動層（全域定位） */}
            {selectedMainIndex !== null && mainMenuPosition && (
              <View style={[
                styles.optionsMenu,
                {
                  position: 'absolute',
                  left: mainMenuPosition.x - 120,
                  top: mainMenuPosition.y,
                  zIndex: 9999,
                  elevation: 10,
                }
              ]}>

                {/* 新增這一項：轉文字 
            <TouchableOpacity
              style={styles.optionButton}
              onPress={async () => {
                const item = recordings[selectedMainIndex];
                try {
                  const { trimmedRecording, transcript } = await transcribeAudio(item);

                  // 更新 recordings 陣列
                  setRecordings(prev =>
                    prev.map((rec, i) =>
                      i === selectedMainIndex
                        ? {
                          ...rec,
                          derivedFiles: {
                            ...rec.derivedFiles,
                            trimmed: {
                              ...trimmedRecording,
                              transcript: transcript,
                            },
                          },
                        }
                        : rec
                    )
                  );

                  Alert.alert('轉文字完成', '已顯示在靜音剪輯下方');
                } catch (err) {
                  Alert.alert('轉文字失敗', (err as Error).message);
                } finally {
                  closeAllMenus();
                }
              }}
            >
              <Text style={styles.optionText}>📝 轉文字</Text>
            </TouchableOpacity>
          */}
                {/*  新增這一項：智慧音質 
            <TouchableOpacity
              style={styles.optionButton}
              onPress={async () => {
                const item = recordings[selectedMainIndex];
                try {
                  const enhancedRecording = await enhanceAudio(item.uri, item.name);
                  setRecordings(prev => prev.map((rec, i) =>
                    i === selectedMainIndex
                      ? { ...rec, derivedFiles: { ...rec.derivedFiles, enhanced: enhancedRecording } }
                      : rec
                  ));
                  Alert.alert("智慧音質強化完成", `已為 ${item.name} 創建強化版`);
                } catch (err) {
                  Alert.alert("強化失敗", (err as Error).message);
                }
                closeAllMenus();
              }}
            >
              <Text style={styles.optionText}>✨ 智慧音質</Text>
            </TouchableOpacity>
          */}

                {/* 放在這裡！不要放在 map 循環內部 */}
                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={async () => {
                    closeAllMenus();
                    const item = recordings[selectedMainIndex];
                    try {
                      const trimmedRecording = await trimSilence(item.uri, item.name);

                      // 取得原始與剪輯後的音訊資訊
                      const originalSound = await Audio.Sound.createAsync({ uri: item.uri });
                      const trimmedSound = await Audio.Sound.createAsync({ uri: trimmedRecording.uri });

                      const originalStatus = await originalSound.sound.getStatusAsync();
                      const trimmedStatus = await trimmedSound.sound.getStatusAsync();

                      if (originalStatus.isLoaded && trimmedStatus.isLoaded) {
                        const originalSecs = Math.round((originalStatus.durationMillis ?? 0) / 1000);
                        const trimmedSecs = Math.round((trimmedStatus.durationMillis ?? 0) / 1000);

                        await originalSound.sound.unloadAsync();
                        await trimmedSound.sound.unloadAsync();

                        setRecordings(prev => prev.map((rec, i) =>
                          i === selectedMainIndex
                            ? { ...rec, derivedFiles: { ...rec.derivedFiles, trimmed: trimmedRecording } }
                            : rec
                        ));

                        Alert.alert(
                          "靜音剪輯完成",
                          `已為 ${item.name} 創建剪輯版\n原始長度：${originalSecs}s → 剪輯後：${trimmedSecs}s`
                        );
                      } else {
                        Alert.alert("音訊讀取失敗", "無法取得音檔長度");
                      }
                    } catch (err) {
                      Alert.alert("剪輯失敗", (err as Error).message);
                    }

                    closeAllMenus();
                  }}

                >
                  <Text style={styles.optionText}>✂️ 靜音剪輯</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={() => {
                    startEditingName(selectedMainIndex);
                    closeAllMenus();
                  }}
                >
                  <Text style={styles.optionText}>✏️ 重新命名</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={() => {
                    shareRecording(recordings[selectedMainIndex].uri);
                    closeAllMenus();
                  }}
                >
                  <Text style={styles.optionText}>📤 分享</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={() => {
                    deleteRecording(selectedMainIndex);
                    closeAllMenus();
                  }}
                >
                  <Text style={styles.optionText}>🗑️ 刪除</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 放在這裡！不要放在 map 循環內部 */}
            {selectedDerivedIndex && (
              <View style={[
                styles.derivedOptionsMenu,
                {
                  position: 'absolute',
                  left: (selectedDerivedIndex.position?.x || 0) - 100, // 水平微調
                  top: (selectedDerivedIndex.position?.y || 0) + 30,  // 垂直微調
                  zIndex: 1000,
                  elevation: 1000,
                  backgroundColor: colors.container, // ✅ 加這行
                }
              ]}>
                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={() => {
                    const uri = selectedDerivedIndex.type === 'enhanced'
                      ? recordings[selectedDerivedIndex.index].derivedFiles!.enhanced!.uri
                      : recordings[selectedDerivedIndex.index].derivedFiles!.trimmed!.uri;
                    shareRecording(uri);
                    setSelectedDerivedIndex(null);
                  }}
                >
                  <Text style={styles.optionText}>📤 分享</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={async () => {
                    try {
                      const uri = selectedDerivedIndex.type === 'enhanced'
                        ? recordings[selectedDerivedIndex.index].derivedFiles!.enhanced!.uri
                        : recordings[selectedDerivedIndex.index].derivedFiles!.trimmed!.uri;
                      await FileSystem.deleteAsync(uri);
                      setRecordings(prev => prev.map(rec => {
                        if (rec.uri === recordings[selectedDerivedIndex.index].uri) {
                          const newDerivedFiles = { ...rec.derivedFiles };
                          selectedDerivedIndex.type === 'enhanced'
                            ? delete newDerivedFiles.enhanced
                            : delete newDerivedFiles.trimmed;
                          return { ...rec, derivedFiles: newDerivedFiles };
                        }
                        return rec;
                      }));
                      Alert.alert("刪除成功", "已刪除衍生檔案");
                    } catch (err) {
                      Alert.alert("刪除失敗", (err as Error).message);
                    }
                    setSelectedDerivedIndex(null);
                  }}
                >
                  <Text style={styles.optionText}>🗑️ 刪除</Text>
                </TouchableOpacity>
              </View>
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

      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
};

const App = () => <AudioRecorder />;
export default App;