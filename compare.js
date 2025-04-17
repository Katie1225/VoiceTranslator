import * as FileSystem from 'expo-file-system';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import { Audio } from 'expo-av';

export const trimSilence = async (uri: string, name: string) => {
  const baseName = name.replace(/\.(m4a|wav)$/, '');
  const outputName = `trim_${baseName}.m4a`;
  const outputPath = `${FileSystem.documentDirectory}${outputName}`;

  // 如果剪過就直接回傳
  const fileInfo = await FileSystem.getInfoAsync(outputPath);
  if (fileInfo.exists && fileInfo.size > 0) {
    console.log(`⚠️ 剪輯檔已存在：${outputName}`);
    return {
      uri: outputPath,
      name: outputName,
      originalUri: uri,
      isTrimmed: true,
    };
  }

  console.log(`✂️ 開始剪輯：${outputName}`);
  const command = `-i "${uri}" -af silenceremove=start_periods=1:start_silence=0.3:start_threshold=-40dB:stop_periods=-1:stop_silence=0.3:stop_threshold=-40dB -y "${outputPath}"`;
  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (!ReturnCode.isSuccess(returnCode)) {
    throw new Error('靜音剪輯失敗');
  }

  // 嘗試印出剪完的長度（可選）
  try {
    const { sound, status } = await Audio.Sound.createAsync({ uri: outputPath });
    if ('isLoaded' in status && status.isLoaded && 'durationMillis' in status) {
      const seconds = Math.round((status.durationMillis ?? 0) / 1000);
      console.log(`✅ 剪輯完成：${seconds} 秒`);
    }
    await sound.unloadAsync();
  } catch (e) {
    console.warn('⚠️ 無法取得剪輯後音檔長度', e);
  }

  return {
    uri: outputPath,
    name: outputName,
    originalUri: uri,
    isTrimmed: true,
  };
};
