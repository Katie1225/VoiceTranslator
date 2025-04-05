import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';

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

export const findMatchingSmartUri = (
  originalName: string,
  recordings: { uri: string; name: string }[]
): string | null => {
  const smartName = getSmartName(originalName);
  const match = recordings.find((r) => r.name === smartName);
  return match ? match.uri : null;
};

export const findMatchingOriginalUri = (
  smartName: string,
  recordings: { uri: string; name: string }[]
): string | null => {
  const originalName = getOriginalName(smartName);
  const match = recordings.find((r) => r.name === originalName);
  return match ? match.uri : null;
};



export const enhanceAudio = async (
  inputUri: string,
  originalName: string
): Promise<{ uri: string; name: string }> => {
  const folder = inputUri.substring(0, inputUri.lastIndexOf('/') + 1);
  const newName = getSmartName(originalName);
  const outputUri = `${folder}${newName}`;
  const inputPath = inputUri.replace('file://', '');
  const outputPath = outputUri.replace('file://', '');

  const command = `-y -i "${inputPath}" -af "highpass=f=200, lowpass=f=3000, afftdn" "${outputPath}"`;
  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (ReturnCode.isSuccess(returnCode)) {
    return { uri: outputUri, name: newName };
  } else {
    throw new Error('音訊處理失敗');
  }
};
