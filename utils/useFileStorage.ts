import { useState, useEffect } from 'react';
import * as FileSystem from 'expo-file-system';
import RNFS from 'react-native-fs';
import { Alert } from 'react-native';
import { RecordingItem } from './audioHelpers';

export const useFileStorage = (setRecordings: React.Dispatch<React.SetStateAction<RecordingItem[]>>) => {
  const [isLoading, setIsLoading] = useState(true);

  const saveRecordings = async (items: RecordingItem[]) => {
    try {
      await FileSystem.writeAsStringAsync(
        `${FileSystem.documentDirectory}recordings.json`,
        JSON.stringify(items)
      );
      const backupPath = `${RNFS.ExternalDirectoryPath}/recordings_backup.json`;
      await RNFS.writeFile(backupPath, JSON.stringify(items), 'utf8');
    } catch (err) {
      console.error('儲存錄音列表失敗:', err);
    }
  };
 

  // 從本地檔案載入錄音列表
  const loadRecordings = async () => {
    try {
      const internalPath = `${FileSystem.documentDirectory}recordings.json`;
      const backupPath = `${RNFS.ExternalDirectoryPath}/recordings_backup.json`;

      let existingData: RecordingItem[] = [];

      // 嘗試讀取內部 JSON
      const internalInfo = await FileSystem.getInfoAsync(internalPath);
      if (internalInfo.exists) {
        const content = await FileSystem.readAsStringAsync(internalPath);
        existingData = JSON.parse(content);
      } else {
        // 若內部檔不存在，改讀取外部備份
        const backupExists = await RNFS.exists(backupPath);
        if (backupExists) {
        const backupContent = await RNFS.readFile(backupPath, 'utf8');
        existingData = JSON.parse(backupContent);
          console.log('✅ 從外部備份還原 recordings.json');
        }
      }

      // 掃描實體音檔
      const audioFiles = await RNFS.readDir(RNFS.ExternalDirectoryPath);
      const m4aFiles = audioFiles.filter(file =>
        /\.(m4a)$/i.test(file.name)
      );

      console.log('📂 掃描到的 .m4a 檔案：');
      m4aFiles.forEach(file => {
        console.log('🎧', file.name);
      });


      // 合併：保留原資料，補回新音檔
      const merged: RecordingItem[] = [
        ...existingData,
        ...m4aFiles
          .map(file => {
            const fileUri = `file://${file.path}`;
            const matched = existingData.find(item =>
              item.uri.replace(/^file:\/\//, '') === file.path
            );
            return matched
              ? null
              : {
                  uri: fileUri,
                  name: file.name,
                  displayName: file.name,
                  derivedFiles: {},
                };
          })
          .filter(Boolean) as RecordingItem[]
      ];

      setRecordings(merged);
      await saveRecordings(merged); // 寫回最新 JSON 與備份
    } catch (err) {
      console.error('🔴 載入錄音列表失敗:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const safeDeleteFile = async (uri: string) => {
    try {
      // 確保只留一個斜線前綴
      const path = uri.replace(/^file:\/+/, '/');

      const exists = await RNFS.exists(path);
      if (!exists) {
        console.warn("⚠️ 檔案不存在，略過刪除:", path);
        return;
      }

      // 改用「包含目錄」來判斷是外部資料夾
        if (path.includes('/Android/data/') || path.startsWith(RNFS.ExternalDirectoryPath)) {
          await RNFS.unlink(path);
        } else {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        }

    } catch (err) {
      console.error("❌ safeDeleteFile 刪除失敗:", err);
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
