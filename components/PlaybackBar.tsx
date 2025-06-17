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
    onRename?: (newName: string) => void;
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
    itemIndex?: number;
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
    onRename,
    onMorePress,
    onSpeedPress,
    styles,
    colors,
    showSpeedControl = true,
    renderRightButtons,
    editingState,
    itemIndex,
}) => {
    const isEditingName = editableName && editingState?.type === 'name' && editingState?.index === itemIndex;
    const [editName, setEditName] = React.useState(item.displayName || item.name);

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
                        onChangeText={setEditName}
                        onSubmitEditing={() => {
                            onRename?.(editName);
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
                        <Text style={[styles.audioTitle, { color: colors.text,  fontWeight: isVisible ? 'bold' : 'normal' }]} numberOfLines={1}>
                            {editName}
                        </Text>
                    </TouchableOpacity>
                )}

                {renderRightButtons ? (
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
            />  )}

            {/* 第三行：時間與播放速度 */}
{isVisible && (
                <View style={styles.playbackFooter}>
                    <Text style={{ color: colors.text, fontSize: 12 }}>{formatTime(playbackPosition)}</Text>
                    {showSpeedControl && (
                        <TouchableOpacity onPress={onSpeedPress}>
                            <Text style={{ color: colors.text, fontSize: 12}}>⏩ {playbackRate}x</Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}
        </View>
    );
};

export default PlaybackBar;