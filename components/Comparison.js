import React, { useState, useEffect } from 'react';
import { TextInput, StatusBar, ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { Audio } from 'expo-av';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TouchableWithoutFeedback, Keyboard } from 'react-native';
import { KeyboardAvoidingView} from 'react-native';


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
        setCurrentSound(null);
        setPlayingUri(null);
        setIsPlaying(false);
      }

      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(recordingOptions);
      setRecording(recording);
    } catch (err) {
      Alert.alert('錄音失敗', err.message);
      console.error('錄音錯誤:', err);
    }
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
          const formattedName = `錄音_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.wav`;

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
    }
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

        const { sound } = await Audio.Sound.createAsync({ uri });
        setCurrentSound(sound);
        setPlayingUri(uri);
        setIsPlaying(true);

        await sound.playAsync();

        // 播放完自動清除狀態
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.didJustFinish) {
            setIsPlaying(false);
            setPlayingUri(null);
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

      <TouchableWithoutFeedback
        onPress={() => {
          Keyboard.dismiss();           // 關鍵盤收起
          setShowOptions(false);        // ⋯選單收起
          setSelectedIndex(null);       // 取消選中
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
                onPress={recording ? stopRecording : startRecording}
              >
                <Text style={styles.recordButtonText}>
                  {recording ? '停止錄音' : '開始錄音 (WAV)'}
                </Text>
              </TouchableOpacity>

            </View>

            <View style={styles.bottomSection}>
              <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                {recordings.map((item, index) => (
                  <View
                    key={index}
                    style={[
                      styles.recordingItem,
                      index !== 0 && { marginTop: 10 }, // 只有非第一筆加上間距
                    ]}
                  >

                    <Text style={styles.recordingName}>{item.name}</Text>
                    <View style={styles.buttonGroup}>
                      {/* ▶️ 播放 */}
                      <TouchableOpacity
                        style={styles.playButton}
                        onPress={() => playRecording(item.uri)}
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
                          if (item.transcript) {
                            setRecordings(prev =>
                              prev.map(r =>
                                r.uri === item.uri
                                  ? { ...r, showTranscript: !r.showTranscript }
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
                          setSelectedIndex(index);
                          setShowOptions(true);
                        }}
                        style={styles.moreButton}
                      >
                        <Text style={styles.moreIcon}>⋯</Text>
                      </TouchableOpacity>
                    </View>
{/*... 選單內容 */} 
                    {selectedIndex === index && showOptions && (
                      <View style={styles.inlineOptionsMenu}>
                        {/* ✏️ 修改檔名 */}
                        <TouchableOpacity
                          style={styles.optionsItem}
                          onPress={() => {
                            setShowOptions(false);
                          }}
                        >
                          <Text style={styles.optionsText}>✏️ 修改檔名</Text>
                        </TouchableOpacity>

                        {/* 💾 儲存檔案 */}
                        <TouchableOpacity
                          style={styles.optionsItem}
                          onPress={() => {
                            setShowOptions(false);
                          }}
                        >
                          <Text style={styles.optionsText}>💾 儲存檔案</Text>
                        </TouchableOpacity>

                        {/* 📤 分享 */}
                        <TouchableOpacity
                          style={styles.optionsItem}
                          onPress={() => {
                            setShowOptions(false);
                            shareRecording(item.uri);
                          }}
                        >
                          <Text style={styles.optionsText}>📤 分享</Text>
                        </TouchableOpacity>

                        {/* 🗑️ 刪除 */}
                        <TouchableOpacity
                          style={styles.optionsItem}
                          onPress={() => {
                            setShowOptions(false);
                            deleteRecording(index);
                          }}
                        >
                          <Text style={styles.deleteText}>🗑️ 刪除</Text>
                        </TouchableOpacity>

                        {/* ❎ 取消 */}
                        <TouchableOpacity
                          onPress={() => {
                            setShowOptions(false);
                            setSelectedIndex(null);
                          }}
                        >
                          <Text style={styles.cancelText}>取消</Text>
                        </TouchableOpacity>
                      </View>
                    )}


{/* 以下是轉文字畫面部分按鈕 */}
                    {item.transcript && item.showTranscript && (
                      <View style={styles.transcriptContainer}>
                        {editingUri === item.uri ? (
                          <>
                            <TextInput
                              value={editingText}
                              onChangeText={setEditingText}
                              multiline
                              style={styles.editInput}
                            />
                            <View style={styles.transcriptButtons}>
                              <TouchableOpacity
                                style={styles.copyButton}
                                onPress={() => {
                                  // 儲存更新 transcript
                                  setRecordings(prev =>
                                    prev.map(r =>
                                      r.uri === item.uri ? { ...r, transcript: editingText } : r
                                    )
                                  );
                                  setEditingUri(null);
                                  setEditingText('');
                                }}
                              >
                                <Text style={styles.buttonText}>儲存</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={[styles.copyButton, { backgroundColor: '#999' }]}
                                onPress={() => {
                                  // 取消編輯
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
                            <View style={styles.transcriptButtons}>
                              <TouchableOpacity
                                style={styles.editTranscriptButton}
                                onPress={() => {
                                  setEditingUri(item.uri);
                                  setEditingText(item.transcript);
                                }}
                              >
                                <Text style={styles.buttonText}>編輯</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.shareTextButton}
                                onPress={() => Share.share({ message: item.transcript })}
                              >
                                <Text style={styles.buttonText}>轉發文字</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={[styles.copyButton, styles.summaryButton]}
                                onPress={() => {
                                  if (item.meetingSummary) {
                                    setRecordings(prev =>
                                      prev.map(r =>
                                        r.uri === item.uri
                                          ? { ...r, showSummary: !r.showSummary }
                                          : r
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
                                style={[styles.copyButton, { backgroundColor: '#aaa' }]}
                                onPress={() => {
                                  setRecordings(prev =>
                                    prev.map(r =>
                                      r.uri === item.uri
                                        ? { ...r, showTranscript: false }
                                        : r
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

                    {item.meetingSummary && item.showSummary && (
                      <View style={styles.minutesContainer}>
                        <Text style={styles.minutesTitle}>會議紀錄摘要：</Text>

                        {editingSummaryUri === item.uri ? (
                          <>
                            <TextInput
                              value={editingSummaryText}
                              onChangeText={setEditingSummaryText}
                              multiline
                              style={styles.editInput}
                            />
                            <View style={styles.transcriptButtons}>
                              <TouchableOpacity
                                style={styles.copyButton}
                                onPress={() => {
                                  setRecordings(prev =>
                                    prev.map(r =>
                                      r.uri === item.uri
                                        ? { ...r, meetingSummary: editingSummaryText }
                                        : r
                                    )
                                  );
                                  setEditingSummaryUri(null);
                                  setEditingSummaryText('');
                                }}
                              >
                                <Text style={styles.buttonText}>儲存</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={[styles.copyButton, { backgroundColor: '#999' }]}
                                onPress={() => {
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
                            <View style={styles.transcriptButtons}>

                              <TouchableOpacity
                                style={styles.editSummaryButton}
                                onPress={() => {
                                  setEditingSummaryUri(item.uri);
                                  setEditingSummaryText(item.meetingSummary);
                                }}
                              >
                                <Text style={styles.buttonText}>編輯</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.shareTextButton}
                                onPress={() => Share.share({ message: item.meetingSummary })}
                              >
                                <Text style={styles.buttonText}>轉發摘要</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.copyButton, { backgroundColor: '#aaa' }]}
                                onPress={() => {
                                  setRecordings(prev =>
                                    prev.map(r =>
                                      r.uri === item.uri
                                        ? { ...r, showSummary: false }
                                        : r
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

// #3b64ce 深藍 #5a7edb中藍 #7ba2e4淺藍 #1E1E1E 深灰 #121212

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212', // 黑底
  },
  topSection: {
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
  },
  startRecordButton: {
    backgroundColor: '#1E1E1E',
    padding: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  stopRecordButton: {
    backgroundColor: '#1E1E1E',
    padding: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  recordButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 20,
  },

  bottomSection: {
    flex: 1,
    backgroundColor: '#121212',
  },
  statusBar: {
    backgroundColor: '#1E1E1E',
  },
  button: { // 🎛️ 通用按鈕容器
    padding: 15,
    alignItems: 'center',
    marginBottom: 12,
  },

  buttonText: { // ✅ 通用白字文字
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  recordingItem: {
    backgroundColor: '#1E1E1E',
    paddingHorizontal: 15,
    paddingBottom: 0,
    marginBottom: 0,
  },
  recordingName: {
    marginBottom: 10,
    fontWeight: 'bold',
    fontSize: 14,
    color: '#FFFFFF'
  },
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  playButton: { // ▶️ 播放按鈕
    backgroundColor: '#5a7edb',
    padding: 10,
    borderRadius: 5,
    flex: 1,
    marginRight: 5,
    alignItems: 'center',
  },
  deleteButton: { // 🗑️ 刪除按鈕
    backgroundColor: '#5a7edb',
    padding: 10,
    borderRadius: 5,
    flex: 1,
    marginLeft: 5,
    alignItems: 'center',
  },
  shareButton: { // 📤 分享錄音按鈕
    backgroundColor: '#5a7edb',
    padding: 10,
    borderRadius: 5,
    flex: 1,
    marginLeft: 5,
    alignItems: 'center',
  },
  transcribeButton: { // 📝 轉文字按鈕
    backgroundColor: '#5a7edb',
    padding: 10,
    borderRadius: 5,
    flex: 1,
    marginLeft: 5,
    alignItems: 'center',
  },
  transcriptContainer: {
    backgroundColor: '#2A2A2A',
    padding: 15,
    borderRadius: 8,
    marginTop: 20,
  },
  transcriptText: {
    lineHeight: 22,
    color: '#FFFFFF',
    marginBottom: 10,
    fontSize: 16,
  },
  editInput: {
    backgroundColor: '#1E1E1E',
    borderColor: '#444444',
    borderWidth: 1,
    borderRadius: 5,
    padding: 10,
    fontSize: 16,
    color: '#FFFFFF',
    minHeight: 100,
  },
  transcriptButtons: {
    flexDirection: 'row',
    marginTop: 10,
    justifyContent: 'flex-start',
  },
  copyButton: { // 🖊️ 編輯／儲存／隱藏按鈕（一般用）
    backgroundColor: '#5a7edb',
    padding: 8,
    borderRadius: 5,
    marginRight: 10,
    minWidth: 60,
    alignItems: 'center',
  },
  editTranscriptButton: { // 🖊️ 編輯 transcript 按鈕
    backgroundColor: '#5a7edb',
    padding: 8,
    borderRadius: 5,
    marginRight: 10,
    minWidth: 60,
    alignItems: 'center',
  },
  editSummaryButton: { // 🖊️ 編輯 summary 按鈕（分開設計）
    backgroundColor: '#3b64ce',
    padding: 8,
    borderRadius: 5,
    marginRight: 10,
    minWidth: 60,
    alignItems: 'center',
  },
  shareTextButton: { // 📤 轉發文字／摘要
    backgroundColor: '#5a7edb',
    padding: 8,
    borderRadius: 5,
    minWidth: 60,
    alignItems: 'center',
  },
  summaryButton: { // 📋 會議紀錄
    backgroundColor: '#3b64ce'
  },
  minutesContainer: {
    marginTop: 15,
    padding: 15,
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
  },
  minutesTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#7ba2e4',
    fontSize: 14,
  },
  minutesText: {
    lineHeight: 22,
    color: '#FFFFFF',
    marginBottom: 10,
    fontSize: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#444',
    marginVertical: 10,
  },

  moreButton: {
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreIcon: {
    color: '#FFFFFF',
    fontSize: 24,
  },

  optionsMenu: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1E1E1E',
    padding: 20,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    zIndex: 1000,
  },

  optionsTitle: {
    color: '#7ba2e4',
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 12,
  },

  optionsItem: {
    marginBottom: 10,
  },

  optionsText: {
    color: '#FFFFFF',
    fontSize: 14,
  },

  deleteText: {
    color: '#FF4D4D',
    fontSize: 14,
  },

  cancelText: {
    color: '#999999',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
  },
  inlineOptionsMenu: {
    marginTop: 10,
    backgroundColor: '#1E1E1E',
    padding: 15,
    borderRadius: 8,
  },
});

export default AudioRecorder;


