import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import Slider from '@react-native-community/slider';
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';
import {
    RecordingItem, transcribeAudio, summarizeWithMode, summarizeModes, notifyAwsRecordingEvent,
    notitifyWhisperEvent, splitAudioSegments,
    parseDateTimeFromDisplayName, generateDisplayNameParts, generateRecordingMetadata,
} from '../utils/audioHelpers';


interface PlaybackBarProps {
    //  item: RecordingItem;
    item: RecordingItem;
    isPlaying: boolean;
    isVisible: boolean;
    playbackPosition: number;
    playbackDuration: number;
    playbackRate: number;
    editableName?: boolean;
    onPlayPause: () => void;
    onSeek: (positionMs: number) => void;
    onEditRename?: (newName: string) => void;
    onMorePress: (e: any) => void;
    onSpeedPress: (e: any) => void;
    styles: any;
    colors: any;
    showSpeedControl?: boolean;
    renderRightButtons?: React.ReactNode;
    editingState?: {
        type: 'name' | 'transcript' | 'summary' | 'notes' | null;
        index: number | null;
        text: string;
    };
    setEditingState?: React.Dispatch<React.SetStateAction<{
        type: 'transcript' | 'summary' | 'name' | 'notes' | null;
        index: number | null;
        text: string;
        mode?: string;
    }>>;
    itemIndex?: number;
    setRecordings: React.Dispatch<React.SetStateAction<RecordingItem[]>>;
    saveRecordings: (items: RecordingItem[]) => void;
    variant?: 'main' | 'sub';
}

function isRecordingItem(item: RecordingItem): item is RecordingItem {
    return 'isStarred' in item || 'displayDate' in item;
}


const PlaybackBar: React.FC<PlaybackBarProps> = ({
    item,
    isPlaying,
    isVisible,
    playbackPosition,
    playbackDuration,
    playbackRate,
    editableName = false,
    onPlayPause,
    onSeek,
    onEditRename,
    onMorePress,
    onSpeedPress,
    styles,
    colors,
    showSpeedControl = true,
    renderRightButtons,
    editingState,
    setEditingState,
    itemIndex,
    setRecordings,
    saveRecordings,
    variant = 'main',

}) => {
    const isEditingName = editableName && editingState?.type === 'name' && editingState?.index === itemIndex;
    const [editName, setEditName] = React.useState(item.displayName || '');

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    React.useEffect(() => {
        setEditName(item.displayName || '');
    }, [item.displayName]);

    return (
        <View
            style={[
                styles.playbackContainer,
                !isVisible && { paddingBottom: 0, marginBottom: 0 }, // ✅ 播放條隱藏時，移除底部空白
            ]}
        >
            {/* 第一行：播放鍵 + 檔名 + 三點選單 */}
            <View style={styles.playbackHeader}>
                <TouchableOpacity onPress={onPlayPause}>
                    <Icon
                        name={isPlaying ? 'pause-circle' : 'play-circle'}
                        size={34}
                        color={colors.primary}
                    />
                </TouchableOpacity>

                {isEditingName ? (
                    <TextInput
                        value={editName}
                        onChangeText={(text) => {
                            setEditName(text);
                            if (setEditingState) {
                                setEditingState((prev) => ({
                                    ...prev,
                                    text, // ✅ 關鍵：把最新輸入的文字存進 editingState.text
                                }));
                            }
                        }}
                        onBlur={() => {
                            onEditRename?.(editName);  // ✅ 使用者離開時也儲存一次
                        }}

                        style={[
                            styles.audioTitleInput,
                            { color: colors.text, borderColor: colors.primary }
                        ]}
                        autoFocus
                    />
                ) : (
                    <TouchableOpacity
                        style={{ flex: 1 }}
                        onPress={() => {
                            if (!isEditingName) onPlayPause(); // ✅ 不是編輯模式就撥放
                        }}
                        activeOpacity={editableName ? 0.7 : 1}
                    >
                        <View style={{ flex: 1, minHeight: 60 }}>
                            <Text
                                style={[styles.audioTitle, {
                                    fontSize: variant === 'sub' ? 13 : 16,
                                    fontWeight: isPlaying ? 'bold' : 'normal',
                                    color: colors.text,
                                },]}
                                numberOfLines={2}
                            >
                                {(editName || '').split('\n')[0]}
                            </Text>
                            {isRecordingItem(item) && item.displayDate && (
                                <Text
                                    style={[styles.audioSubtitle, { color: colors.subtext, fontSize: 13 }]}
                                    numberOfLines={1}
                                >
                                    {item.displayDate}
                                </Text>
                            )}
                        </View>
                    </TouchableOpacity>
                )}

                <TouchableOpacity
                    onPress={() => {
                        setRecordings(prev => {
                            const updated = prev.map(r =>
                                r.uri === item.uri ? { ...r, isStarred: !r.isStarred } : r
                            );
                            saveRecordings(updated);
                            return updated;
                        });
                    }}

                    style={{ marginRight: 10, top: -15 }}
                >
                    {isRecordingItem(item) && (
                        <TouchableOpacity
                            onPress={() => {
                                setRecordings(prev => {
                                    const updated = prev.map(r =>
                                        r.uri === item.uri ? { ...r, isStarred: !r.isStarred } : r
                                    );
                                    saveRecordings(updated);
                                    return updated;
                                });
                            }}
                            style={{ marginRight: 10, top: -15 }}
                        >
                            <Icon
                                name={item.isStarred ? 'star' : 'star-outline'}
                                size={28}
                                color={item.isStarred ? colors.primary : '#999999'}
                            />
                        </TouchableOpacity>
                    )}
                </TouchableOpacity>

                {typeof renderRightButtons === 'string' ? (
                    <Text>{renderRightButtons}</Text>
                ) : renderRightButtons ? (
                    renderRightButtons
                ) : (
                    <TouchableOpacity onPress={onMorePress}>
                        <Icon name="dots-vertical" size={20} color={colors.text} />
                    </TouchableOpacity>
                )}
            </View>

            {/* 第二行：進度條 */}
            {isVisible && (
                <Slider
                    minimumValue={0}
                    maximumValue={playbackDuration}
                    value={playbackPosition}
                    onSlidingComplete={onSeek}
                    style={styles.playbackSlider}
                    minimumTrackTintColor={colors.primary}
                    maximumTrackTintColor={colors.subtext}
                    thumbTintColor={colors.primary}
                />
            )}

            {/* 第三行：時間與播放速度 */}
            {isVisible && (
                <View style={styles.playbackFooter}>
                    <Text style={{ color: colors.text, fontSize: 12 }}>{formatTime(playbackPosition)}</Text>
                    {showSpeedControl && (
                        <TouchableOpacity onPress={onSpeedPress}>
                            <Text style={{ color: colors.text, fontSize: 12 }}>⏩ {playbackRate}x</Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}
        </View>
    );
};

export default PlaybackBar;