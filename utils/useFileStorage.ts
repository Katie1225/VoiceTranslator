import { useState, useEffect } from 'react';
import * as FileSystem from 'expo-file-system';
import RNFS from 'react-native-fs';
import { Alert } from 'react-native';
import { RecordingItem, generateRecordingMetadata, } from './audioHelpers';
import { debugLog, debugWarn, debugError } from './debugLog';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from '../constants/i18n';
import { useLanguage } from '../constants/LanguageContext';

export const useFileStorage = (setRecordings: React.Dispatch<React.SetStateAction<RecordingItem[]>>,   t: (key: string, params?: Record<string, string | number>) => string = (k) => k) => {
  const [isLoading, setIsLoading] = useState(true);
const { setAppLocale } = useLanguage();
  const saveRecordings = async (items: RecordingItem[]) => {
    try {
      // 先驗證檔案是否存在
const validItems = await Promise.all(
  items.map(async item => {
    const path = item.uri.replace(/^file:\/\//, '');
    const exists = await RNFS.exists(path);

    // ✅ 這裡才重新用 spread 保證你拿的是更新過的 item，不是舊的 reference
    return exists ? { ...item } : null;
  })
);

      const filteredItems = validItems.filter(Boolean) as RecordingItem[];

      await FileSystem.writeAsStringAsync(
        `${FileSystem.documentDirectory}recordings.json`,
        JSON.stringify(filteredItems)
      );

      const backupPath = `${RNFS.ExternalDirectoryPath}/recordings_backup.json`;
      await RNFS.writeFile(backupPath, JSON.stringify(filteredItems), 'utf8');

    } catch (err) {
      debugError('儲存錄音列表失敗:', err);
    }
  };

  // 從本地檔案載入錄音列表
  const loadRecordings = async () => {

    try {
      const internalPath = `${FileSystem.documentDirectory}recordings.json`;
      const backupPath = `${RNFS.ExternalDirectoryPath}/recordings_backup.json`;

      // 1. 載入現有記錄（優先從內部儲存，次之從備份）
      let existingData: RecordingItem[] = await loadExistingRecords(internalPath, backupPath);

      const files = await RNFS.readDir(RNFS.ExternalDirectoryPath);
      debugLog('📂 實際資料夾裡的所有檔案：');
      for (const file of files) {
        debugLog('🎧', file.name);
      }

      // 2. 掃描實際音檔
      const m4aFiles = await scanAudioFiles();

      // 3. 智能合併與驗證
      const validatedRecordings = await mergeAndValidateRecords(existingData, m4aFiles,t);
      
      // ✅ 補上 durationSec 做成展開三角形
const withDuration = await Promise.all(validatedRecordings.map(async (rec) => {
  if (!rec.durationSec && rec.uri) {
    try {
      const metadata = await generateRecordingMetadata(rec.uri);
      return { ...rec, durationSec: metadata.durationSec };
    } catch (err) {
      debugWarn('⚠️ 無法取得 durationSec:', rec.uri);
    }
  }
  return rec;
}));

      // 4. 更新狀態並保存
setRecordings(withDuration);
await saveRecordings(withDuration);

await AsyncStorage.setItem('recordings', JSON.stringify(withDuration));


      debugLog('✅ 錄音列表載入完成，有效記錄數:', validatedRecordings.length);
    } catch (err) {
      debugError('🔴 載入錄音列表失敗:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 輔助函數 1：載入現有記錄
  const loadExistingRecords = async (internalPath: string, backupPath: string) => {
    try {
      // 優先嘗試讀取內部儲存
      const internalInfo = await FileSystem.getInfoAsync(internalPath);
      if (internalInfo.exists) {
        const content = await FileSystem.readAsStringAsync(internalPath);
        return JSON.parse(content);
      }

      // 次之嘗試讀取外部備份
      if (await RNFS.exists(backupPath)) {
        const backupContent = await RNFS.readFile(backupPath, 'utf8');
        debugLog('✅ 從外部備份還原 recordings.json');
        return JSON.parse(backupContent);
      }


      return [];
    } catch (error) {
      debugWarn('載入現有記錄失敗，將返回空陣列', error);
      return [];
    }
  };

  // 輔助函數 2：掃描音檔
  const scanAudioFiles = async () => {
    try {
      const audioFiles = await RNFS.readDir(RNFS.ExternalDirectoryPath);
      const m4aFiles = audioFiles.filter(file => /\.m4a$/i.test(file.name));

      debugLog('📂 掃描到的音檔:');
      m4aFiles.forEach(file => debugLog('🎧', file.name));

      return m4aFiles;
    } catch (error) {
      debugWarn('掃描音檔失敗', error);
      return [];
    }
  };

  // 輔助函數 3：智能合併與驗證
const mergeAndValidateRecords = async (
  existingData: RecordingItem[],
  m4aFiles: RNFS.ReadDirItem[],
    t: (key: string, params?: Record<string, string | number>) => string = (k) => k
) => {
  const normalizePath = (path: string) =>
    decodeURI(path.replace(/^file:\/+/, '').replace(/\/+$/, '')).toLowerCase();

  const existingRecordsMap = new Map<string, RecordingItem>();
  existingData.forEach(item => {
    existingRecordsMap.set(normalizePath(item.uri), item);
  });

  const result: RecordingItem[] = [];

  for (const file of m4aFiles) {
    try {
      const fileUri = `file://${file.path}`;
      const normalizedPath = normalizePath(fileUri);

      const old = existingRecordsMap.get(normalizedPath);
      const { date, durationSec, size } = await generateRecordingMetadata(fileUri);

      const now = new Date();
      const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;
      //const fallbackName = `錄音 ${time} ${dateStr}`;
const fallbackName = t('record', { time, date: dateStr });

      result.push({
        uri: fileUri,
        name: file.name,
        displayName: old?.displayName || fallbackName,
        displayDate: old?.displayDate || '',
        derivedFiles: old?.derivedFiles || {},
        date: old?.date || date,
        notes: old?.notes || '',
        transcript: old?.transcript || '',
        summaries: old?.summaries || {},
        isStarred: old?.isStarred || false,
        size: old?.size || size,
        durationSec: old?.durationSec || durationSec,
      });
    } catch (error) {
      debugWarn('處理新音檔失敗，已跳過:', file.name, error);
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
      // 確保只留一個斜線前綴
      const path = uri.replace(/^file:\/+/, '/');

      const exists = await RNFS.exists(path);
      if (!exists) {
        debugWarn("⚠️ 檔案不存在，略過刪除:", path);
        return;
      }

      // 改用「包含目錄」來判斷是外部資料夾
      if (path.includes('/Android/data/') || path.startsWith(RNFS.ExternalDirectoryPath)) {
        await RNFS.unlink(path);
      } else {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }

    } catch (err) {
      debugError("❌ safeDeleteFile 刪除失敗:", err);
      //Alert.alert("刪除失敗", (err as Error).message);
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

  return {
    isLoading,
    loadRecordings,
    saveRecordings,
    safeDeleteFile,
    updateRecordingAtIndex,
  };
};
