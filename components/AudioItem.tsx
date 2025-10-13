// components/AudioItem.tsx
import React from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Alert } from 'react-native';
import { APP_VARIANT } from '../constants/variant';
import { useTranslation } from '../constants/i18n';

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
const { t } = useTranslation();
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

// components/AudioItem.tsx
export const renderNoteBlock = (props: {
  type: 'transcript' | 'summary' | 'notes';
  index: number;
  value: string;
  uri?: string; 
  editingIndex: number | null;
  editingUri?: string | null;  
  editValue: string;
  onChangeEdit: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onShare: () => void;
  styles: any;
  colors: any;
  wrapperStyle?: any;
  editable?: boolean;
  renderContent?: () => React.ReactNode;
}) => {
  const {
    type,
    index,
    uri,
    value,
    editingIndex,
    editingUri,
    editValue,
    onChangeEdit,
    onSave,
    onCancel,
    onDelete,
    onShare,
    styles,
    colors,
    wrapperStyle,
    renderContent,
  } = props;

  const isEditing = editingIndex === index || editingUri === uri;
  const { t } = useTranslation();

  return (
    <View style={[{
      maxHeight: 500,
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: 12,
      overflow: 'hidden',
      marginTop: 10,
      marginBottom: 10,
      backgroundColor: colors.container
    }, wrapperStyle]}>
      <ScrollView
        style={{ paddingHorizontal: 16, paddingVertical: 12 }}
        contentContainerStyle={{ paddingBottom: 30 }}
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
        ) : props.renderContent ? (
          // ✅ 修正：直接返回 renderContent()，不包裹在 Text 中
  <Text style={{ color: colors.text, fontSize: 16, lineHeight: 24 }}>
    {/* 使用空的 Text 組件來建立繼承上下文 */}
    <Text>{""}</Text>
    {props.renderContent()}
  </Text>
        ) : (
          // ✅ 非重組顯示：純文字才用 Text 組件
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
        borderTopWidth: 0,
        padding: 10,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        backgroundColor: colors.container
      }}>
        {isEditing ? (
          <>
            <TouchableOpacity onPress={onSave}>
              <Text style={[styles.transcriptActionButton, { color: colors.text }]}>💾 {t('save')}    </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onCancel}>
              <Text style={[styles.transcriptActionButton, { color: colors.text }]}>✖️ {t('cancel')}  </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              disabled={!props.editable}
              onPress={() => onChangeEdit(value)}
              style={{ opacity: props.editable ? 1 : 0.4 }}
            >
              <Text style={[styles.transcriptActionButton, { color: colors.text }]}>✏️ {t('edit')}    </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!props.editable}
              onPress={onShare}
              style={{ opacity: props.editable ? 1 : 0.4 }} >
              <Text style={[styles.transcriptActionButton, { color: colors.text }]}>📤 {t('forward')}    </Text>
            </TouchableOpacity>
            {APP_VARIANT === 'notedebug' && (
              <TouchableOpacity
                disabled={!props.editable}
                onPress={onDelete}
                style={{ opacity: props.editable ? 1 : 0.4 }}>
                <Text style={[styles.transcriptActionButton, { color: colors.text }]}>🗑️ {t('delete')}  </Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
};
