import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';

export type RecordingItem = {
  uri: string;
  name: string;
  originalUri?: string;
  isEnhanced?: boolean;
  isTrimmed?: boolean;
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

  const command = `-y -i "${inputPath}" -af "highpass=f=200, lowpass=f=3000" "${outputPath}"`;
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



