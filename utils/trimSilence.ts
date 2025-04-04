// trimSilence.ts 裁剪錄音中的空白部分

import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';

export const trimSilence = async (inputUri: string): Promise<string> => {
  const inputPath = inputUri.replace('file://', '');
  const trimmedPath = inputPath.replace(/\.wav$/, '_temp_trim.wav');
  const command = `-y -i "${inputPath}" -af silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.5:\
stop_periods=1:stop_threshold=-50dB:stop_silence=0.5 "${trimmedPath}"`;

  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (ReturnCode.isSuccess(returnCode)) {
    return 'file://' + trimmedPath;
  } else {
    throw new Error('裁剪空白失敗');
  }
};
