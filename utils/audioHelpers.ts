import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';

export type RecordingItem = {
  uri: string;
  name: string;
  displayName?: string;
  originalUri?: string;
  isEnhanced?: boolean;
  isTrimmed?: boolean;

  transcript?: string;
  summary?: string;
  transcriptEdited?: string;
  summaryEdited?: string;

  derivedFiles?: {
    enhanced?: RecordingItem;
    trimmed?: {
      uri: string;
      name: string;
      displayName?: string;
    };
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

  return { uri: outputPath, name: outputName, originalUri: uri, isTrimmed: true };
};




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


/*
export const transcribeAudio = async (item: RecordingItem) => {
  let raw = ''; // ✅ 提前宣告
  try {
    // 1. 剪掉靜音
    const trimmedRecording = await trimSilence(item.uri, item.name);
    console.log("✂️ trimmedRecording", trimmedRecording);


    // 2. 加速播放到 1.25x
    const spedUpUri = await speedUpAudio(trimmedRecording.uri, 1.25);
    console.log("⏩ spedUpUri", spedUpUri);


    // 3. 轉為 .wav（Whisper 用）
    const wavUri = await convertToWav(spedUpUri);
    console.log("🎵 wavUri", wavUri);


    // 4. 上傳到 Whisper API
    const formData = new FormData();
    formData.append('audio', {
      uri: wavUri,
      name: 'audio.wav',
      type: 'audio/wav',
    } as any);
    console.log("📤 formData ready");


    const response = await fetch('https://katielab.com/transcribe/', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'multipart/form-data',
      },
      body: formData,
    });


    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '轉文字失敗');

    console.log("📝 result from Whisper API", result);
    
    return { transcript: JSON.parse(raw) }; // 成功就是正常 JSON
  } catch (err) {
    // 👇 尝试從 HTML 中撈出 JSON 片段
    const match = raw.match(/\{.*"text"\s*:\s*".*"\s*\}/s); // 簡單撈出內部 JSON
    if (match) {
      try {
        return { transcript: JSON.parse(match[0]) };
      } catch (innerErr) {
        console.warn("⚠️ 抽出 JSON 後還是錯：", match[0]);
      }
    }

    // 最後仍失敗才報錯
    console.error('❌ 回應錯誤內容：', raw);
    throw new Error('無法轉換語音為文字：回傳內容格式錯誤');
  }
};
*/
export const transcribeAudio = async (
  item: RecordingItem,
  onPartial?: (text: string, index: number, total: number) => void
): Promise<{ transcript: { text: string } }> => {
  let raw = '';

  try {
    if (!item.uri || !item.name) {
      throw new Error('音檔資訊不完整（uri 或 name 為 null）');
    }

    const trimmedRecording = await trimSilence(item.uri, item.name);
    const spedUpUri = await speedUpAudio(trimmedRecording.uri, 1.25);
    const wavUri = await convertToWav(spedUpUri);

    const fileInfo = await FileSystem.getInfoAsync(wavUri);
    if (!fileInfo.exists || typeof fileInfo.size !== 'number') {
      throw new Error('轉換後的檔案不存在或無法取得大小');
    }

    const MAX_SIZE = 20 * 1024 * 1024;
    const segments = fileInfo.size > MAX_SIZE
      ? await splitAudioIntoSegments(wavUri, 30)
      : [wavUri];

    // ✅ 每段切出來後壓縮：內部函式定義
    const compressSegment = async (uri: string): Promise<string> => {
      const output = uri.replace('.wav', '_small.wav');
      const command = `-i "${uri}" -ac 1 -ar 16000 -sample_fmt s16 "${output}"`;

      const session = await FFmpegKit.execute(command);
      const returnCode = await session.getReturnCode();

      if (!ReturnCode.isSuccess(returnCode)) {
        throw new Error(`段落壓縮失敗：${uri}`);
      }

      return output;
    };

    let fullText = '';

    for (let i = 0; i < segments.length; i++) {
      const segment = await compressSegment(segments[i]); // ✅ 壓縮後再上傳

      const formData = new FormData();
      formData.append('audio', {
        uri: segment,
        name: `segment_${i}.wav`,
        type: 'audio/wav',
      } as any);

      const response = await fetch('https://katielab.com/transcribe/', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });

      raw = await response.text();

      if (!response.ok) {
        console.error(`❌ 第 ${i + 1} 段錯誤：`, raw);
        throw new Error(`第 ${i + 1} 段轉文字失敗：HTTP ${response.status}`);
      }

      let text = '';
      try {
        const parsed = JSON.parse(raw);
        text = parsed.text;
      } catch (err) {
        const match = raw.match(/\{.*"text"\s*:\s*".*"\s*\}/s);
        if (match) {
          const parsed = JSON.parse(match[0]);
          text = parsed.text;
        } else {
          throw new Error(`第 ${i + 1} 段回傳格式錯誤`);
        }
      }

      fullText += text + '\n';
      if (onPartial) {
        onPartial(text, i + 1, segments.length);
      }
    }

    return { transcript: { text: fullText.trim() } };

  } catch (err) {
    console.error('❌ transcribeAudio 全域錯誤：', err);
    throw err;
  }
};



// 切段工具
export const splitAudioIntoSegments = async (uri: string, seconds = 30): Promise<string[]> => {
  const outputPattern = `${FileSystem.cacheDirectory}segment_%03d.wav`;
  const command = `-i "${uri}" -f segment -segment_time ${seconds} -c copy "${outputPattern}"`;

  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (!ReturnCode.isSuccess(returnCode)) {
    throw new Error('切割音檔失敗');
  }

  const allFiles = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory!);

  return allFiles
    .filter(f => f.startsWith('segment_') && f.endsWith('.wav'))  // ✅ 根據 outputPattern 命名
    .map(f => `${FileSystem.cacheDirectory}${f}`);
};



export const summarizeTranscript = async (transcript: string): Promise<string> => {
  try {
    const res = await fetch('https://katielab.com/summarize/', {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: transcript, // ✅ 這裡一定要是 text，不是 content
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.summary) {
      throw new Error(data.error || '未取得摘要結果');
    }

    return data.summary;
  } catch (err) {
    console.error('❌ summarizeTranscript 錯誤:', err);
    throw err;
  }
};
