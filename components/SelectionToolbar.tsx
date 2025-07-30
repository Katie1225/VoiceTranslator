// components/SelectionToolbar.tsx
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../constants/ThemeContext';
import { useTranslation } from '../constants/i18n';

const SelectionToolbar = ({
  selectedCount,
  onDelete,
  onCancel
}: {
  selectedCount: number;
  onDelete: () => void;
  onCancel: () => void;
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
return (
  <View style={{
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    backgroundColor: colors.container,
    borderTopWidth: 2,
    borderColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 9999,
    minHeight: 93,
  }}>
    <View style={{ flex: 1, alignItems: 'flex-start' }}>
      <Text style={{ color: colors.text }}>
  {t('selectedCountMessage').replace('{{count}}', String(selectedCount))}  {/*'✅ 已選 {{count}} 項'*/}
      </Text>
    </View>
    
    <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 50 }}>
      <TouchableOpacity onPress={onDelete}>
        <Text style={{ color: 'red', fontWeight: 'bold' }}>🗑️ {t('delete')}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCancel}>
        <Text style={{ color: colors.text }}>{t('cancel')}</Text>
      </TouchableOpacity>
    </View>
  </View>
);
};

export default SelectionToolbar;
