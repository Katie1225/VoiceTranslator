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
  isSmartFile,
  getOriginalName,
  getSmartName,
  findMatchingSmartUri,
  findMatchingOriginalUri,
  enhanceAudio
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

  // 增強音檔
  const enhanceAudio = async (inputUri: string, originalName: string): Promise<RecordingItem> => {
    const folder = inputUri.substring(0, inputUri.lastIndexOf('/') + 1);
    const newName = getSmartName(originalName);
    const outputUri = `${folder}${newName}`;
    const inputPath = inputUri.replace('file://', '');
    const outputPath = outputUri.replace('file://', '');
    const command = `-y -i "${inputPath}" -af "highpass=f=200, lowpass=f=8000, afftdn=nf=-60, equalizer=f=1500:width_type=h:width=400:g=4,equalizer=f=3500:width_type=h:width=1000:g=3,volume=2.0" "${outputPath}"`;
    const session = await FFmpegKit.execute(command);
    const returnCode = await session.getReturnCode();
    return {
      uri: outputUri,
      name: newName,
      isEnhanced: true,
      originalUri: inputUri // 保留原始URI參照
    };
  };
  // 💡 套用過濾邏輯：只顯示 smart 檔 or 尚未被 smart 的原始檔
  const displayedRecordings = recordings.filter(rec => {
    if (isSmartFile(rec.name)) return true; // 顯示 smart 檔
    const smartVersionName = getSmartName(rec.name);
    return !recordings.some(r => r.name === smartVersionName);
  });


  const handlePlayPress = (item: RecordingItem, index: number) => {
    closeAllMenus();

    if (item.isEnhanced) {
      // 智慧音檔直接播放
      playRecording(item.uri, index);
    } else {
      // 檢查是否有對應智慧檔
      const enhancedVersion = recordings.find(r =>
        r.originalUri === item.uri
      );

      enhancedVersion
        ? playRecording(enhancedVersion.uri, recordings.indexOf(enhancedVersion))
        : setPlayModalVisible(true);
    }
  };

  // 增強視窗
  const [playModalVisible, setPlayModalVisible] = useState(false);
  const [pendingPlayUri, setPendingPlayUri] = useState<string | null>(null);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

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
      extension: '.wav',
      outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_DEFAULT,
      audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_DEFAULT,
      sampleRate: 44100,
      numberOfChannels: 1,
      bitRate: 256000,
    },
    ios: {
      extension: '.wav',
      outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_LINEARPCM,
      audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_MAX,
      sampleRate: 44100,
      numberOfChannels: 1,
      bitRate: 256000,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
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

        const defaultName = `${hh}${mm}${ss}_${secondsOnly}s_${month}${day}${year}.wav`;

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

        const { sound } = await Audio.Sound.createAsync(
          { uri },
          {
            shouldPlay: true,
            progressUpdateIntervalMillis: 250
          },
          (status) => {
            if (status.isLoaded) {
              if (status.durationMillis) {
                setPlaybackDuration(status.durationMillis);
              }
              if (status.positionMillis) {
                setPlaybackPosition(status.positionMillis);
              }
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
    setPlayModalVisible(false);
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
            const isSmart = isSmartFile(item.name);
            const smartUri = findMatchingSmartUri(item.name, recordings);
            const originalUri = findMatchingOriginalUri(item.name, recordings);
            const isCurrentPlaying = playingUri === item.uri;

            return (
              <View key={index} style={{ position: 'relative' }}>
                <View style={styles.recordingItem}>
                  <View style={styles.nameRow}>
                    {/* 播放/暫停按鈕 */}
                    <TouchableOpacity
                      onPress={() => {
                        closeAllMenus();
                        if (isCurrentPlaying) {
                          // 當前正在播放此音檔 -> 暫停/繼續
                          playRecording(item.uri, index);
                        } else if (isSmart) {
                          // 直接播放smart音檔
                          playRecording(item.uri, index);
                        } else if (smartUri) {
                          // 有對應的smart音檔 -> 直接播放
                          playRecording(smartUri, index);
                        } else {
                          // 原始音檔且未播放 -> 顯示播放選項
                          setPendingPlayUri(item.uri);
                          setPendingIndex(index);
                          setPlayModalVisible(true);
                        }
                      }}
                      style={styles.playIconContainer}
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
                          if (isSmartFile(item.name)) {
                            playRecording(item.uri, index);
                          } else if (smartUri) {
                            playRecording(smartUri, index);
                          } else {
                            setSelectedIndex(null);
                            setPendingPlayUri(item.uri);
                            setPendingIndex(index);
                            setPlayModalVisible(true);
                          }
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
    {/* 第一項：智慧音質強化 or 還原原始音檔 */}
    {isSmartFile(item.name) ? (
      <TouchableOpacity
        style={styles.optionButton}
        onPress={async () => {
          try {
            const originalName = getOriginalName(item.name);
            const folder = item.uri.substring(0, item.uri.lastIndexOf('/') + 1);
            const originalUri = item.uri.replace(/smart_/, '');

            const fileExists = await FileSystem.getInfoAsync(originalUri);
            if (!fileExists.exists) {
              Alert.alert('錯誤', '找不到原始音檔');
              return;
            }

            // ✅ 覆蓋 smart_xxx -> xxx
// ❌ 不要再複製檔案內容
// await FileSystem.copyAsync({ from: originalUri, to: item.uri });

setRecordings(prev =>
  prev.map((rec, i) =>
    i === index ? {
      ...rec,
      name: originalName,
      uri: originalUri,
      isEnhanced: false
    } : rec
  )
);

playRecording(originalUri, index);


          } catch (err) {
            Alert.alert('還原失敗', (err as Error).message);
          }
          setSelectedIndex(null);
        }}
      >
        <Text style={styles.optionText}>▶ 播放原始音檔</Text>
      </TouchableOpacity>
    ) : (
      <TouchableOpacity
        style={styles.optionButton}
        onPress={async () => {
          try {
            const smartItem = await enhanceAudio(item.uri, item.name);

            // ✅ 覆蓋 xxx -> smart_xxx（內容與檔名都改）
            await FileSystem.copyAsync({
              from: smartItem.uri,
              to: item.uri,
            });

            setRecordings(prev =>
              prev.map((rec, i) =>
                i === index ? {
                  ...rec,
                  name: smartItem.name
                } : rec
              )
            );

            playRecording(item.uri, index);
          } catch (err) {
            Alert.alert('強化失敗', (err as Error).message);
          }
          setSelectedIndex(null);
        }}
      >
        <Text style={styles.optionText}>✨ 智慧音質強化</Text>
      </TouchableOpacity>
    )}

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

                {/* 播放方式選單浮動層（全域定位） */}
                {playModalVisible && pendingIndex === index && (
                  <View style={styles.playOptionsMenu}>

                    <TouchableOpacity style={styles.optionButton} onPress={() => {
                      if (pendingPlayUri && pendingIndex !== null) {
                        playRecording(pendingPlayUri, pendingIndex);
                      }
                      setPlayModalVisible(false);
                    }}>
                      <Text style={styles.optionText}>
                        <Text style={{ color: colors.primary }}>▶ </Text>
                        播放原始音檔
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.optionButton} onPress={async () => {
                      if (pendingPlayUri && pendingIndex !== null) {
                        try {
                          const originalName = recordings[pendingIndex].name;
                          const { uri: enhancedUri, name: newName } = await enhanceAudio(pendingPlayUri, originalName);
                          setRecordings(prev => prev.map((rec, i) =>
                            i === pendingIndex ? { uri: enhancedUri, name: newName } : rec
                          ));
                          playRecording(enhancedUri, pendingIndex);
                          Alert.alert('智慧音質強化成功', `已新增 ${newName}`);
                        } catch (err) {
                          Alert.alert('智慧音質強化失敗', (err as Error).message);
                        }
                      }
                      setPlayModalVisible(false);
                    }}>

                      <Text style={[styles.optionText]}>✨ 智慧音質強化</Text>
                    </TouchableOpacity>
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