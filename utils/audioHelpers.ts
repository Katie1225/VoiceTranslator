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

export const enhanceAudioAndAddToList = async (recordings, setRecordings, item, index) => {
  try {
    const folder = item.uri.substring(0, item.uri.lastIndexOf('/') + 1);
    const smartName = getSmartName(item.name);
    const smartUri = folder + smartName;

    const inputPath = item.uri.replace('file://', '');
    const outputPath = smartUri.replace('file://', '');

    const command = `-y -i "${inputPath}" -af "highpass=f=200, lowpass=f=8000, afftdn=nf=-60, equalizer=f=1500:width_type=h:width=400:g=4,equalizer=f=3500:width_type=h:width=1000:g=3,volume=2.0" "${outputPath}"`;
    const session = await FFmpegKit.execute(command);
    const returnCode = await session.getReturnCode();

    if (returnCode.isSuccess()) {
      // 將 smart 音檔加入 recordings 陣列（不覆蓋原始檔）
      const smartItem = {
        uri: smartUri,
        name: smartName,
        isEnhanced: true,
        originalUri: item.uri,
      };

      setRecordings((prev) => [smartItem, ...prev]);
      return smartItem;
    } else {
      throw new Error('FFmpeg 處理失敗');
    }
  } catch (err) {
    Alert.alert('音質強化失敗', err.message);
    return null;
  }
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
