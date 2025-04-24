// components/AudioUIHelpers.tsx
import React from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { lightTheme, darkTheme, additionalColors } from '../constants/Colors';
import { createStyles } from '../styles/audioStyles';
import { RecordingItem } from '../utils/audioHelpers';

// 音檔檔名顯示
export const renderFilename = (
    uri: string,
    name: string,
    index: number,
    isDerived: boolean,
    iconPrefix: string | undefined,
    isPlaying: boolean,
    playingUri: string,
    playRecording: (uri: string, index: number) => void,
    closeAllMenus: () => void,
    styles: any
) => {
    const isPlayingThis = playingUri === uri;
    const label = iconPrefix ? `${iconPrefix} ${name}` : name;

    return (
        <TouchableOpacity
            style={[isDerived ? styles.derivedFileItem : styles.nameContainer, { flex: 1 }]}
            onPress={() => {
                closeAllMenus();
                playRecording(uri, index);
            }}
        >
            <Text
                style={[
                    isDerived ? styles.derivedFileName : styles.recordingName,
                    isPlayingThis && styles.playingText,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
            >
                {label}
            </Text>
        </TouchableOpacity>
    );
};


// 三點選單顯示
export const renderMoreButton = (
    index: number,
    type: 'main' | 'enhanced' | 'trimmed',
    style: any,
    setSelectedContext: Function,
    closeAllMenus: () => void,
    styles: any
) => (
    <TouchableOpacity
        style={style}
        onPress={(e) => {
            e.stopPropagation();
            closeAllMenus();
            e.target.measureInWindow((x, y, width, height) => {
                setSelectedContext({
                    type,
                    index,
                    position: { x, y: y + height },
                });
            });
        }}
    >
        <Text style={styles.moreIcon}>⋯</Text>
    </TouchableOpacity>
);


export const renderNoteBlock = (props: {
    type: 'transcript' | 'summary';
    index: number;
    value: string;
    editingIndex: number | null;
    editValue: string;
    onChangeEdit: (text: string) => void;
    onSave: () => void;
    onCancel: () => void;
    onDelete: () => void;
    styles: any;
    colors: any;
    shareText: (text: string) => void;
}) => {
    const {
        type,
        index,
        value,
        editingIndex,
        editValue,
        onChangeEdit,
        onSave,
        onCancel,
        onDelete,
        styles,
        colors,
        shareText,
    } = props;

    const isEditing = editingIndex === index;

    return (
        <View style={styles.transcriptContainer}>
            <View style={styles.bar} />

            {isEditing ? (
                <>
                    <TextInput
                        style={styles.transcriptTextInput}
                        value={editValue}
                        onChangeText={onChangeEdit}
                        multiline
                        autoFocus
                    />
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 8 }}>
                        <TouchableOpacity onPress={onSave}>
                            <Text style={[styles.transcriptActionButton, { color: colors.primary }]}>💾 儲存</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={onCancel}>
                            <Text style={styles.transcriptActionButton}>✖️ 取消</Text>
                        </TouchableOpacity>
                    </View>
                </>
            ) : (
                <>
                    <Text style={styles.transcriptText}>{value}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                        <TouchableOpacity onPress={() => onChangeEdit(value)}>
                            <Text style={styles.transcriptActionButton}>✏️ 修改</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => shareText(value)}>
                            <Text style={styles.transcriptActionButton}>📤 轉發</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={onDelete}>
                            <Text style={styles.transcriptActionButton}>🗑️ 刪除</Text>
                        </TouchableOpacity>
                    </View>
                </>
            )}
        </View>
    );
};
