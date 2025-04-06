import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';

export async function trimSilence(uri: string, name: string): Promise<{ uri: string; name: string }> {
  const baseName = name.replace(/\.(m4a|wav)$/, '');
  const outputName = `trim_${baseName}.m4a`;
  const outputPath = `${FileSystem.cacheDirectory}${outputName}`;

  const command = `-i "${uri}" -af silenceremove=start_periods=1:start_silence=0.3:start_threshold=-40dB:stop_periods=-1:stop_silence=0.3:stop_threshold=-40dB -y "${outputPath}"`;

  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (!ReturnCode.isSuccess(returnCode)) {
    throw new Error('靜音剪輯失敗');
  }

  return {
    uri: outputPath,
    name: outputName,
  };
}


export type RecordingItem = {
  uri: string;
  name: string;
  isEnhanced?: boolean;  // 標記是否為強化版本
  originalUri?: string;  // 記錄原始檔URI
};

export const isSmartFile = (name: string): boolean =>
  name.startsWith('smart_');

export const getOriginalName = (smartName: string) => smartName.replace(/^smart_/, '');

export const getSmartName = (originalName: string): string =>
  isSmartFile(originalName) ? originalName : `smart_${originalName}`;


export const enhanceAudio = async (
  inputUri: string,
  originalName: string
): Promise<{ uri: string; name: string }> => {
  const folder = inputUri.substring(0, inputUri.lastIndexOf('/') + 1);
  const newName = getSmartName(originalName);
  const outputUri = `${folder}${newName}`;
  const inputPath = inputUri.replace('file://', '');
  const outputPath = outputUri.replace('file://', '');
  // 加入 RNN 降噪模型處理
 // const command = `-y -i "${inputPath}" -af "arnndn=m=rnnoise-models/rnnoise-model.onnx, highpass=f=200, lowpass=f=3000" "${outputPath}"`;
  
 const command = `-y -i "${inputPath}" -af "highpass=f=200, lowpass=f=3000, afftdn" "${outputPath}"`;
  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (ReturnCode.isSuccess(returnCode)) {
    return { uri: outputUri, name: newName };
  } else {
    throw new Error('音訊處理失敗');
  }
};
