// utils/editingHelpers.ts

import { Share, Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import { summarizeModes, RecordingItem } from './audioHelpers';

export async function shareRecordingFile(
  uri: string,
  onDone?: () => void  // ✅ 可選 callback，例如關閉選單
) {
  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert("分享功能不可用", "您的設備不支持分享功能");
      return;
    }

    await Sharing.shareAsync(uri);
  } catch (err) {
    Alert.alert("分享失敗", (err as Error).message);
  }

  if (onDone) onDone();
}


export async function shareRecordingNote(
  item: RecordingItem,
  type: 'transcript' | 'summary' | 'notes',
  summaryMode: string
) {
  let text = '';
  let label = '';
  
  if (type === 'transcript') {
    text = item.transcript || '';
    label = '錄音文檔';
  } else if (type === 'summary') {
    text = item.summaries?.[summaryMode] || '';
    label = summarizeModes.find(m => m.key === summaryMode)?.label || '重點整理';
  } else if (type === 'notes') {
    text = item.notes || '';
    label = '談話筆記';
  }

  if (!text.trim()) return;

  const filename = item.displayName || item.name || '';
  const prefix = `${filename} - ${label}\n\n`;


    try {
        await Share.share({ message: prefix + text });

    } catch (err) {
        Alert.alert('分享失敗', (err as Error).message);
    }
};

