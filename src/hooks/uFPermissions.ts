import { useState, useEffect } from 'react';
import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';

export type PermissionStatus = 'checking' | 'granted' | 'denied';

export const uFPermissions = () => {
  const [status, setStatus] = useState<PermissionStatus>('checking');

  const requestPermissions = async (silent = false): Promise<boolean> => {
    try {
      const requiredPermissions = [
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ...(Number(Platform.Version) < 30
          ? [PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE]
          : []),
        ...(Number(Platform.Version) >= 34
          ? ['android.permission.FOREGROUND_SERVICE_MICROPHONE' as any]
          : []),
        ...(Number(Platform.Version) >= 33
          ? [PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO]
          : [PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE]),
      ];

      const results = await PermissionsAndroid.requestMultiple(requiredPermissions);
      const granted = results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;

      if (!granted && !silent) {
        Alert.alert('權限不足', '需要麥克風和儲存權限才能錄音', [
          { text: '取消', style: 'cancel' },
          { text: '前往設定', onPress: () => Linking.openSettings() }
        ]);
      }

      setStatus(granted ? 'granted' : 'denied');
      return granted;
    } catch (err) {
      console.error('權限請求錯誤:', err);
      if (!silent) Alert.alert('錯誤', '檢查權限時發生錯誤');
      setStatus('denied');
      return false;
    }
  };

  useEffect(() => {
    requestPermissions(true); // 初始化時靜默檢查
  }, []);

  return { permissionStatus: status, requestPermissions };
};
