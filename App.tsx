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
import { useKeepAwake } from 'expo-keep-awake';
import {
  RecordingItem,
  enhanceAudio,
  trimSilence,
  transcribeAudio
} from './utils/audioHelpers';
import Slider from '@react-native-community/slider';
import { ANDROID_AUDIO_ENCODERS, ANDROID_OUTPUT_FORMATS } from './constants/AudioConstants';

const AudioRecorder = () => {
  useKeepAwake(); // 保持清醒
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
  const [dbHistory, setDbHistory] = useState<number[]>([]);


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
        staysActiveInBackground: true,  // 確保在後台保持活動
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
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
          setRecordingTime(Math.floor((status.durationMillis ?? 0) / 1000));
          setDbHistory(prev => {
            const newDb = clampedDb;
            const next = [...prev.slice(-39), newDb]; // 最多保留 40 筆
            return next;
          });

        }
      }, 50);


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
        const durationParts = [
          Math.floor(secondsOnly / 3600) > 0 ? `${Math.floor(secondsOnly / 3600)}小時` : '',
          Math.floor((secondsOnly % 3600) / 60) > 0 ? `${Math.floor((secondsOnly % 3600) / 60)}分` : '',
          `${secondsOnly % 60}秒`,
        ].filter(Boolean).join('');

        const displayName = `${durationParts} ${hh}:${mm}:${ss} ${month}/${day}/${year}`;

        const defaultName = `rec_${hh}${mm}${ss}_${month}${day}${year}.m4a`;

        const recordingsToAdd: RecordingItem[] = [{
          uri,
          name: defaultName,
          displayName,
        }];


        // ✅ 僅儲存原始音檔
        setRecordings(prev => [...recordingsToAdd, ...prev]);
      }
    } catch (err) {
      Alert.alert("停止錄音失敗", (err as Error).message);
    } finally {
      setRecording(null);
      setCurrentVolume(0);
      setRecordingTime(0); // ✅ 重置錄音秒數
      setDbHistory([]);
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
            rate: currentPlaybackRate,          // 加這行
            shouldCorrectPitch: true,           // 很重要，讓音調不變
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
            <Text style={styles.menuItem}>版本: v1.1.0</Text>

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
              {/*隱藏音量
              <Text style={styles.volumeText}> 
                {currentDecibels.toFixed(1)} dB
              </Text>
              */}
              <View style={styles.volumeAndTimeContainer}>
                {/* 分貝條區塊：75% */}
                <View style={styles.volumeContainer}>
                  {dbHistory.map((db, i) => {
                    const clampedDb = typeof db === 'number' ? Math.min(Math.max(db, -100), 0) : -100;
                    let height = ((clampedDb + 100) / 100) * 40;
                    if (height < 1) height = 1;
                    return (
                      <View
                        key={i}
                        style={{
                          width: 3,
                          height,
                          marginRight: i === dbHistory.length - 1 ? 0 : 1,
                          marginLeft: 1,
                          backgroundColor: colors.primary,
                          borderRadius: 2,
                        }}
                      />
                    );
                  })}
                </View>

                {/* 錄音時間區塊：25% */}
                <View style={styles.timeContainer}>
                  <Text style={styles.volumeText}>⏱ {recordingTime}s</Text>
                </View>
              </View>


            </View>
          )}
        </View>

        {/* 錄音列表 */}
        <ScrollView style={styles.listContainer}>
          {recordings.map((item, index) => {
            const isCurrentPlaying = playingUri === item.uri;
            const hasDerivedFiles = item.derivedFiles && (item.derivedFiles.enhanced || item.derivedFiles.trimmed);

            return (
              <View key={index} style={{ position: 'relative', zIndex: selectedDerivedIndex?.index === index ? 999 : 0, }}>
                <View style={styles.recordingItem}>
                  <View style={styles.nameRow}>
                    {/* 播放/暫停按鈕 */}
                    <TouchableOpacity
                      style={styles.playIconContainer}
                      onPress={() => {
                        closeAllMenus();
                        playRecording(item.uri, index);
                      }}
                    >
                      <Text style={styles.playIcon}>
                        {isCurrentPlaying && isPlaying ? '❚❚' : '▶'}
                      </Text>
                    </TouchableOpacity>


                    <TouchableOpacity
                      style={styles.nameContainer}
                      onPress={() => {
                        closeAllMenus();
                        playRecording(item.uri, index); // ✅ 點檔名也能播放
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


                    {/* 三點選單按鈕 - 只在非播放狀態或當前播放項目顯示 */}
                    {(isCurrentPlaying || !isPlaying) && (
                      <TouchableOpacity
                        style={styles.moreButton}
                        onPress={(e) => {
                          e.stopPropagation();

                          // 若點同一個就收起來
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
                  {(playingUri === item.uri ||
                    playingUri === item.derivedFiles?.enhanced?.uri ||
                    playingUri === item.derivedFiles?.trimmed?.uri) && (
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

                        {/* 時間 + 播放速度排一列 */}
                        <View
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: 4,
                          }}
                        >
                          <Text style={styles.timeText}>
                            {formatTime(playbackPosition)} / {formatTime(playbackDuration)}
                          </Text>

                          {/* 播放速度按鈕 */}
                          <TouchableOpacity
                            onPress={(e) => {
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
                    )}



                  {/* 衍生檔案列表 */}
                  {hasDerivedFiles && (
                    <View style={styles.derivedFilesContainer}>
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
                              // 若再次點選相同的衍生三點，則收起
                              if (
                                selectedDerivedIndex &&
                                selectedDerivedIndex.index === index &&
                                selectedDerivedIndex.type === 'enhanced' // or 'trimmed'，視當前按鈕而定
                              ) {
                                setSelectedDerivedIndex(null);
                                return;
                              }


                              // 獲取按鈕在屏幕上的絕對位置
                              e.target.measure((x, y, width, height, pageX, pageY) => {
                                setSelectedDerivedIndex({
                                  type: 'enhanced',
                                  index,
                                  position: { x: pageX, y: pageY } // 儲存位置
                                });
                              });
                            }}
                          >
                            <Text style={styles.moreIcon}>⋯</Text>
                          </TouchableOpacity>
                        </View>
                      )}

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
                              // 若再次點選相同的衍生三點，則收起
                              if (
                                selectedDerivedIndex &&
                                selectedDerivedIndex.index === index &&
                                selectedDerivedIndex.type === 'trimmed'//視當前按鈕而定
                              ) {
                                setSelectedDerivedIndex(null);
                                return;
                              }

                              // 獲取按鈕在屏幕上的絕對位置
                              e.target.measure((x, y, width, height, pageX, pageY) => {
                                setSelectedDerivedIndex({
                                  type: 'trimmed',
                                  index,
                                  position: { x: pageX, y: pageY } // 儲存位置
                                });
                              });
                            }}
                          >

                            <Text style={styles.moreIcon}>⋯</Text>
                          </TouchableOpacity>
                        </View>
                      )}

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
          }

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
            {/*
            <TouchableOpacity
              style={styles.optionButton}
              onPress={() => {
                startEditingName(selectedMainIndex);
                closeAllMenus();
              }}
            >
              <Text style={styles.optionText}>✏️ 重新命名</Text>
            </TouchableOpacity>
*/}
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



      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
};

const App = () => <AudioRecorder />;
export default App;