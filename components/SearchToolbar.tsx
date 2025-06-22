// components/SearchToolbar.tsx
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../constants/ThemeContext';
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';

export default function SearchToolbar({
    resultCount,
    onCancelSearch,
}: {
    resultCount: number;
    onCancelSearch: () => void;
}) {
    const { colors } = useTheme();

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
            zIndex: 9999,
            alignItems: 'center',
            minHeight: 93,
        }}>
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
            }}>
                <Text style={{ color: colors.text }}>
                    🔍 <Text style={{ fontSize: 18, fontWeight: 'bold' }}>{resultCount}</Text> 筆搜尋結果
                </Text>
    <TouchableOpacity onPress={onCancelSearch} hitSlop={10}>
                <Text style={{ color: colors.primary, fontWeight: 'bold', flexDirection: 'row', alignItems: 'center' }}>
                    <Icon
                        name="close"
                        size={28}
                        color={colors.primary}
                    />取消搜尋
                </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
