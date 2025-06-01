// SplitPromptModal.tsx

import React from 'react';
import { Modal, View, Text, Button } from 'react-native';
import { debugValue } from '../constants/variant'

export const splitTimeInSeconds = debugValue === '1' ? 60 : 1800;

type SplitPromptModalProps = {
    visible: boolean;
    onSplit: () => void;
    onFull: () => void;
    onCancel: () => void;
};

export default function SplitPromptModal({
    visible,
    onSplit,
    onFull,
    onCancel
}: SplitPromptModalProps) {
    return (
        <Modal visible={visible} transparent animationType="fade">
            <View style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'center', alignItems: 'center' }}>
                <View style={{ backgroundColor: '#fff', padding: 20, borderRadius: 10, width: '85%' }}>
                    <Text style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 10 }}>
                        這段錄音超過 {Math.round(splitTimeInSeconds / 60)} 分鐘，如何處理？
                    </Text>
                    <Text style={{ marginBottom: 10 }}>
                        ✅ 分段處理（每段 {Math.round(splitTimeInSeconds / 60)} 分鐘） - 處理更快但可能切斷語意
                    </Text>
                    <Text style={{ marginBottom: 20 }}>
                        📄 完整處理 - 保留完整語境但較慢且費用高
                    </Text>
                    <Button title="✅ 分段處理" onPress={onSplit} />
                    <Button title="📄 完整處理" onPress={onFull} />
                    <Button title="取消" onPress={onCancel} color="gray" />
                </View>
            </View>
        </Modal>
    );
}
