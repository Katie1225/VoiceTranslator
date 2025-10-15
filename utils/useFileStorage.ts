import { useState, useEffect } from 'react';
import * as FileSystem from 'expo-file-system';
import { Alert } from 'react-native';
import { RecordingItem, generateRecordingMetadata } from './audioHelpers';
import { debugLog, debugWarn, debugError } from './debugLog';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const useFileStorage = (
  setRecordings: React.Dispatch<React.SetStateAction<RecordingItem[]>>,
  t: (key: string, params?: Record<string, string | number>) => string = (k) => k
) => {
  const [isLoading, setIsLoading] = useState(true);

  // 獲取錄音儲存目錄
  const getRecordingsDirectory = async () => {
    const dir = `${FileSystem.documentDirectory}recordings/`;
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    return dir;
  };

  const saveRecordings = async (items: RecordingItem[]) => {
    try {
      // ✅ 完全移除檔案存在性檢查，直接保存所有項目
      const validItems = items.filter(item => {
        // 基本驗證：確保有必要的欄位
        return item && item.uri && (item.name || item.displayName);
      });

      debugLog('💾 準備保存項目:', {
        總數: items.length,
        有效數: validItems.length,
        文字筆記: validItems.filter(item => item.isTextRecord).length,
        音檔: validItems.filter(item => !item.isTextRecord).length
      });

      // 保存到 JSON 檔案
      await FileSystem.writeAsStringAsync(
        `${FileSystem.documentDirectory}recordings.json`,
        JSON.stringify(validItems)
      );

      debugLog('✅ 錄音列表保存成功，項目數:', validItems.length);

      // 驗證保存結果
      const savedContent = await FileSystem.readAsStringAsync(`${FileSystem.documentDirectory}recordings.json`);
      const savedData = JSON.parse(savedContent);
      debugLog('📋 實際保存的內容:', {
        保存項目數: savedData.length,
        包含文字筆記: savedData.filter((item: any) => item.isTextRecord).length
      });

    } catch (err) {
      debugError('儲存錄音列表失敗:', err);
    }
  };

  // 從本地檔案載入錄音列表
  const loadRecordings = async () => {
    try {
      const recordingsPath = `${FileSystem.documentDirectory}recordings.json`;

      // 1. 載入現有記錄
      let existingData: RecordingItem[] = [];
      try {
        const fileInfo = await FileSystem.getInfoAsync(recordingsPath);
        if (fileInfo.exists) {
          const content = await FileSystem.readAsStringAsync(recordingsPath);
          existingData = JSON.parse(content);
          debugLog('✅ 從 recordings.json 載入現有記錄:', existingData.length);
        }
      } catch (error) {
        debugWarn('載入 recordings.json 失敗', error);
      }

      // 2. 掃描錄音目錄中的實際音檔
      const recordingsDir = await getRecordingsDirectory();
      const dirContents = await FileSystem.readDirectoryAsync(recordingsDir);
      const m4aFiles = dirContents.filter(file => /\.m4a$/i.test(file));

      debugLog('📂 掃描到的音檔:', m4aFiles);
      debugLog('📝 現有記錄中的文字筆記:', existingData.filter(item => item.isTextRecord).length);

      // 3. 合併與驗證記錄
      const validatedRecordings = await mergeAndValidateRecords(existingData, m4aFiles, recordingsDir, t);

      // 4. 補上 durationSec
      const withDuration = await Promise.all(
        validatedRecordings.map(async (rec) => {
          if (!rec.durationSec && rec.uri) {
            try {
              const metadata = await generateRecordingMetadata(rec.uri);
              return { ...rec, durationSec: metadata.durationSec };
            } catch (err) {
              debugWarn('⚠️ 無法取得 durationSec:', rec.uri);
            }
          }
          return rec;
        })
      );

      // 5. 更新狀態並保存
      setRecordings(withDuration);
      await saveRecordings(withDuration);
      await AsyncStorage.setItem('recordings', JSON.stringify(withDuration));

      debugLog('✅ 錄音列表載入完成，有效記錄數:', withDuration.length);
    } catch (err) {
      debugError('🔴 載入錄音列表失敗:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 智能合併與驗證記錄
  // 在 useFileStorage.ts 中找到 mergeAndValidateRecords 函數，修改如下：

  const mergeAndValidateRecords = async (
    existingData: RecordingItem[],
    m4aFiles: string[],
    recordingsDir: string,
    t: (key: string, params?: Record<string, string | number>) => string
  ) => {
    const result: RecordingItem[] = [];

    // ✅ 首先處理現有記錄中的文字筆記
    for (const existingItem of existingData) {
      if (existingItem.isTextRecord) {
        // ✅ 文字筆記直接保留，不需要檔案驗證
        result.push(existingItem);
        debugLog('✅ 保留文字筆記:', existingItem.displayName);
      }
    }

    // ✅ 然後處理音檔
    for (const fileName of m4aFiles) {
      try {
        const fileUri = `${recordingsDir}${fileName}`;
        const fileInfo = await FileSystem.getInfoAsync(fileUri);

        if (!fileInfo.exists) continue;

        // 查找現有記錄（跳過已經處理的文字筆記）
        const existingItem = existingData.find(item =>
          !item.isTextRecord && (item.uri === fileUri || item.name === fileName)
        );

        const { date, durationSec, size } = await generateRecordingMetadata(fileUri);

        const now = new Date();
        const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;
        const fallbackName = t('record', { time, date: dateStr });

        result.push({
          uri: fileUri,
          name: fileName,
          displayName: existingItem?.displayName || fallbackName,
          displayDate: existingItem?.displayDate || '',
          derivedFiles: existingItem?.derivedFiles || {},
          date: existingItem?.date || date,
          notes: existingItem?.notes || '',
          transcript: existingItem?.transcript || '',
          summaries: existingItem?.summaries || {},
          isStarred: existingItem?.isStarred || false,
          size: existingItem?.size || size,
          durationSec: existingItem?.durationSec || durationSec,
        });
      } catch (error) {
        debugWarn('處理音檔失敗，已跳過:', fileName, error);
      }
    }

    return result.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
  };

  const safeDeleteFile = async (uri: string) => {
    try {
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        debugWarn("⚠️ 檔案不存在，略過刪除:", uri);
        return;
      }

      await FileSystem.deleteAsync(uri, { idempotent: true });
      debugLog('✅ 檔案刪除成功:', uri);
    } catch (err) {
      debugError("❌ safeDeleteFile 刪除失敗:", err);
      Alert.alert(t('deleteFailed'), (err as Error).message);
      throw err;
    }
  };

  const updateRecordingAtIndex = async (
    index: number,
    recordings: RecordingItem[],
    updates: Partial<RecordingItem>
  ) => {
    const updated = recordings.map((item, i) => (i === index ? { ...item, ...updates } : item));
    setRecordings(updated);
    await saveRecordings(updated);
  };

  // 新增：保存音檔到永久位置
  const saveAudioFile = async (sourceUri: string, fileName: string): Promise<string> => {
    try {
      const recordingsDir = await getRecordingsDirectory();
      const destinationUri = `${recordingsDir}${fileName}`;

      // 移動檔案到永久目錄
      await FileSystem.moveAsync({
        from: sourceUri,
        to: destinationUri
      });

      debugLog('✅ 音檔保存成功:', destinationUri);
      return destinationUri;
    } catch (error) {
      debugError('❌ 保存音檔失敗:', error);
      throw error;
    }
  };

  return {
    isLoading,
    loadRecordings,
    saveRecordings,
    safeDeleteFile,
    updateRecordingAtIndex,
    saveAudioFile,
    getRecordingsDirectory
  };
};