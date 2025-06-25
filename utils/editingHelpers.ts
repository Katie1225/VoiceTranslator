// utils/editingHelpers.ts

import { Share, Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import { summarizeModes, RecordingItem } from './audioHelpers';

// 編輯文字
export function prepareEditing(
  recordings: RecordingItem[],
  index: number,
  type: 'name' | 'transcript' | 'summary' | 'notes',
  summaryMode: string
): { type: typeof type; index: number; text: string } {
  const item = recordings[index];

  const text =
    type === 'name'
      ? item.displayName || ''
      : type === 'transcript'
        ? item.transcript || ''
        : type === 'summary'
          ? item.summaries?.[summaryMode] || ''
          : item.notes || '';

  return { type, index, text };
}

// 刪除文字
export function deleteTextRecording(
  recordings: RecordingItem[],
  index: number,
  type: 'transcript' | 'summary' | 'notes',
  summaryMode: string
): RecordingItem[] {
  return recordings.map((rec, i) => {
    if (i !== index) return rec;

    if (type === 'transcript') {
      return { ...rec, transcript: '' };
    }

    if (type === 'notes') {
      return { ...rec, notes: '' };
    }

    if (type === 'summary') {
      const updatedSummaries = { ...(rec.summaries || {}) };
      delete updatedSummaries[summaryMode];
      return { ...rec, summaries: updatedSummaries };
    }

    return rec;
  });
}


// 儲存修改文字
export function saveEditedRecording(
  recordings: RecordingItem[],
  editingState: {
    type: 'transcript' | 'summary' | 'name' | 'notes' | null;
    index: number | null;
    text: string;
  },
  summaryMode: string
): RecordingItem[] {
  const { type, index, text } = editingState;

  if (index === null || !text.trim() || type === null) return recordings;

  return recordings.map((rec, i) => {
    if (i !== index) return rec;

    switch (type) {
      case 'name':
        return { ...rec, displayName: text };
      case 'transcript':
        return { ...rec, transcript: text };
      case 'summary':
        return {
          ...rec,
          summaries: {
            ...(rec.summaries || {}),
            [summaryMode]: text,
          },
        };
      case 'notes':
        return { ...rec, notes: text };
      default:
        return rec;
    }
  });
}

// 分享音檔
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

// 分享文字
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

  const filename = item.displayName || '';
  const prefix = `${filename} - ${label}\n\n`;


    try {
        await Share.share({ message: prefix + text });

    } catch (err) {
        Alert.alert('分享失敗', (err as Error).message);
    }
};

