import {
  TextInput,
  StatusBar,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard
} from 'react-native';
import { Audio } from 'expo-av';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lightTheme, darkTheme } from './Color';// 匯入主色設定
import React, { useState, useEffect, useRef } from 'react';
import WaveformBars from './WaveformBars';


const AudioRecorder = () => {
  // 狀態管理
  const [recording, setRecording] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [currentSound, setCurrentSound] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [meetingSummary, setMeetingSummary] = useState('');
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [playingUri, setPlayingUri] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editingUri, setEditingUri] = useState(null);     // 正在編輯哪一筆文字
  const [editingText, setEditingText] = useState('');     // 暫存文字編輯內容
  const [editingSummaryUri, setEditingSummaryUri] = useState(null); // 哪一筆摘要在編輯
  const [editingSummaryText, setEditingSummaryText] = useState(''); // 暫存內容
  const [selectedIndex, setSelectedIndex] = useState(null); // 哪一筆開啟選單
  const [showOptions, setShowOptions] = useState(false); // 是否顯示選單
  const handleCloseOptions = () => {
    setShowOptions(false);
    setSelectedIndex(null);
    Keyboard.dismiss(); // ← 加上這行也能避免忘記關鍵盤
  };
  const [menuVisible, setMenuVisible] = useState(false); //漢堡選單
  const closeMenu = () => setMenuVisible(false); // 漢堡選單
  const [isDarkMode, setIsDarkMode] = useState(true); // 預設深色
  const colors = isDarkMode ? darkTheme : lightTheme;
  const styles = createStyles(colors);

  const [currentVolume, setCurrentVolume] = useState(0); // 當前音量 (0-1)
  const [currentDecibels, setCurrentDecibels] = useState(-160); // 當前分貝 (dB) 
  const [waveform, setWaveform] = useState([]); // 存播放過程中每個時間點的音量大小（0~1）

  const [playbackPosition, setPlaybackPosition] = useState(0); // 當前播放位置 (ms)
  const [playbackDuration, setPlaybackDuration] = useState(0); // 總時長 (ms)
  const [isSeeking, setIsSeeking] = useState(false); // 是否正在拖曳
  const [seekPosition, setSeekPosition] = useState(0); // 拖曳暫存位置
  const progressRef = useRef(null);

  const formatTime = (ms) => {
    if (!ms || ms < 0) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // WAV 格式錄音配置
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
  };

  // 清理音頻資源
  useEffect(() => {
    return () => {
      if (currentSound) {
        currentSound.unloadAsync();
      }
    };
  }, [currentSound]);

  // 開始錄音 (WAV格式)
  const startRecording = async () => {
    try {
      // 錄音前強制停止播放
      if (currentSound) {
        await currentSound.unloadAsync();
        setWaveform([]); // 👈 清空上一次播放留下的音量波形

        setCurrentSound(null);
        setPlayingUri(null);
        setIsPlaying(false);
      }

      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync({
        ...recordingOptions,
        isMeteringEnabled: true, // 啟用音量測量
      });
      setRecording(recording);

      // 開始監聽音量變化
      startMetering(recording);
    } catch (err) {
      Alert.alert('錄音失敗', err.message);
      console.error('錄音錯誤:', err);
    }
  };

  // 音量量測
  const startMetering = async (recording) => {
    const interval = setInterval(async () => {
      if (recording) {
        try {
          const status = await recording.getStatusAsync();
          if (status.isRecording && status.metering) {
            // 轉換為分貝 (dB)，範圍約 -160 到 0
            const db = status.metering;
            setCurrentDecibels(db);

            // 轉換為 0-1 範圍 (線性)
            const amplified = (Math.min(Math.max(status.metering, -130), 0) + 130) / 130;
            //const amplified = Math.min(linear * 3, 1);
            setCurrentVolume(amplified);

            setWaveform((prev) =>
              prev.length > 200 ? [...prev.slice(1), amplified] : [...prev, amplified]
            );
          }
        } catch (err) {
          console.warn('獲取音量失敗:', err);
        }
      } else {
        clearInterval(interval); // 停止監聽
      }
    }, 100); // 每 100ms 更新一次
  };

  // 停止錄音
  const stopRecording = async () => {
    if (!recording) return;

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (uri) {
        const fileInfo = await FileSystem.getInfoAsync(uri);
        if (fileInfo.exists) {
          const now = new Date();
          const formattedName = `錄音_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}.wav`;

          setRecordings(prev => [
            {
              uri,
              name: formattedName,
              type: 'audio/wav',
              transcript: '',
              meetingSummary: '',
              transcribing: false,
              generatingSummary: false,
              showTranscript: false,
              showSummary: false,
            },
            ...prev
          ]);
        }
      }

    } catch (err) {
      Alert.alert('停止錄音失敗', err.message);
      console.error('停止錄音錯誤:', err);
    } finally {
      setRecording(null);
      setCurrentVolume(0); // 重置音量
      setCurrentDecibels(-160); // 重置分貝
    }
  };

  // 跳轉到指定位置
  const handleSeekComplete = async () => {
    if (!currentSound) return;

    try {
      await currentSound.setPositionAsync(seekPosition);
      setPlaybackPosition(seekPosition);
    } catch (err) {
      console.warn('跳轉失敗:', err);
    } finally {
      setIsSeeking(false);
    }
  };

  // 進度條拖曳處理
  const handleProgressDrag = (e) => {
    if (!playbackDuration || !progressRef.current) return;

    const touchX = e.nativeEvent.locationX;

    progressRef.current.measure((x, y, width) => {
      const newPosition = (touchX / width) * playbackDuration;
      setSeekPosition(Math.max(0, Math.min(newPosition, playbackDuration)));
      setIsSeeking(true);
    });
  };


  // 播放錄音
  const playRecording = async (uri) => {
    try {
      // 如果已經有在播放的錄音
      if (currentSound && playingUri === uri) {
        if (isPlaying) {
          await currentSound.pauseAsync();
          setIsPlaying(false);
        } else {
          await currentSound.playAsync();
          setIsPlaying(true);
        }
      } else {
        // 如果是播放新的錄音，先卸載舊的
        if (currentSound) {
          await currentSound.unloadAsync();
        }

        // 創建新音頻實例
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          {
            shouldPlay: true,
            isMeteringEnabled: true // 啟用音量檢測
          },
          (status) => {
            if (status.isLoaded) {
              // 更新總時長（只在首次載入時）
              if (status.durationMillis) {
                setPlaybackDuration(status.durationMillis);
              }

              // 更新當前位置（不在拖曳狀態時）
              if (!isSeeking && status.positionMillis) {
                setPlaybackPosition(status.positionMillis);
              }

              // 播放結束處理
              if (status.didJustFinish) {
                setIsPlaying(false);
                setPlayingUri(null);
                setPlaybackPosition(0); // 重置到開頭
              }
            }
          }
        );


        // 設置播放速率監聽（確保進度更新頻率）
        await sound.setProgressUpdateIntervalAsync(250); // 每250ms更新一次

        setCurrentSound(sound);
        setPlayingUri(uri);
        setIsPlaying(true);
        await sound.playAsync();

        // 播放完自動清除狀態
        sound.setOnPlaybackStatusUpdate((status) => {

          if (status.metering != null) {
            const db = status.metering;
            const linear = Math.pow(10, db / 20);
            const volume = Math.min(linear * 3, 1); // 放大一點點方便顯示
          
            setWaveform((prev) =>
              prev.length > 200 ? [...prev.slice(1), volume] : [...prev, volume]
            );
          }
          if (status.isLoaded) {
            if (!isSeeking && status.positionMillis != null) {
              setPlaybackPosition(status.positionMillis);
            }

            if (status.durationMillis != null) {
              setPlaybackDuration(status.durationMillis);
            }

            if (status.didJustFinish) {
              setIsPlaying(false);
              setPlayingUri(null);
              setPlaybackPosition(0);
            }
          }
        });

      }
    } catch (err) {
      Alert.alert('播放失敗', err.message);
      console.error('播放錯誤:', err);
    }
  };

  // 語音轉文字 (WAV格式)
  const transcribe = async (uri) => {
    setRecordings(prev => prev.map(item =>
      item.uri === uri ? { ...item, transcribing: true } : item
    ));

    try {
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) throw new Error('錄音文件不存在');

      const formData = new FormData();
      formData.append('audio', {
        uri,
        name: 'recording.wav',
        type: 'audio/wav'
      });

      const response = await axios.post('http://192.168.1.113:3000/transcribe', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': 'Bearer 你的API密鑰',
        },
      });

      if (response.data?.text) {
        setRecordings(prev => prev.map(item =>
          item.uri === uri ? {
            ...item,
            transcript: response.data.text,
            transcribing: false
          } : item
        ));
      } else {
        throw new Error('無效的API響應格式');
      }
    } catch (err) {
      let errorMsg = '轉換失敗\n';
      if (err.response) {
        errorMsg += `狀態碼: ${err.response.status}\n`;
        if (err.response.data) errorMsg += `錯誤詳情: ${JSON.stringify(err.response.data)}\n`;
      } else errorMsg += err.message;

      Alert.alert('轉換錯誤', errorMsg);
      setRecordings(prev => prev.map(item =>
        item.uri === uri ? { ...item, transcribing: false } : item
      ));
    }
  };

  // 產生會議記錄
  const generateMeetingMinutes = async (uri, transcript) => {
    setRecordings(prev => prev.map(item =>
      item.uri === uri ? { ...item, generatingSummary: true } : item
    ));

    try {
      const response = await axios.post('http://192.168.1.113:3000/summarize', { text: transcript });
      const summary = response.data.summary;

      setRecordings(prev => prev.map(item =>
        item.uri === uri ? { ...item, meetingSummary: summary, generatingSummary: false } : item
      ));
    } catch (err) {
      Alert.alert('產生會議紀錄失敗', err.message);
      setRecordings(prev => prev.map(item =>
        item.uri === uri ? { ...item, generatingSummary: false } : item
      ));
    }
  };

  // 刪除錄音
  const deleteRecording = (index) => {
    Alert.alert(
      '刪除錄音',
      '確定要刪除這個錄音嗎？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          onPress: async () => {
            handleCloseOptions();
            try {
              const uri = recordings[index].uri;
              await FileSystem.deleteAsync(uri, { idempotent: true });
              const newRecordings = [...recordings];
              newRecordings.splice(index, 1);
              setRecordings(newRecordings);
            } catch (err) {
              Alert.alert('刪除失敗', err.message);
              console.error('刪除錯誤:', err);
            }
          },
        },
      ]
    );
  };

  // 分享錄音
  const shareRecording = async (uri) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('分享功能不可用', '您的設備不支持分享功能');
        return;
      }
      await Sharing.shareAsync(uri);
    } catch (err) {
      Alert.alert('分享失敗', err.message);
      console.error('分享錯誤:', err);
    }
  };

  // 複製文字
  const copyToClipboard = async () => {
    try {
      await Clipboard.setStringAsync(transcript);
      Alert.alert('已複製', '文字已複製到剪貼簿');
    } catch (err) {
      Alert.alert('複製失敗', err.message);
      console.error('複製錯誤:', err);
    }
  };

  // 分享文字
  const shareTranscript = async () => {
    try {
      if (Platform.OS === 'web') {
        if (navigator.share) {
          await navigator.share({ text: transcript });
        } else {
          await Clipboard.setStringAsync(transcript);
          alert('文字已複製到剪貼簿（瀏覽器不支援直接分享）');
        }
      } else {
        await Share.share({
          message: transcript,
          dialogTitle: '分享轉錄文字'
        });
      }
    } catch (err) {
      if (err.message !== 'User did not share') {
        Alert.alert('分享失敗', err.message);
        console.error('分享錯誤:', err);
      }
    }
  };

  return (

    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      {/* 點選其他地方會關閉選單 */}
      {menuVisible && (
        <TouchableWithoutFeedback onPress={closeMenu}>
          <View style={styles.overlay} />
        </TouchableWithoutFeedback>
      )}

      {/* 右上角≡按鈕 */}
      <View style={styles.menuButtonContainer}>
        <TouchableOpacity onPress={() => setMenuVisible(!menuVisible)}>
          <Text style={styles.menuIcon}>≡</Text>
        </TouchableOpacity>
      </View>

      {/* 展開的浮動選單 */}
      {menuVisible && (
        <View style={styles.dropdownMenu}>
          <Text style={styles.menuItem}>版本：v1.0.2</Text>
          <TouchableOpacity onPress={() => {
            setIsDarkMode(prev => !prev);
            closeMenu();
          }}>
            <Text style={styles.menuItem}>
              切換為{isDarkMode ? '淺色' : '深色'}模式
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => {
            {/* TODO: 加入訂閱邏輯 */ }
            closeMenu();
          }}>
            <Text style={styles.menuItem}>訂閱狀態</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableWithoutFeedback
        onPress={() => {
          handleCloseOptions();
          Keyboard.dismiss();           // 關鍵盤收起
        }}
      >
        <View style={{ flex: 1 }}>
          <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }} edges={['top']}>
            <StatusBar
              backgroundColor={styles.statusBar.backgroundColor}
              barStyle="light-content"
            />
            <View style={styles.topSection}>
              <TouchableOpacity
                style={recording ? styles.stopRecordButton : styles.startRecordButton}
                onPress={() => {
                  handleCloseOptions();
                  recording ? stopRecording() : startRecording();
                }}
              >
                <Text style={styles.recordButtonText}>
                  {recording ? '停止錄音' : '開始錄音'}
                </Text>
              </TouchableOpacity>

              {recording && (
  <View style={styles.volumeContainer}>
    <Text style={styles.volumeText}>
      音量: {currentDecibels.toFixed(1)} dB
    </Text>
    
    <View style={styles.volumeBarWrapper}>
      <View 
        style={[
          styles.volumeBar,
          { 
            width: `${Math.min(currentVolume * 100, 100)}%`,
            backgroundColor: currentVolume > 0.9 ? colors.warning : colors.primary
          }
        ]}
      />
    </View>
  </View>
)}
            </View>
            <View style={styles.bottomSection}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                contentContainerStyle={{ paddingBottom: 80 }}
              >
                {recordings.map((item, index) => (
                  <View
                    key={index}
                    style={[
                      styles.recordingItem,
                      index !== 0 && { marginTop: 10 }, // 只有非第一筆加上間距
                    ]}
                  >

                    <View style={styles.recordingNameWrapper}>
                      {/* <View style={styles.circle} />*/}     {/* 這是圈圈 */}
                      <Text style={styles.recordingName}>{item.name}</Text>
                    </View>


                    {/* 可拖曳進度條 */}
                    {playingUri === item.uri && waveform.length > 0 && (
  <WaveformBars waveform={waveform} height={40} />
)}
                    <View style={styles.progressContainer}>
                      {/* 進度條 */}
                      <View
                        ref={progressRef}
                        style={styles.progressBarContainer}
                        onStartShouldSetResponder={() => true}
                        onResponderGrant={handleProgressDrag}
                        onResponderMove={handleProgressDrag}
                        onResponderRelease={handleSeekComplete}
                      >

                        <View style={styles.progressBarBackground}>
                          <View style={[
                            styles.progressBarFill,
                            {
                              width: `${Math.min(
                                (isSeeking ? seekPosition : playbackPosition) / playbackDuration * 100,
                                100
                              )}%`
                            }
                          ]} />
                        </View>
                        <View style={[
                          styles.progressThumb,
                          {
                            left: `${Math.min(
                              (isSeeking ? seekPosition : playbackPosition) / playbackDuration * 100,
                              100
                            )}%`
                          }
                        ]} />
                      </View>

                      {/* 時間顯示 */}
                      <Text style={styles.durationText}>
                        {formatTime(isSeeking ? seekPosition : playbackPosition)} / {formatTime(playbackDuration)}
                      </Text>
                    </View>



                    <View style={styles.buttonGroup}>
                      {/* ▶️ 播放 */}
                      <TouchableOpacity
                        style={[
                          styles.playButton,
                          playingUri === item.uri && isPlaying && styles.playingButton
                        ]}
                        onPress={() => {
                          handleCloseOptions();

                          playRecording(item.uri);
                        }}
                        disabled={!!recording}
                      >
                        <Text style={styles.buttonText}>
                          {playingUri === item.uri && isPlaying ? '暫停' : '播放'}
                        </Text>
                      </TouchableOpacity>

                      {/* 📝 轉文字 */}
                      <TouchableOpacity
                        style={styles.transcribeButton}
                        onPress={() => {
                          handleCloseOptions();

                          if (item.transcript) {
                            setRecordings(prev =>
                              prev.map(r =>
                                r.uri === item.uri
                                  ? { ...r, showTranscript: true }
                                  : r
                              )
                            );
                          } else {
                            transcribe(item.uri);
                          }
                        }}
                        disabled={item.transcribing}
                      >
                        {item.transcribing ? (
                          <ActivityIndicator color={styles.buttonText.color} />
                        ) : (
                          <Text style={styles.buttonText}>轉文字</Text>
                        )}
                      </TouchableOpacity>

                      {/* ⋯ 更多選單 */}

                      <TouchableOpacity
                        onPress={() => {
                          handleCloseOptions();
                          if (selectedIndex === index && showOptions) {
                            // 🔽 點到同一筆時：收起
                            handleCloseOptions();
                          } else {
                            // 🔽 點到不同筆時：關舊的、開新的
                            setShowOptions(false);
                            setSelectedIndex(index);
                            setShowOptions(true);
                          }
                        }}
                        style={styles.moreButton}
                      >
                        <Text style={styles.moreIcon}>⋯</Text>
                      </TouchableOpacity>
                    </View> {/* buttongroup 結束 */}

                    {/* ⋯ 選單內容 */}
                    {selectedIndex === index && showOptions && (
                      <View style={styles.inlineOptionsMenu}>
                        {/* ✏️ 修改檔名 */}
                        <TouchableOpacity
                          style={styles.optionsItem}
                          onPress={() => {
                            handleCloseOptions();
                          }}
                        >
                          <Text style={styles.optionsText}>修改檔名</Text>
                        </TouchableOpacity>

                        {/* 💾 儲存檔案 */}
                        <TouchableOpacity
                          style={styles.optionsItem}
                          onPress={() => {
                            handleCloseOptions();
                          }}
                        >
                          <Text style={styles.optionsText}>儲存檔案</Text>
                        </TouchableOpacity>

                        {/* 📤 分享 */}
                        <TouchableOpacity
                          style={styles.optionsItem}
                          onPress={() => {
                            handleCloseOptions();
                            shareRecording(item.uri);
                          }}
                        >
                          <Text style={styles.optionsText}>分享</Text>
                        </TouchableOpacity>

                        {/* 🗑️ 刪除 */}
                        <TouchableOpacity
                          style={styles.optionsItem}
                          onPress={() => {
                            handleCloseOptions();
                            deleteRecording(index);
                          }}
                        >
                          <Text style={styles.deleteText}>刪除</Text>
                        </TouchableOpacity>

                        {/* ❎ 取消 */}
                        <TouchableOpacity
                          onPress={() => {
                            handleCloseOptions();
                            setSelectedIndex(null);
                          }}
                        >
                          <Text style={styles.cancelText}>取消</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/*以下轉文字*/}
                    {item.transcript && item.showTranscript && (
                      <View style={styles.transcriptContainer}>
                        {editingUri === item.uri ? (
                          <>
                            <TextInput
                              value={editingText}
                              onChangeText={setEditingText}
                              multiline
                              scrollEnabled={false}
                              style={[styles.editInput, { maxHeight: 200 }]}
                            />
                            <View style={styles.transcriptButtonsGroup}>
                              <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={() => {
                                  handleCloseOptions();
                                  const originalTranscript = item.transcript;
                                  const hadSummary = !!item.meetingSummary;

                                  setRecordings(prev =>
                                    prev.map(r =>
                                      r.uri === item.uri ? { ...r, transcript: editingText } : r
                                    )
                                  );

                                  setEditingUri(null);
                                  setEditingText('');

                                  if (hadSummary && editingText !== originalTranscript) {
                                    Alert.alert(
                                      '重新產生會議紀錄？',
                                      '錄音內容已修正，是否重新產生會議紀錄？',
                                      [
                                        { text: '取消', style: 'cancel' },
                                        {
                                          text: '重新產生',
                                          onPress: () => {
                                            handleCloseOptions();
                                            generateMeetingMinutes(item.uri, editingText);
                                          },
                                        },
                                      ]
                                    );
                                  }
                                }}
                              >
                                <Text style={styles.buttonText}>儲存</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.disabledButton}
                                onPress={() => {
                                  handleCloseOptions();
                                  setEditingUri(null);
                                  setEditingText('');
                                }}
                              >
                                <Text style={styles.buttonText}>取消</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        ) : (
                          <>
                            <Text style={styles.transcriptText}>{item.transcript}</Text>
                            <View style={styles.transcriptButtonsGroup}>
                              <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={() => {
                                  handleCloseOptions();
                                  setEditingUri(item.uri);
                                  setEditingText(item.transcript);
                                }}
                              >
                                <Text style={styles.buttonText}>編輯</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={() => Share.share({ message: item.transcript })}
                              >
                                <Text style={styles.buttonText}>轉發文字</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={() => {
                                  handleCloseOptions();
                                  if (item.meetingSummary) {
                                    setRecordings(prev =>
                                      prev.map(r =>
                                        r.uri === item.uri ? { ...r, showSummary: !r.showSummary } : r
                                      )
                                    );
                                  } else {
                                    generateMeetingMinutes(item.uri, item.transcript);
                                  }
                                }}
                                disabled={item.generatingSummary}
                              >
                                {item.generatingSummary ? (
                                  <ActivityIndicator color={styles.buttonText.color} />
                                ) : (
                                  <Text style={styles.buttonText}>會議紀錄</Text>
                                )}
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.disabledButton}
                                onPress={() => {
                                  handleCloseOptions();
                                  setRecordings(prev =>
                                    prev.map(r =>
                                      r.uri === item.uri ? { ...r, showTranscript: false } : r
                                    )
                                  );
                                }}
                              >
                                <Text style={styles.buttonText}>隱藏</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        )}
                      </View>
                    )}

                    {/*以下會議記錄*/}
                    {item.meetingSummary && item.showSummary && (
                      <View style={styles.minutesContainer}>
                        {editingSummaryUri === item.uri ? (
                          <>
                            <TextInput
                              value={editingSummaryText}
                              onChangeText={setEditingSummaryText}
                              multiline
                              style={styles.editInput}
                            />
                            <View style={styles.transcriptButtonsGroup}>
                              <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={() => {
                                  handleCloseOptions();
                                  setRecordings(prev =>
                                    prev.map(r =>
                                      r.uri === item.uri ? { ...r, meetingSummary: editingSummaryText } : r
                                    )
                                  );
                                  setEditingSummaryUri(null);
                                  setEditingSummaryText('');
                                }}
                              >
                                <Text style={styles.buttonText}>儲存</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.disabledButton}
                                onPress={() => {
                                  handleCloseOptions();
                                  setEditingSummaryUri(null);
                                  setEditingSummaryText('');
                                }}
                              >
                                <Text style={styles.buttonText}>取消</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        ) : (
                          <>
                            <Text style={styles.minutesText}>{item.meetingSummary}</Text>
                            <View style={styles.transcriptButtonsGroup}>
                              <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={() => {
                                  handleCloseOptions();
                                  setEditingSummaryUri(item.uri);
                                  setEditingSummaryText(item.meetingSummary);
                                }}
                              >
                                <Text style={styles.buttonText}>編輯</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={() => Share.share({ message: item.meetingSummary })}
                              >
                                <Text style={styles.buttonText}>轉發摘要</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.disabledButton}
                                onPress={() => {
                                  handleCloseOptions();
                                  setRecordings(prev =>
                                    prev.map(r =>
                                      r.uri === item.uri ? { ...r, showSummary: false } : r
                                    )
                                  );
                                }}
                              >
                                <Text style={styles.buttonText}>隱藏</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        )}
                      </View>
                    )}

                    {index !== recordings.length - 1 && <View style={styles.divider} />}

                  </View>
                ))}

              </ScrollView>

            </View>

          </SafeAreaView>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background, /* 黑底 */
  },
  topSection: {
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  startRecordButton: {
    backgroundColor: colors.primary,
    borderRadius: 15,
    padding: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  stopRecordButton: {
    backgroundColor: colors.warning,
    padding: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  recordButtonText: {
    color: colors.buttontext,
    fontWeight: 'bold',
    fontSize: 20,
  },
  volumeContainer: {
    width: '80%', // 固定寬度
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
    paddingVertical: 8, // 增加垂直內邊距
  },
  volumeText: {
    color: colors.text,
    fontSize: 14,
    width: 100, // 固定文字寬度
    marginRight: 10, // 增加右邊距
  },
  volumeBarWrapper: {
    flex: 1,
    height: 10, // 固定高度
    backgroundColor: colors.background, // 背景色
    borderRadius: 5, // 圓角
    overflow: 'hidden', // 確保子元素不超出
  },
  volumeBar: {
    height: '100%',
    width: '50%', // 這個會被動態覆蓋
    backgroundColor: colors.primary, // 藍色進度條
    borderRadius: 5,
  },
  bottomSection: {
    flex: 1,
    backgroundColor: colors.background,
  },
  statusBar: {
    backgroundColor: colors.background,
  },
  button: { /* 通用按鈕容器 */
    padding: 15,
    alignItems: 'center',
    marginBottom: 12,
  },

  buttonText: { /* 通用白字文字 */
    color: colors.buttontext,
    fontWeight: 'bold',
    fontSize: 12,
  },
  recordingItem: {
    backgroundColor: colors.background,
    paddingHorizontal: 15,
    paddingBottom: 0,
    marginBottom: 0,
  },
  recordingName: { //音檔檔名
    marginBottom: 10,
    fontWeight: 'bold',
    fontSize: 14,
    color: colors.text,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    width: '100%',
  },
  progressBarContainer: {
    flex: 1,
    height: 30, // 增加高度方便觸控
    marginRight: 10,
    justifyContent: 'center',
  },
  progressBarBackground: {
    height: 4,
    width: '100%',
    backgroundColor: colors.secondary,
    borderRadius: 2,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    marginLeft: -8, // 居中對齊
    top: -6, // 垂直居中
  },
  durationText: {
    color: colors.text,
    fontSize: 12,
    minWidth: 100,
    textAlign: 'right',
  },
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 15, // 讓整排按鈕往右移一點
  },
  playButton: { /* 播放按鈕 */
    backgroundColor: colors.primary,
    padding: 5,
    borderRadius: 5,
    flex: 1,
    marginRight: 5,
    alignItems: 'center',
  },
  playingButton: { /* 播放暫停按鈕 */
    backgroundColor: colors.logo,
    padding: 5,
    borderRadius: 5,
    flex: 1,
    marginRight: 5,
    alignItems: 'center',
  },
  transcribeButton: { /* 轉文字按鈕 */
    backgroundColor: colors.primary,
    padding: 5,
    borderRadius: 5,
    flex: 1,
    marginLeft: 5,
    alignItems: 'center',
  },
  transcriptContainer: { // 轉文字容器
    backgroundColor: colors.container,
    padding: 15,
    borderRadius: 8,
    marginTop: 20,
    borderWidth: 1,                // 🔲 加上框線
    borderColor: colors.primary,        // 🔵 用淺藍色邊框
    borderRadius: 20,              // ⭕️ 加上圓角變成圓形
  },
  transcriptText: { //轉文字內容
    lineHeight: 22,
    color: colors.text,
    marginBottom: 10,
    fontSize: 16,
  },
  transcriptButtons: {
    flexDirection: 'row',
    marginTop: 10,
    justifyContent: 'flex-start',
  },

  minutesContainer: {
    marginTop: 15,
    padding: 15,
    backgroundColor: colors.container,
    borderRadius: 8,
    borderWidth: 1,                // 🔲 加上框線
    borderColor: colors.primary,        // 🔵 用淺藍色邊框
    borderRadius: 20,              // ⭕️ 加上圓角變成圓形
  },

  minutesText: { //會議記錄
    lineHeight: 22,
    color: colors.text,
    marginBottom: 10,
    fontSize: 16,
  },
  divider: {
    height: 1,
    backgroundColor: colors.secondary,
    marginVertical: 10,
  },

  moreButton: {
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingvertical: 5,

  },
  moreIcon: { //點點點顏色
    color: colors.text,
    fontSize: 24,
  },

  optionsItem: {
    marginBottom: 10,
  },

  optionsText: { //點點點內文字
    color: colors.text,
    fontSize: 14,
  },

  deleteText: { //點點點內刪除
    color: colors.warning,
    fontSize: 14,
  },

  cancelText: { //點點點內取消
    color: colors.text,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
  },
  inlineOptionsMenu: { //點點點選單
    marginTop: 10,
    backgroundColor: colors.background,
    padding: 15,
    borderRadius: 8,
  },
  transcriptButtonsGroup: {
    flexDirection: 'row',
    marginTop: 6,
    flexWrap: 'wrap',
    gap: 8,
  },
  primaryButton: { //文字那行
    backgroundColor: colors.primary,
    padding: 6,
    borderRadius: 5,
    minWidth: 60,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: '#aaa',
    padding: 6,
    borderRadius: 5,
    minWidth: 60,
    alignItems: 'center',
  },
  recordingNameWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  circle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.logo,
    marginRight: 10,
    marginTop: 4,
  },
  menuButtonContainer: {
    position: 'absolute',
    top: 10,
    right: 20,
    zIndex: 10,
  },
  editInput: {
    backgroundColor: colors.background,
    borderRadius: 5,
    padding: 10,
    fontSize: 16,
    color: colors.text, // 👈 這一行就是設定「輸入中文字的顏色」
    minHeight: 100,
  },

  menuIcon: { // 漢堡
    fontSize: 30,
    fontWeight: 'bold',
    color: colors.primary,
  },
  dropdownMenu: { //漢堡
    position: 'absolute',
    top: 90,
    right: 20,
    backgroundColor: colors.background,
    borderWidth: 1,                // 框線
    borderColor: colors.secondary, // 邊框
    borderRadius: 20,              // 圓角
    padding: 12,
    borderRadius: 10,
    elevation: 5,
    zIndex: 11,
  },
  menuItem: {
    fontSize: 16,
    paddingVertical: 6,
    color: colors.text,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 9,
  },
});

export default AudioRecorder;


