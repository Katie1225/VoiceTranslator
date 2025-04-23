import React, { useState, useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    SafeAreaView,
    TextInput,
    Alert,
    ActivityIndicator,
    TouchableWithoutFeedback,
    Share
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
import { uFPermissions } from '../src/hooks/uFPermissions';
import { Linking } from 'react-native'; // ✅ 正確寫法
import { Keyboard } from 'react-native';

const GlobalRecorderState = {
    isRecording: false,
    filePath: '',
    startTime: 0,
};

const RecorderPageVoiceClamp = () => {
    const title = "Voice Clamp";
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

    // 音量狀態
    const [currentVolume, setCurrentVolume] = useState(0);
    const [currentDecibels, setCurrentDecibels] = useState(-160);
    const [recordingTime, setRecordingTime] = useState(0);

    // 播放進度狀態
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

    const shareText = async (text: string) => {
        if (!text || text.trim() === '') {
            Alert.alert('無法分享', '內容為空');
            return;
        }

        try {
            await Share.share({ message: text });
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
                    Alert.alert("⏱ 錄音已達上限", "每段最多錄音 10 分鐘");
                }
            }, 10 * 60 * 1000);
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
                const displayName = `[錄音] ${durationText} ${hours}:${minutes}:${seconds} ${now.getMonth() + 1}/${now.getDate()}`;



                const newItem: RecordingItem = {
                    uri: normalizedUri,
                    name,
                    displayName,
                    derivedFiles: {},
                };

                setShowTranscriptIndex(null);   // 🔧 錄音完後，確保不會自動顯示 transcript
                setShowSummaryIndex(null);      // 🔧 順便清掉 summary 展開
                setEditingTranscriptIndex(null); // 🔧 清除編輯狀態（如果你有保留 transcript 編輯功能）

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

                            // ✅ 使用 hook 中的工具函式刪除主檔與衍生檔案
                            await safeDeleteFile(item.uri);
                            if (item.derivedFiles?.enhanced?.uri) {
                                await safeDeleteFile(item.derivedFiles.enhanced.uri);
                            }
                            if (item.derivedFiles?.trimmed?.uri) {
                                await safeDeleteFile(item.derivedFiles.trimmed.uri);
                            }

                            // ✅ 更新 state
                            const updated = [...recordings];
                            updated.splice(index, 1);
                            setRecordings(updated);
                            await saveRecordings(updated);
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


    return (
        <TouchableWithoutFeedback onPress={closeAllMenus}>
            <SafeAreaView style={styles.container}>
                {isLoading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.primary} />
                        <Text style={styles.loadingText}>
                            {Platform.OS === 'android' ? '正在檢查權限...' : '載入錄音列表中...'}
                        </Text>
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
                        <HamburgerMenu
                            visible={menuVisible}
                            onClose={closeAllMenus}
                            isDarkMode={isDarkMode}
                            setIsDarkMode={setIsDarkMode}
                            customPrimaryColor={customPrimaryColor}
                            setCustomPrimaryColor={setCustomPrimaryColor}
                            styles={styles}
                        />


                        {/* 錄音按鈕 & 音量顯示 */}
                        <RecorderButton
                            title={title}
                            recording={recording}
                            recordingTime={recordingTime}
                            onStart={startRecording}
                            onStop={stopRecording}
                            styles={styles}
                            colors={colors}
                        />

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

                                    const hasAnyContent = item.transcript || item.summary;
                                    const isVisible = showTranscriptIndex === index || showSummaryIndex === index;
                                    const canHide = hasAnyContent && isVisible;


                                    return (
                                        <View
                                            key={index}
                                            style={{
                                                position: 'relative',
                                                zIndex:
                                                    selectedContext &&
                                                        selectedContext.index === index &&
                                                        selectedContext.type !== 'main'
                                                        ? 999
                                                        : 0,
                                            }}
                                        >
                                            {/* 單個錄音項目的完整 UI */}
                                            <View style={[styles.recordingItem, { minHeight: 80 }]}>
                                                {/* 名稱行 */}
                                                <View style={styles.nameRow}>


                                                    {/* 名稱顯示/編輯 */}
                                                    <View style={styles.nameContainer}>
                                                        {editingIndex === index ? (
                                                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                                <TextInput
                                                                    style={[styles.nameInput, { flex: 1 }]}
                                                                    value={editName}
                                                                    onChangeText={setEditName}
                                                                    autoFocus
                                                                />
                                                                <View style={{ flexDirection: 'row', gap: 16 }}>
                                                                    <TouchableOpacity
                                                                        onPress={() => {
                                                                            if (editName.trim()) {
                                                                                const updated = recordings.map((rec, i) =>
                                                                                    i === index ? { ...rec, displayName: editName } : rec
                                                                                );
                                                                                setRecordings(updated);
                                                                                saveRecordings(updated);
                                                                            }
                                                                            setEditingIndex(null);
                                                                        }}
                                                                    >
                                                                        <Text style={styles.transcriptActionButton}>💾</Text>
                                                                    </TouchableOpacity>
                                                                    <TouchableOpacity
                                                                        onPress={() => {
                                                                            setEditName('');
                                                                            setEditingIndex(null);
                                                                        }}
                                                                    >
                                                                        <Text style={styles.transcriptActionButton}>✖️</Text>
                                                                    </TouchableOpacity>
                                                                </View>
                                                            </View>
                                                        ) : (
                                                            <TouchableOpacity
                                                                onPress={() => {
                                                                    closeAllMenus();
                                                                    togglePlayback(item.uri, index);
                                                                }}
                                                                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                                                            >
                                                                <Text style={styles.playIcon}>
                                                                    {playingUri === item.uri && isPlaying ? '❚❚' : '▶'}
                                                                </Text>
                                                                <Text
                                                                    style={[
                                                                        styles.recordingName,
                                                                        playingUri === item.uri && styles.playingText
                                                                    ]}
                                                                    numberOfLines={1}
                                                                    ellipsizeMode="tail"
                                                                >
                                                                    {item.displayName || item.name}
                                                                </Text>
                                                            </TouchableOpacity>

                                                        )}

                                                    </View>

                                                    {/* 更多按鈕 */}
                                                    {(isCurrentPlaying || !isPlaying) && editingIndex !== index && (
                                                        <TouchableOpacity
                                                            style={styles.moreButton}
                                                            onPress={(e) => {
                                                                e.stopPropagation();
                                                                closeAllMenus();

                                                                e.target.measureInWindow((x, y, width, height) => {
                                                                    setSelectedContext({
                                                                        type: 'main',
                                                                        index,
                                                                        position: { x, y: y + height },
                                                                    });;
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
                                                            if (item.transcript) {
                                                                // 已轉過文字就直接顯示，不重複呼叫 API
                                                                setShowTranscriptIndex(index);
                                                                setShowSummaryIndex(null);
                                                                return;
                                                            }

                                                            setIsTranscribingIndex(index);
                                                            try {
                                                                const { transcript } = await transcribeAudio(item);

                                                                const updated = recordings.map((rec, i) =>
                                                                    i === index ? { ...rec, transcript: transcript.text } : rec
                                                                );
                                                                setRecordings(updated);
                                                                await saveRecordings(updated); // ✅ 寫入本地 JSON

                                                                setShowTranscriptIndex(index);
                                                                setShowSummaryIndex(null);
                                                            } catch (err) {
                                                                Alert.alert('❌ 轉文字失敗', (err as Error).message);
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
                                                            opacity: item.transcript ? 1 : 0.4,
                                                        }}
                                                        disabled={!item.transcript}
                                                        onPress={async () => {
                                                            if (!item.transcript) {
                                                                Alert.alert('⚠️ 無法摘要', '請先執行「轉文字」功能');
                                                                return;
                                                            }

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
                                                            }
                                                        }}
                                                    >
                                                        <Text style={{ color: 'white', fontSize: 14 }}>重點摘要</Text>
                                                    </TouchableOpacity>
                                                    {/* 隱藏按鈕（只有已顯示 transcript 或 summary 才能點） */}
                                                    <TouchableOpacity
                                                        disabled={!canHide}
                                                        onPress={() => {
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
                                                {/*放這裡才能放在下一行*/}
                                                {isTranscribingIndex === index && (
                                                    <Text style={{ marginTop: 6, color: colors.primary }}>⏳ 轉文字處理中...</Text>
                                                )}


                                                {showTranscriptIndex === index && (
                                                    <View style={styles.transcriptContainer}>
                                                        <View style={styles.bar} />

                                                        {editingTranscriptIndex === index ? (
                                                            <>
                                                                <TextInput
                                                                    style={styles.transcriptTextInput}
                                                                    value={editTranscript}
                                                                    onChangeText={setEditTranscript}
                                                                    multiline
                                                                    autoFocus
                                                                />
                                                                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 8 }}>
                                                                    <TouchableOpacity
                                                                        onPress={async () => {
                                                                            Keyboard.dismiss(); // ✅ 先關鍵盤
                                                                            const updated = recordings.map((rec, i) =>
                                                                                i === index ? { ...rec, transcript: editTranscript } : rec
                                                                            );
                                                                            setRecordings(updated);
                                                                            await saveRecordings(updated);
                                                                            setEditingTranscriptIndex(null);
                                                                        }}
                                                                    >
                                                                        <Text style={[styles.transcriptActionButton, { color: colors.primary }]}>💾 儲存</Text>
                                                                    </TouchableOpacity>

                                                                    <TouchableOpacity
                                                                        onPress={() => {
                                                                            Keyboard.dismiss();                 // ✅ 關鍵盤
                                                                            setEditTranscript('');             // ✅ 清空暫存
                                                                            setEditingTranscriptIndex(null);   // ✅ 關閉編輯模式
                                                                        }}
                                                                    >
                                                                        <Text style={[styles.transcriptActionButton]}>✖️ 取消</Text>
                                                                    </TouchableOpacity>
                                                                </View>

                                                            </>
                                                        ) : (
                                                            <>
                                                                <Text style={styles.transcriptText}>{item.transcript}</Text>
                                                                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                                                                    <TouchableOpacity onPress={() => {
                                                                        setEditTranscript(item.transcript || '');
                                                                        setEditingTranscriptIndex(index);
                                                                    }}>
                                                                        <Text style={styles.transcriptActionButton}>✏️ 修改</Text>
                                                                    </TouchableOpacity>

                                                                    <TouchableOpacity
                                                                        onPress={() => {
                                                                            shareText(item.transcript || '');
                                                                        }}
                                                                    >
                                                                        <Text style={styles.transcriptActionButton}>📤 轉發</Text>
                                                                    </TouchableOpacity>


                                                                    <TouchableOpacity onPress={async () => {
                                                                        const updated = recordings.map((rec, i) =>
                                                                            i === index ? { ...rec, transcript: undefined } : rec
                                                                        );
                                                                        setRecordings(updated);
                                                                        await saveRecordings(updated);
                                                                        setShowTranscriptIndex(null);
                                                                    }}>
                                                                        <Text style={styles.transcriptActionButton}>🗑️ 刪除</Text>
                                                                    </TouchableOpacity>
                                                                </View>
                                                            </>
                                                        )}
                                                    </View>
                                                )}
                                                {showSummaryIndex === index && item.summary && (
                                                    <View style={styles.transcriptContainer}>
                                                        <View style={styles.bar} />

                                                        {editingSummaryIndex === index ? (
                                                            <>
                                                                <TextInput
                                                                    style={styles.transcriptTextInput}
                                                                    value={editSummary}
                                                                    onChangeText={setEditSummary}
                                                                    multiline
                                                                    autoFocus
                                                                />
                                                                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 8 }}>
                                                                    <TouchableOpacity
                                                                        onPress={async () => {
                                                                            Keyboard.dismiss();
                                                                            const updated = recordings.map((rec, i) =>
                                                                                i === index ? { ...rec, summary: editSummary } : rec
                                                                            );
                                                                            setRecordings(updated);
                                                                            await saveRecordings(updated);
                                                                            setEditingSummaryIndex(null);
                                                                        }}
                                                                    >
                                                                        <Text style={[styles.transcriptActionButton, { color: colors.primary }]}>💾 儲存</Text>
                                                                    </TouchableOpacity>

                                                                    <TouchableOpacity
                                                                        onPress={() => {
                                                                            Keyboard.dismiss();
                                                                            setEditSummary('');
                                                                            setEditingSummaryIndex(null);
                                                                        }}
                                                                    >
                                                                        <Text style={styles.transcriptActionButton}>✖️ 取消</Text>
                                                                    </TouchableOpacity>
                                                                </View>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Text style={styles.transcriptText}>{item.summary}</Text>
                                                                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                                                                    <TouchableOpacity
                                                                        onPress={() => {
                                                                            setEditSummary(item.summary || '');
                                                                            setEditingSummaryIndex(index);
                                                                        }}
                                                                    >
                                                                        <Text style={styles.transcriptActionButton}>✏️ 修改</Text>
                                                                    </TouchableOpacity>
                                                                    <TouchableOpacity
                                                                        onPress={() => {
                                                                            shareText(item.summary || '');
                                                                        }}
                                                                    >
                                                                        <Text style={styles.transcriptActionButton}>📤 轉發</Text>
                                                                    </TouchableOpacity>


                                                                    <TouchableOpacity
                                                                        onPress={async () => {
                                                                            const updated = recordings.map((rec, i) =>
                                                                                i === index ? { ...rec, summary: undefined } : rec
                                                                            );
                                                                            setRecordings(updated);
                                                                            await saveRecordings(updated);
                                                                            setShowSummaryIndex(null);
                                                                        }}
                                                                    >
                                                                        <Text style={styles.transcriptActionButton}>🗑️ 刪除</Text>
                                                                    </TouchableOpacity>
                                                                </View>
                                                            </>
                                                        )}
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

                                                                        e.target.measureInWindow((x, y, width, height) => {
                                                                            setSelectedContext({
                                                                                type: 'enhanced',
                                                                                index,
                                                                                position: { x, y: y + height },
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

                                                                        e.target.measureInWindow((x, y, width, height) => {
                                                                            setSelectedContext({
                                                                                type: 'trimmed',
                                                                                index,
                                                                                position: { x, y: y + height },
                                                                            });
                                                                        });
                                                                    }}
                                                                >
                                                                    <Text style={styles.moreIcon}>⋯</Text>
                                                                </TouchableOpacity>
                                                            </View>
                                                        )}

                                                        {/* 文字轉錄內容 */}
                                                        {typeof item.transcript === 'string' && (
                                                            <View style={styles.transcriptContainer}>
                                                                <View style={styles.bar} />
                                                                <Text style={styles.transcriptText}>
                                                                    {item.transcript}
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

export default RecorderPageVoiceClamp;