//MoreMenu.tsx
import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { RecordingItem } from '../utils/audioHelpers';
import { useTranslation } from '../constants/i18n';

interface MoreMenuProps {
  position: { x: number; y: number };
  index: number;
  item: RecordingItem;
  styles: any;
  closeAllMenus: () => void;
  onRename?: (index: number) => void;
  onDelete: (index: number) => void;
  onShare: (uri: string) => void;
  onTrimSilence?: (index: number) => void;
  title?: string;
  isDerived?: boolean;
  showDelete?: boolean;
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
  title,
  isDerived,
  showDelete,
}) => {
  const { t } = useTranslation();
  return (
    <View
      style={[
        styles.optionsMenu,
        {
          position: 'absolute',
          left: position.x - 150,
          top: position.y,
          zIndex: 9999,
          elevation: 10,
        },
      ]}
    >

      {/* ✂️ 靜音剪輯：只有 Voice Clamp 顯示 */}
      {title === 'Voice Clamp' && !isDerived && (                 // 測試檔可刪這行跟下面的結尾括號
        <TouchableOpacity
          style={styles.optionButton}
          onPress={() => {
            closeAllMenus();
            onTrimSilence?.(index);
          }}
        >
          <Text style={styles.optionText}>✂️ 靜音剪輯</Text>
        </TouchableOpacity>
      )}
      {!isDerived && (
        <TouchableOpacity
          style={styles.optionButton}
          onPress={() => {
            closeAllMenus();
            onRename?.(index);
          }}
        >
          <Text style={styles.optionText}>✏️ {t('rename')}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={styles.optionButton}
        onPress={() => {
          closeAllMenus();
          onShare(item.uri);
        }}
      >
        <Text style={styles.optionText}>📤 {t('share')}</Text>
      </TouchableOpacity>

{showDelete && (
  <TouchableOpacity
    style={styles.optionButton}
    onPress={() => {
      closeAllMenus();
      onDelete(index);
    }}
  >
    <Text style={styles.optionText}>🗑️ {t('delete')}</Text>
  </TouchableOpacity>
)}
    </View>
  );
};

export default MoreMenu;
