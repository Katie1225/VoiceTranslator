// components/AudioUIHelpers.tsx
import React from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { APP_VARIANT } from '../constants/variant';
import { lightTheme, darkTheme, additionalColors } from '../constants/Colors';
import { createStyles } from '../constants/audioStyles';
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
    styles: any,
    isEditingName?: boolean,  // 新增參數，表示是否正在編輯檔名
    onNamePress?: () => void  // 新增參數，點擊檔名時的處理函數
) => {
    const isPlayingThis = playingUri === uri;
    const label = iconPrefix ? `${iconPrefix} ${name}` : name;

    return (
        <TouchableOpacity
            style={[isDerived ? styles.derivedFileItem : styles.nameContainer, { flex: 1 }]}
            onPress={() => {
                if (isEditingName) return;  // 正在編輯時不處理點擊事件
                closeAllMenus();
                playRecording(uri, index);
            }}
            activeOpacity={isEditingName ? 1 : 0.8}  // 正在編輯時取消按鈕效果
        >
            {isEditingName ? (
                <TextInput
                    value={name}
                    onChangeText={(text) => {
                        // 這裡應該有處理文字變更的邏輯
                    }}
                    autoFocus
                    style={[
                        isDerived ? styles.derivedFileName : styles.recordingName,
                        isPlayingThis && styles.playingText,
                        { borderBottomWidth: 1, borderColor: 'gray' }
                    ]}
                    onFocus={() => {
                        if (onNamePress) onNamePress();
                    }}
                    onBlur={() => {
                        // 這裡應該有處理編輯完成的邏輯
                    }}
                    onSubmitEditing={() => {
                        // 這裡應該有處理提交的邏輯
                    }}
                />
            ) : (
                <Text
                    style={[
                        isDerived ? styles.derivedFileName : styles.recordingName,
                        isPlayingThis && styles.playingText,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    onPress={onNamePress}  // 新增點擊處理
                >
                    {label}
                </Text>
            )}
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
    styles: any,
    selectedContext: { type: 'main' | 'enhanced' | 'trimmed'; index: number } | null
) => (
    <TouchableOpacity
        style={style}
        onPress={(e) => {
            e.stopPropagation();

            if (selectedContext?.index === index && selectedContext?.type === type) {
                // ✅ 如果點到同一個，就關掉
                setSelectedContext(null);
            } else {
                // ✅ 點到新的，就開啟
                closeAllMenus();
                e.target.measureInWindow((x, y, width, height) => {
                    setSelectedContext({
                        type,
                        index,
                        position: { x, y: y + height },
                    });
                });
            }
        }}
    >
        <Text style={styles.moreIcon}>⋯</Text>
    </TouchableOpacity>
);

export const renderNoteBlock = (props: {
    type: 'transcript' | 'summary' | 'notes';
    index: number;
    value: string;
    editingIndex: number | null;
    editValue: string;
    onChangeEdit: (text: string) => void;
    onSave: () => void;
    onCancel: () => void;
    onDelete: () => void;
    onShare: () => void;
    styles: any;
    colors: any;
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
        onShare,
        styles,
        colors,
    } = props;

    const isEditing = editingIndex === index;

return (
  <View style={{
    maxHeight: 300,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 10,
    backgroundColor: colors.container
  }}>
    <ScrollView
      style={{ padding: 12 }}
      contentContainerStyle={{ paddingBottom: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      {isEditing ? (
        <TextInput
          value={editValue}
          onChangeText={onChangeEdit}
          multiline
          scrollEnabled={true}
          style={{
            minHeight: 100,
            fontSize: 16,
            color: colors.text,
            textAlignVertical: 'top',
          }}
          autoFocus
        />
      ) : (
        <Text
          style={{
            fontSize: 16,
            color: colors.text,
            lineHeight: 24,
          }}
          selectable
          selectionColor={colors.primary}
        >
          {value}
        </Text>
      )}
    </ScrollView>

    {/* 固定底部按鈕區 */}
    <View style={{
      borderTopWidth: 1,
      borderColor: colors.primary,
      padding: 10,
      flexDirection: 'row',
      justifyContent: isEditing ? 'flex-end' : 'space-between',
      backgroundColor: colors.container
    }}>
      {isEditing ? (
        <>
          <TouchableOpacity onPress={onSave}>
            <Text style={styles.transcriptActionButton}>💾 儲存</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.transcriptActionButton}>✖️ 取消</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TouchableOpacity onPress={() => onChangeEdit(value)}>
            <Text style={styles.transcriptActionButton}>✏️ 修改</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onShare}>
            <Text style={styles.transcriptActionButton}>📤 轉發</Text>
          </TouchableOpacity>
          {APP_VARIANT === 'notedebug' && (
            <TouchableOpacity onPress={onDelete}>
              <Text style={styles.transcriptActionButton}>🗑️ 刪除</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  </View>
);

};
