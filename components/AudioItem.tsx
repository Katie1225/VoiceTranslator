// components/AudioItem.tsx
import React from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import Slider from '@react-native-community/slider';
import { Audio } from 'expo-av';
import { RecordingItem } from '../utils/audioHelpers';
import { Alert, Keyboard } from 'react-native';
import { transcribeAudio, summarizeTranscript } from '../utils/audioHelpers';

const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
};


type Props = {
    item: RecordingItem;
    index: number;
    isCurrentPlaying: boolean;
    isPlaying: boolean;
    playbackPosition: number;
    playbackDuration: number;
    currentPlaybackRate: number;
    playingUri: string | null;
    showTranscriptIndex: number | null;
    showSummaryIndex: number | null;
    isTranscribingIndex: number | null;
    editingIndex: number | null;
    editName: string;
    colors: any;
    styles: any;

    // 操作函式
    togglePlayback: (uri: string, index: number) => void;
    setShowTranscriptIndex: (index: number | null) => void;
    setShowSummaryIndex: (index: number | null) => void;
    setEditingIndex: (index: number | null) => void;
    setEditName: (text: string) => void;
    setSpeedMenuIndex: (index: number | null) => void;
    setSpeedMenuPosition: (pos: { x: number; y: number }) => void;
    onTranscribe: () => void;
    onSummarize: () => void;
    onHide: () => void;
    canHide: boolean;
    closeAllMenus: () => void;
    setEditingTranscriptIndex: (index: number | null) => void;
    editingTranscriptIndex: number | null;
    editTranscript: string;
    setEditTranscript: (text: string) => void;

    setEditingSummaryIndex: (index: number | null) => void;
    editingSummaryIndex: number | null;
    editSummary: string;
    setEditSummary: (text: string) => void;

    shareText: (text: string) => void;
    saveRecordings: (items: RecordingItem[]) => void;
    recordings: RecordingItem[];

    selectedDerivedIndex: { type: 'enhanced' | 'trimmed'; index: number; } | null;
    setSelectedDerivedIndex: (info: any) => void;

    playRecording: (uri: string, index: number) => void;
 
    setPlaybackPosition: (value: number) => void;

    setIsTranscribingIndex: (index: number | null) => void;
    setSelectedMainIndex: (index: number | null) => void;
    setMainMenuPosition: (pos: { x: number; y: number } | null) => void;
    selectedMainIndex: number | null;
    setRecordings: React.Dispatch<React.SetStateAction<RecordingItem[]>>;
};

const AudioItem = ({
    item,
    index,
    isCurrentPlaying,
    isPlaying,
    playbackPosition,
    playbackDuration,
    currentPlaybackRate,
    playingUri,
    showTranscriptIndex,
    showSummaryIndex,
    isTranscribingIndex,
    editingIndex,
    editName,
    colors,
    styles,
    togglePlayback,
    setShowTranscriptIndex,
    setShowSummaryIndex,
    setEditingIndex,
    setEditName,
    setSpeedMenuIndex,
    setSpeedMenuPosition,
    onTranscribe,
    onSummarize,
    onHide,
    canHide,
    closeAllMenus, setEditingTranscriptIndex,
    editingTranscriptIndex,
    editTranscript,
    setEditTranscript,

    setEditingSummaryIndex,
    editingSummaryIndex,
    editSummary,
    setEditSummary,

    shareText,
    saveRecordings,
    recordings,
    setRecordings,

    selectedDerivedIndex,
    setSelectedDerivedIndex,
    playRecording,

    setIsTranscribingIndex,
    setSelectedMainIndex,
    setMainMenuPosition,
    selectedMainIndex

}: Props) => {
    const isTranscriptView = showTranscriptIndex === index;
    const isSummaryView = showSummaryIndex === index;
    const shouldHideDefaultUI = isTranscriptView || isSummaryView;
    const hasDerivedFiles =
        item.derivedFiles &&
        (item.derivedFiles.enhanced || item.derivedFiles.trimmed);

    return (
        <View key={index} style={{ position: 'relative', zIndex: selectedDerivedIndex?.index === index ? 999 : 0 }}>
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
                                    /*                        
                                    onSlidingComplete={async (value) => {
                                    if (currentSound) {
                                        await currentSound.setPositionAsync(value);
                                        setPlaybackPosition(value);
                                    }
                                }}*/

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
                        {item.isTrimmed && item.derivedFiles?.trimmed && (
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
};
export default AudioItem;