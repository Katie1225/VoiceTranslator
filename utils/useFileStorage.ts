import { useState, useEffect } from 'react';
import * as FileSystem from 'expo-file-system';
import RNFS from 'react-native-fs';
import { Alert } from 'react-native';
import { RecordingItem } from './audioHelpers';
import { debugLog, debugWarn,debugError } from './debugLog';

export const useFileStorage = (setRecordings: React.Dispatch<React.SetStateAction<RecordingItem[]>>) => {
  const [isLoading, setIsLoading] = useState(true);

  const saveRecordings = async (items: RecordingItem[]) => {
    try {
      // 先驗證檔案是否存在
      const validItems = await Promise.all(
        items.map(async item => {
          const path = item.uri.replace(/^file:\/\//, '');
          const exists = await RNFS.exists(path);
          return exists ? item : null;
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
      const validatedRecordings = await mergeAndValidateRecords(existingData, m4aFiles);
  
      // 4. 更新狀態並保存
      setRecordings(validatedRecordings);
      await saveRecordings(validatedRecordings);
  
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
    m4aFiles: RNFS.ReadDirItem[]
  ) => {
    // 正規化路徑比對函數
    const normalizePath = (path: string) => 
      path.replace(/^file:\/+/i, '').toLowerCase().replace(/\/+$/, '');
  
    // 建立現有記錄的索引（使用正規化路徑）
    const existingRecordsMap = new Map<string, RecordingItem>();
    existingData.forEach(item => {
      existingRecordsMap.set(normalizePath(item.uri), item);
    });
  
    // 合併流程
    const result: RecordingItem[] = [];
  
    // 首先保留所有現有有效記錄
    for (const item of existingData) {
      try {
        const path = normalizePath(item.uri);
        if (await RNFS.exists(path)) {
          result.push(item);
        } else {
          debugWarn('移除不存在檔案的記錄:', item.uri);
        }
      } catch (error) {
        debugWarn('驗證記錄時出錯:', item.uri, error);
      }
    }
  
    // 然後添加新掃描到的未記錄檔案
    for (const file of m4aFiles) {
      try {
        const fileUri = `file://${file.path}`;
        const normalizedPath = normalizePath(fileUri);
  
        if (!existingRecordsMap.has(normalizedPath)) {
          result.push({
            uri: fileUri,
            name: file.name,
            displayName: file.name.replace(/\.m4a$/i, ''), // 移除副檔名
            derivedFiles: {},
            date: (file.mtime ? new Date(file.mtime).toISOString() : new Date().toISOString()), // 添加檔案修改時間
          });
          debugLog('➕ 新增未記錄音檔:', file.name);
        }
      } catch (error) {
        debugWarn('處理新音檔時出錯:', file.name, error);
      }
    }
  
    // 按修改時間降序排序
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
      Alert.alert("刪除失敗", (err as Error).message);
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
