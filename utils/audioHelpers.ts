import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';

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
    const spedUpUri = await speedUpAudio(trimmedRecording.uri, 1.5);
    const wavUri = await convertToWav(spedUpUri);

    const fileInfo = await FileSystem.getInfoAsync(wavUri);
    if (!fileInfo.exists || typeof fileInfo.size !== 'number') {
      throw new Error('轉換後的檔案不存在或無法取得大小');
    }

    // 🧠 定義可疑語句
    const suspiciousPhrases = [
      '社群提供',
      '節目由',
      '贊助',
      '製作單位',
      '感謝本集',
      '請勿模仿',
      '純屬虛構',
      '主持人',
      '歡迎收聽',
      '觀眾朋友',
      '網友朋友',
      '今天的節目',
      '忽略任何字幕來源',
      '廣告內容',
      '請不吝點贊訂閱欄目'
    ];

    const isSuspicious = (text: string) => {
      return suspiciousPhrases.some(phrase => text.includes(phrase));
    };

    const segments = await splitAudioIntoSegments(wavUri, 30);  // 這裡改時間

    // ✅ 每段切出來後壓縮：內部函式定義
    const compressSegment = async (uri: string): Promise<string> => {
      const output = uri.replace('.wav', '_small.wav');
      const command = `-y -i "${uri}" -ac 1 -ar 16000 -sample_fmt s16 "${output}"`;

      const session = await FFmpegKit.execute(command);
      const returnCode = await session.getReturnCode();

      if (!ReturnCode.isSuccess(returnCode)) {
        throw new Error(`段落壓縮失敗：${uri}`);
      }

      return output;
    };

    let accumulated = '';

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // 檢查分段時長（需實作 getAudioDuration）
      const { duration } = await getAudioDuration(segment);
      console.log(`⏱️ 第 ${i + 1} 段時長: ${duration.toFixed(2)}秒`);

      if (duration < 1) {
        console.log(`⏭️ 跳過過短分段 (${duration}s)`);
        continue; // 跳過此段
      }

      console.log(`📤 上傳第 ${i + 1} 段`);

      const compressed = await compressSegment(segment);

      const formData = new FormData();
      formData.append('audio', {
        uri: compressed,
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

      const raw = await response.text();

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

      const originalText = text;
      const sentences = text.split(/(?<=[。！？!?\n])/); // 切句子
      const filteredSentences: string[] = [];

      for (const sentence of sentences) {
        const isSuspect = suspiciousPhrases.some((phrase) => sentence.includes(phrase));
        if (isSuspect) {
          console.warn(`🚫 移除可疑句：「${sentence.trim()}」`);
        } else {
          filteredSentences.push(sentence);
        }
      }

      text = filteredSentences.join('').trim(); // 保留乾淨的句子


      // ⛔️ 若最後一段是空字串就直接略過，這會導致你 UI 不更新
      // ✅ 改用累積方式，保證顯示最新內容
      accumulated += text ? text + '\n' : '';
      // ✅ 每段完成都即時更新 UI
      onPartial?.(accumulated.trim(), i + 1, segments.length);
      console.log(`🟢 傳出第 ${i + 1} 段 transcript`, accumulated.trim());

/*
      if (onPartial) {
        // 傳回的是累積內容，不是單段文字
        onPartial(accumulated.trim(), i + 1, segments.length);
      }

      */
    }

    return { transcript: { text: accumulated.trim() } };

  } catch (err) {
    console.error('❌ transcribeAudio 全域錯誤：', err);
    throw err;
  }
};

export async function getAudioDuration(uri: string): Promise<{ duration: number }> {
  const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });

  if (!status.isLoaded) {
    throw new Error('音訊載入失敗');
  }

  const duration = status.durationMillis != null ? status.durationMillis / 1000 : 0;
  await sound.unloadAsync(); // ✅ 記得釋放資源

  return { duration };
}

// 切段工具
export const splitAudioIntoSegments = async (
  uri: string,
  seconds = 30
): Promise<string[]> => {
  const outputPattern = `${FileSystem.cacheDirectory}segment_%03d.wav`;

  // 清理舊檔案（排除壓縮過的）
  const allFilesBefore = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory!);
  await Promise.all(
    allFilesBefore
      .filter(f => f.startsWith('segment_') && f.endsWith('.wav') && !f.includes('_small'))
      .map(f => FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${f}`))
  );

  // 強制關鍵幀切割
  const command = `-i "${uri}" -f segment -segment_time ${seconds} -force_key_frames "expr:gte(n, n_forced*${seconds})" -c copy "${outputPattern}"`;

  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (!ReturnCode.isSuccess(returnCode)) {
    throw new Error('切割音檔失敗');
  }

  // 讀取並排序分段檔案
  const allFiles = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory!);
  return allFiles
    .filter(f => f.startsWith('segment_') && f.endsWith('.wav') && !f.includes('_small'))
    .sort((a, b) => a.localeCompare(b)) // 確保順序正確
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
