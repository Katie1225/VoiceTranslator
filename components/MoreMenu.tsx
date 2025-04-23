//MoreMenu.tsx
import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { RecordingItem } from '../utils/audioHelpers';

interface MoreMenuProps {
  position: { x: number; y: number };
  index: number;
  item: RecordingItem;
  styles: any;
  closeAllMenus: () => void;
  onRename: (index: number) => void;
  onDelete: (index: number) => void;
  onShare: (uri: string) => void;
  onTrimSilence: (index: number) => void;
  title?: string; 
}

const MoreMenu: React.FC<MoreMenuProps> = ({
  position,
  index,
  item,
  styles,
  closeAllMenus,
  onRename,
  onDelete,
  onShare,
  onTrimSilence,
  title
}) => {
  return (
    <View
      style={[
        styles.optionsMenu,
        {
          position: 'absolute',
          left: position.x - 120,
          top: position.y,
          zIndex: 9999,
          elevation: 10,
        },
      ]}
    >

              {/* ✂️ 靜音剪輯：只有 Voice Clamp 顯示 */}
      {title === 'Voice Clamp' && (                     // 測試檔可刪這行跟下面的結尾括號
      <TouchableOpacity
        style={styles.optionButton}
        onPress={() => {
          closeAllMenus();
          onTrimSilence(index);
        }}
      >
        <Text style={styles.optionText}>✂️ 靜音剪輯</Text>
      </TouchableOpacity>
            )}                                 

      <TouchableOpacity
        style={styles.optionButton}
        onPress={() => {
          closeAllMenus();
          onRename(index);
        }}
      >
        <Text style={styles.optionText}>✏️ 重新命名</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.optionButton}
        onPress={() => {
          closeAllMenus();
          onShare(item.uri);
        }}
      >
        <Text style={styles.optionText}>📤 分享</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.optionButton}
        onPress={() => {
          closeAllMenus();
          onDelete(index);
        }}
      >
        <Text style={styles.optionText}>🗑️ 刪除</Text>
      </TouchableOpacity>
    </View>
  );
};

export default MoreMenu;
