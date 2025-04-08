import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';

export type RecordingItem = {
  uri: string;
  name: string;
  displayName?: string; // 顯示名稱（你要的格式）
  originalUri?: string;
  isEnhanced?: boolean;
  isTrimmed?: boolean;
  transcript?: string; 
  derivedFiles?: {
    enhanced?: RecordingItem;
    trimmed?: RecordingItem;
  };
};
// 增強音質的處理
export const enhanceAudio = async (inputUri: string, originalName: string): Promise<RecordingItem> => {
  const folder = inputUri.substring(0, inputUri.lastIndexOf('/') + 1);
  const newName = `smart_${originalName}`;
  const outputUri = `${folder}${newName}`;
  const inputPath = inputUri.replace('file://', '');
  const outputPath = outputUri.replace('file://', '');
  const command = `-i ${inputPath} ` +
  `-af "` +
  `highpass=f=100, ` +          // 高通濾波去除低頻噪音
  `lowpass=f=3000, ` +          // 低通濾波去除高頻噪音
  `equalizer=f=1000:width_type=h:width=1000:g=3, ` +  // 提升中頻
  `compand=attacks=0:points=-80/-80|-30/-15|0/-5|20/0, ` +  // 動態範圍壓縮
  `volume=2dB" ` +              // 提升總體音量
  `-ar 44100 -ac 1 -b:a 128k ${outputPath}`;

  //const command = `-y -i "${inputPath}" -af "highpass=f=200, lowpass=f=3000" "${outputPath}"`;
  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (ReturnCode.isSuccess(returnCode)) {
    return { uri: outputUri, name: newName, originalUri: inputUri, isEnhanced: true };
  } else {
    throw new Error('音訊強化處理失敗');
  }
};

// 靜音剪輯處理
export const trimSilence = async (uri: string, name: string): Promise<RecordingItem> => {
  const baseName = name.replace(/\.(m4a|wav)$/, '');
  const outputName = `trim_${baseName}.m4a`;
  const outputPath = `${FileSystem.cacheDirectory}${outputName}`;

  const command = `-i "${uri}" -af silenceremove=start_periods=1:start_silence=0.3:start_threshold=-40dB:stop_periods=-1:stop_silence=0.3:stop_threshold=-40dB -y "${outputPath}"`;
  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (!ReturnCode.isSuccess(returnCode)) {
    throw new Error('靜音剪輯失敗');
  }

  return { uri: outputPath, name: outputName, originalUri: uri, isTrimmed: true };
};



export const isSmartFile = (name: string): boolean =>
  name.startsWith('smart_');

export const getOriginalName = (smartName: string) => smartName.replace(/^smart_/, '');

export const getSmartName = (originalName: string): string =>
  isSmartFile(originalName) ? originalName : `smart_${originalName}`;




/**
 * 將 m4a 或其他格式的音檔轉為 wav 格式，回傳輸出 wav 的 uri。
 */
export const convertToWav = async (inputUri: string): Promise<string> => {
  try {
    // 取得檔名（不含副檔名）
    const fileNameWithoutExt = inputUri.split('/').pop()?.split('.').slice(0, -1).join('.') || 'converted';

    // 輸出路徑：放在 cache 資料夾下
    const outputPath = `${FileSystem.cacheDirectory}${fileNameWithoutExt}.wav`;

    // 刪除同名檔案（如果已存在）
    const existing = await FileSystem.getInfoAsync(outputPath);
    if (existing.exists) {
      await FileSystem.deleteAsync(outputPath, { idempotent: true });
    }

    // 執行轉檔指令
    const ffmpegCommand = `-i "${inputUri}" -ac 1 -ar 16000 "${outputPath}"`;
    const session = await FFmpegKit.execute(ffmpegCommand);

    const returnCode = await session.getReturnCode();

    if (ReturnCode.isSuccess(returnCode)) {
      return outputPath;
    } else {
      throw new Error(`轉換失敗，錯誤碼：${returnCode}`);
    }
  } catch (err) {
    console.error('convertToWav 錯誤：', err);
    throw err;
  }
};

export const speedUpAudio = async (
  inputUri: string,
  speed: number = 1.25
): Promise<string> => {
  const baseName = inputUri.split('/').pop()?.split('.').slice(0, -1).join('_') || 'spedup';
  const outputPath = `${FileSystem.cacheDirectory}${baseName}_x${speed}.m4a`;

  // 先刪除舊檔（如果存在）
  const existing = await FileSystem.getInfoAsync(outputPath);
  if (existing.exists) {
    await FileSystem.deleteAsync(outputPath, { idempotent: true });
  }

  const command = `-y -i "${inputUri}" -filter:a "atempo=${speed}" -vn "${outputPath}"`;
  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (ReturnCode.isSuccess(returnCode)) {
    return outputPath;
  } else {
    throw new Error('音檔加速處理失敗');
  }
};



export const transcribeAudio = async (item: RecordingItem): Promise<{
  trimmedRecording: RecordingItem;
  transcript: string;
}> => {
  try {
    // 1. 剪掉靜音
    const trimmedRecording = await trimSilence(item.uri, item.name);

    // 2. 加速播放到 1.25x
    const spedUpUri = await speedUpAudio(trimmedRecording.uri, 1.25);

    // 3. 轉為 .wav（Whisper 用）
    const wavUri = await convertToWav(spedUpUri);

    // 4. 上傳到 Whisper API
    const formData = new FormData();
    formData.append('file', {
      uri: wavUri,
      name: 'audio.wav',
      type: 'audio/wav',
    } as any);

    const response = await fetch('https://your-backend.com/api/whisper', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      body: formData,
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '轉文字失敗');

    return {
      trimmedRecording,
      transcript: result.text,
    };
  } catch (err) {
    console.error('轉文字錯誤', err);
    throw err;
  }
};

