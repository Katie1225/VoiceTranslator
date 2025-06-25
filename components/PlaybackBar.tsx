import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import Slider from '@react-native-community/slider';
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';
import { RecordingItem } from '../utils/audioHelpers';

interface PlaybackBarProps {
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
                        <Text style={[styles.audioTitle, { color: colors.text, fontWeight: isVisible ? 'bold' : 'normal' }]} numberOfLines={1}>
                            {editName}
                        </Text>
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
                    <Icon
                        name={item.isStarred ? 'star' : 'star-outline'}
                        size={28}
                        color={item.isStarred ? colors.primary : '#999999'}
                    />
                </TouchableOpacity>


                {renderRightButtons ? (
                    renderRightButtons
                ) : (
                    <TouchableOpacity onPress={onMorePress} >
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
                />)}

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