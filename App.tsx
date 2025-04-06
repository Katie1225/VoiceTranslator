import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TextInput,
  Alert,
  TouchableWithoutFeedback
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { lightTheme, darkTheme, additionalColors } from './constants/Colors';
import { createStyles } from './styles/audioStyles';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import {
  RecordingItem,
  enhanceAudio,
  trimSilence
} from './utils/audioHelpers';
import Slider from '@react-native-community/slider';


const AudioRecorder = () => {
  // 核心狀態
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  // 音量狀態
  const [currentVolume, setCurrentVolume] = useState(0);
  const [currentDecibels, setCurrentDecibels] = useState(-160);

  // 播放進度狀態
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const progressUpdateInterval = useRef<NodeJS.Timeout>();
  const [progressBarWidth, setProgressBarWidth] = useState(0);

  // 顏色主題
  const [customPrimaryColor, setCustomPrimaryColor] = useState<string | null>(null);

  // 修改顏色主題
  const colors = {
    ...(isDarkMode ? darkTheme : lightTheme),
    primary: customPrimaryColor || (isDarkMode ? darkTheme.primary : lightTheme.primary)
  };
  const styles = createStyles(colors);

  const displayedRecordings = recordings;

  // 變速播放
  const [speedMenuIndex, setSpeedMenuIndex] = useState<number | null>(null);

  const setPlaybackRate = async (rate: number) => {
    if (!currentSound) return;
    try {
      await currentSound.setRateAsync(rate, true); // 啟用音高校正
      console.log("速度已更新:", rate);
    } catch (error) {
      console.error("變速失敗:", error);
    }
  };

  // WAV錄音配置
  const recordingOptions = {
    android: {
      extension: '.m4a',
      outputFormat: 2, // MPEG_4
      audioEncoder: 5, // HE_AAC (Android特有)
      sampleRate: 48000,
      numberOfChannels: 1,
      bitRate: 320000,
      audioSource: 6, // VOICE_RECOGNITION
      enableAcousticEchoCanceler: true,
      enableNoiseSuppressor: true
    },
    ios: {
      extension: '.m4a',
      outputFormat: 2, // MPEG4AAC
      audioQuality: 2, // MAX
      sampleRate: 48000,
      numberOfChannels: 1,
      bitRate: 320000,
      linearPCMBitDepth: 24
    },
    isMeteringEnabled: true
  };


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

  // 開始錄音（帶音量檢測）
  const startRecording = async () => {
    closeAllMenus(); // 
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        // @ts-ignore - Expo Audio types are incorrect for createAsync
        recordingOptions
      );
      setRecording(newRecording);

      // 音量監聽
      const interval = setInterval(async () => {
        const status = await newRecording.getStatusAsync();
        if (status.isRecording && status.metering !== undefined) {
          setCurrentDecibels(status.metering);
          const clampedDb = Math.min(Math.max(status.metering, -100), 0); // 限制在 -100~0
          const volume = (clampedDb + 100) / 100; // 轉換為 0~1
          setCurrentVolume(volume);
        }
      }, 100);

      return () => clearInterval(interval);
    } catch (err) {
      Alert.alert("錄音失敗", (err as Error).message);
    }
  };

  // 停止錄音
  const stopRecording = async () => {
    if (!recording) return;

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (uri) {
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        const ss = now.getSeconds().toString().padStart(2, '0');
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const year = now.getFullYear().toString();
        const status = await recording.getStatusAsync();
        const secondsOnly = Math.floor((status.durationMillis ?? 0) / 1000);

        const defaultName = `${hh}${mm}${ss}_${secondsOnly}s_${month}${day}${year}.m4a`;

        const recordingsToAdd = [{ uri, name: defaultName }];

        // ✅ 僅儲存原始音檔
        setRecordings(prev => [...recordingsToAdd, ...prev]);
      }
    } catch (err) {
      Alert.alert("停止錄音失敗", (err as Error).message);
    } finally {
      setRecording(null);
      setCurrentVolume(0);
    }
  };


  // 播放錄音（帶進度更新）
  const playRecording = async (uri: string, index: number) => {
    try {
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

        const { sound, status } = await Audio.Sound.createAsync(
          { uri },
          {
            shouldPlay: true,
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
    setEditName(recordings[index].name);
    setSelectedIndex(null); // 關閉菜單
  };

  const saveEditedName = (index: number) => {
    if (editName.trim()) {
      setRecordings(prev =>
        prev.map((item, i) =>
          i === index ? { ...item, name: editName } : item
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
              const uri = recordings[index].uri;
              await FileSystem.deleteAsync(uri, { idempotent: true });
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
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // 關閉所有彈出菜單
  const closeAllMenus = () => {
    setSelectedIndex(null);
    setMenuVisible(false);
    setSpeedMenuIndex(null);
    if (editingIndex !== null) {
      saveEditedName(editingIndex);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={closeAllMenus}>
      <SafeAreaView style={styles.container}>
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
            <Text style={styles.menuItem}>版本: v1.0.3</Text>

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
        <View style={styles.recordSection}>
          <TouchableOpacity
            style={recording ? styles.stopButton : styles.recordButton}
            onPress={recording ? stopRecording : startRecording}
          >
            <Text style={styles.buttonText}>
              {recording ? '停止錄音' : '開始錄音'}
            </Text>
          </TouchableOpacity>

          {recording && (
            <View style={styles.volumeMeter}>
              <Text style={styles.volumeText}>
                {currentDecibels.toFixed(1)} dB
              </Text>
              <View style={styles.volumeBar}>
                <View style={[
                  styles.volumeLevel,
                  { width: `${currentVolume * 100}%` }
                ]} />
              </View>
            </View>
          )}
        </View>

        {/* 錄音列表 */}
        <ScrollView style={styles.listContainer}>
          {displayedRecordings.map((item, index) => {
            const isCurrentPlaying = playingUri === item.uri;

            return (
              <View key={index} style={{ position: 'relative' }}>
                <View style={styles.recordingItem}>
                  <View style={styles.nameRow}>
                    {/* 播放/暫停按鈕 */}
                    <TouchableOpacity
                      style={styles.playIconContainer}
                      onPress={() => {
                        closeAllMenus();
                        playRecording(item.uri, index); // 永遠使用自己這筆的 uri
                      }}
                    >

                      <Text style={styles.playIcon}>
                        {isCurrentPlaying && isPlaying ? '❚❚' : '▶'}
                      </Text>
                    </TouchableOpacity>

                    {editingIndex === index ? (
                      <TextInput
                        value={editName}
                        onChangeText={setEditName}
                        style={styles.nameInput}
                        autoFocus
                        onSubmitEditing={() => saveEditedName(index)}
                        onBlur={() => saveEditedName(index)}
                      />
                    ) : (
                      <TouchableOpacity
                        style={styles.nameContainer}
                        onPress={() => {
                          closeAllMenus();
                          playRecording(item.uri, index); // ✅ 點檔名也能播放
                        }}
                      >
                        <Text
                          style={styles.recordingName}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {item.name}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* 三點選單按鈕 - 只在非播放狀態或當前播放項目顯示 */}
                    {(isCurrentPlaying || !isPlaying) && (
                      <TouchableOpacity
                        style={styles.moreButton}
                        onPress={(e) => {
                          e.stopPropagation();
                          setSelectedIndex(selectedIndex === index ? null : index);
                        }}
                      >
                        <Text style={styles.moreIcon}>⋯</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* 播放進度條 */}
                  {playingUri === item.uri && (
                    <View style={styles.progressContainer}>
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
                      <Text style={styles.timeText}>
                        {formatTime(playbackPosition)} / {formatTime(playbackDuration)}
                      </Text>
                    </View>
                  )}
                </View>

                {/* 三點選單浮動層（全域定位） */}
                {selectedIndex === index && (
                  <View style={styles.optionsMenu}>

                    <TouchableOpacity
                      style={styles.optionButton}
                      onPress={async () => {
                        try {
                          const smartItem = await enhanceAudio(item.uri, item.name);
                          setRecordings(prev => [smartItem, ...prev]);
                          Alert.alert("智慧音質強化完成", `已新增 ${smartItem.name}`);
                        } catch (err) {
                          Alert.alert('強化失敗', (err as Error).message);
                        }
                        setSelectedIndex(null);
                      }}
                    >
                      <Text style={styles.optionText}>✨ 智慧音質強化</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.optionButton}
                      onPress={async () => {
                        try {
                          const trimmedItem = await trimSilence(item.uri, item.name);
                          setRecordings(prev => [trimmedItem, ...prev]);
                          Alert.alert("靜音剪輯完成", `已新增 ${trimmedItem.name}`);
                        } catch (err) {
                          Alert.alert("剪輯失敗", (err as Error).message);
                        }
                        setSelectedIndex(null);
                      }}
                    >
                      <Text style={styles.optionText}>✂️ 靜音剪輯</Text>
                    </TouchableOpacity>

                    {/* 其他選單功能照舊 */}
                    <TouchableOpacity
                      style={styles.optionButton}
                      onPress={() => {
                        startEditingName(index);
                        setSelectedIndex(null);
                      }}
                    >
                      <Text style={styles.optionText}>✏️ 重新命名</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.optionButton}
                      onPress={() => {
                        shareRecording(item.uri);
                        setSelectedIndex(null);
                      }}
                    >
                      <Text style={styles.optionText}>📤 分享</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.optionButton}
                      onPress={() => {
                        deleteRecording(index);
                        setSelectedIndex(null);
                      }}
                    >
                      <Text style={styles.optionText}>🗑️ 刪除</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.optionButton}
                      onPress={() => {
                        setSpeedMenuIndex(index);
                        setSelectedIndex(null);
                      }}
                    >
                      <Text style={styles.optionText}>⏩ 播放速度</Text>
                    </TouchableOpacity>
                  </View>
                )}



                {/* 變速選單 */}
                {speedMenuIndex === index && (
                  <View style={styles.speedOptionsMenu}>
                    {[0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                      <TouchableOpacity
                        key={rate}
                        style={styles.optionButton}
                        onPress={async () => {
                          await setPlaybackRate(rate);
                          setSpeedMenuIndex(null);
                        }}
                      >
                        <Text style={styles.optionText}>{rate}x</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

              </View>
            );
          })





          }

        </ScrollView>
      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
};

const App = () => <AudioRecorder />;
export default App;