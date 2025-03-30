import axios from 'axios';
import * as FileSystem from 'expo-file-system';

export const transcribeAudio = async (uri) => {
  try {
    // 檢查文件是否存在
    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (!fileInfo.exists) {
      throw new Error('錄音文件不存在');
    }

    // 準備FormData
    const formData = new FormData();
    formData.append('audio', {
      uri,
      name: 'recording.wav',
      type: 'audio/wav'
    });

    // 調用API
    const response = await axios.post('http://your-api-url/transcribe', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'Authorization': 'Bearer your-api-key',
      },
    });

    if (response.data && response.data.text) {
      return response.data.text;
    }
    throw new Error('無效的API響應格式');
  } catch (err) {
    let errorMsg = '轉換失敗: ';
    if (err.response) {
      errorMsg += `狀態碼: ${err.response.status}`;
      if (err.response.data) {
        errorMsg += `, 錯誤詳情: ${JSON.stringify(err.response.data)}`;
      }
    } else {
      errorMsg += err.message;
    }
    throw new Error(errorMsg);
  }
};