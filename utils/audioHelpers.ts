import { FFmpegKit, ReturnCode,  MediaInformationSession,FFprobeKit } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';
import Sound from 'react-native-sound';
import { nginxVersion } from '../constants/variant';
import { debugLog, debugWarn,debugError } from './debugLog';
import * as RNFS from 'react-native-fs';
import { splitTimeInSeconds } from '../components/SplitPromptModal';
import { Alert,} from 'react-native';

export type RecordingItem = {
  uri: string;
  name: string;
  displayName?: string;
  originalUri?: string;
  isEnhanced?: boolean;
  isTrimmed?: boolean;

  transcript?: string;
  summaries?: { [mode: string]: string };
  transcriptEdited?: string;
  summaryEdited?: string;
  date?: string;
  notes?: string;
  segments?: string[];
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
    debugLog(`⚠️ 剪輯檔已存在：${outputName}`);
    return {
      uri: outputPath,
      name: outputName,
      originalUri: uri,
      isTrimmed: true,
    };
  }

  debugLog(`✂️ 開始剪輯：${outputName}`);
  const command = `-i "${uri}" -af silenceremove=start_periods=1:start_silence=0.3:start_threshold=-40dB:stop_periods=-1:stop_silence=0.3:stop_threshold=-40dB -y "${outputPath}"`;
  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (!ReturnCode.isSuccess(returnCode)) {
    throw new Error('靜音剪輯失敗');
  }

  return { uri: outputPath, name: outputName, originalUri: uri, isTrimmed: true };
};

export async function getAudioDurationInSeconds(uri: string): Promise<number> {
  try {
    const session: MediaInformationSession = await FFprobeKit.getMediaInformation(uri);
    const info = await session.getMediaInformation();
    const durationStr = info?.getDuration();

    if (!durationStr) return 0;
const duration = parseFloat(String(durationStr ?? '0'));
    return isNaN(duration) ? 0 : duration;
  } catch (err) {
    debugError('❌ 取得音訊長度失敗:', err);
    return 0;
  }
}

// 累計靜音時間
export async function processTrimmedAudio(
  uri: string,
  counterRef: { count: number }
): Promise<string | null> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.size === 0) return null;

  const sizeKB = info.size / 1024;
  const duration = await getAudioDurationInSeconds(uri);

  if (sizeKB < 25 || duration < 1.5) {
    counterRef.count += 1;
    debugLog(`🛑 靜音跳過 - 檔案 ${sizeKB.toFixed(1)} KB，長度 ${duration.toFixed(2)} 秒`);
    return null;
  }

  return uri;
}

export async function speedUpAudio(uri: string, speed: number, outputName?: string) {
  const fileName = outputName
    ? `sped_up_${outputName}_x${speed}.wav`
    : `sped_up_${Date.now()}_x${speed}.wav`;

  const outputUri = `${FileSystem.cacheDirectory}${fileName}`;

  const cmd = [
    `-i "${uri}"`,
    `-filter:a "atempo=${speed}"`,
    `-ar 16000`,
    `-ac 1`,
    `-f wav`,
    `"${outputUri}"`
  ].join(' ');

  const session = await FFmpegKit.execute(cmd);
  const returnCode = await session.getReturnCode();

  if (ReturnCode.isSuccess(returnCode)) {
    return outputUri;
  } else {
    throw new Error('加速音訊失敗');
  }
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
  const command = `-i "${uri}" -f segment -segment_time ${seconds} -ar 16000 -ac 1 -c:a pcm_s16le "${outputPattern}"`;

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

export async function getAudioDuration(uri: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const sound = new Sound(uri, '', (error) => {
      if (error) {
        reject(new Error('音訊載入失敗'));
        return;
      }
      
      const duration = sound.getDuration();
      sound.release();
      resolve({ duration });
    });
  });
}

export const sendToWhisper = async (
  wavUri: string,
  lang: 'tw' | 'cn' = 'tw'
): Promise<string> => {
  try {

        let apiUrl : string;
      if (nginxVersion === 'blue') {
        apiUrl  = 'https://katielab.com/transcribe/';
      } else if (nginxVersion === 'green') {
        apiUrl  = 'https://katielab.com/v1/transcribe/';
      } else {
        throw new Error('未知的 nginxVersion');
      }

    const fileStat = await FileSystem.getInfoAsync(wavUri);
    if (!fileStat.exists) {
      throw new Error(`音檔不存在: ${wavUri}`);
    }

    const formData = new FormData();
    formData.append('audio', {
      uri: wavUri,
      name: 'audio.wav',
      type: 'audio/wav',
    } as any); // ⚠️ React Native 環境下需加 `as any` 避開 TS 檢查

    formData.append('lang', lang);
    formData.append('temperature', '0');         // ✅ 禁止自由發揮

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Whisper API 失敗: ${response.status} - ${errText}`);
    }
    const data = await response.json();
   let text = data?.text || data?.transcript || '';
       // 定義可疑語句
    const suspiciousPhrases = [
      '社群提供',
      '社區提供',
      '節目由','贊助','製作單位',
      '感謝本集',
      '請勿模仿',
      '純屬虛構',
      '主持人',
      '歡迎收聽',
      '觀眾朋友',
      '網友朋友',
      '今天的節目',
      '忽略任何字幕來源',
      '廣告','內容',
      '請不吝點贊','訂閱','欄目', '轉發', '打賞', '支持', '明鏡與點點欄目',
      '字幕by索蘭婭╰╯╯',
    ];

    // ✅ 清洗句子內容
    const sentences: string[] = text.split(/(?<=[。！？!?\n])/);
    const filtered = sentences.filter(s => !suspiciousPhrases.some(p => s.includes(p))); // 移除廣告句
    const cleaned = filtered.join('').trim(); // 合併為單段文字

    return cleaned;
  } catch (err) {
    debugError('❌ sendToWhisper 錯誤:', err);
    throw err;
  }
};

export const transcribeAudio = async (
  item: RecordingItem,
  onPartial?: (text: string, index: number, total: number) => void,
  targetLang: 'tw' | 'cn' = 'tw'
):  Promise<{
  transcript: { text: string },
  skippedSilentSegments: number,
  text: string }> => {
  if (!item.uri || !item.name) {
    throw new Error('音檔資訊不完整（uri 或 name 為 null）');
  }

  // 1. Split into segments
  const segmentUris = await splitAudioIntoSegments(item.uri, 30);
  let accumulatedText = '';
  const baseName = item.name.replace(/\.[^/.]+$/, '');
    const silentCounter = { count: 0 };

  // 2. Process each segment sequentially
  
  for (let index = 0; index < segmentUris.length; index++) {
    try {
      const segmentUri = segmentUris[index];
      
      // 2.1 Trim silence
      debugLog(`✂️ 開始剪輯第 ${index + 1} 段`);
      const trimmed = await trimSilence(segmentUri, `${baseName}_seg${index}`);
          // 2.1.1 檢查 trimmed 檔案大小
     const validTrimmedUri = await processTrimmedAudio(trimmed.uri, silentCounter);
      if (!validTrimmedUri) {
        debugLog(`🛑 第 ${index + 1} 段被視為靜音，已跳過`);
        continue;
      }
      
      // 2.2 Speed up
      debugLog(`⏩ 加速處理第 ${index + 1} 段`);
      const spedUp = await speedUpAudio(trimmed.uri, 1.5, `${baseName}_seg${index}`);
      
      // 2.3 Send to Whisper
      debugLog(`📤 上傳第 ${index + 1} 段至 Whisper`);
      const text = await sendToWhisper(spedUp, targetLang);
      
      // 2.4 Accumulate results
      if (text.trim()) {
        accumulatedText += text + '\n';
      }
      
      // 2.5 Callback with progress
      onPartial?.(accumulatedText.trim(), index + 1, segmentUris.length);
      
      // 2.6 Clean up
      await FileSystem.deleteAsync(trimmed.uri, { idempotent: true });
      await FileSystem.deleteAsync(spedUp, { idempotent: true });
      await FileSystem.deleteAsync(segmentUri, { idempotent: true });
      
      debugLog(`✅ 第 ${index + 1} 段處理完成`);
    } catch (err) {
      debugError(`❌ 第 ${index + 1} 段處理失敗：`, err);
      // Continue with next segment even if one fails
      accumulatedText += `[第 ${index + 1} 段處理失敗]\n`;
      onPartial?.(accumulatedText.trim(), index + 1, segmentUris.length);
    }
  }
  const estimatedSeconds = silentCounter.count * 30;
 //Alert.alert('靜音剪輯結果', `共略過 ${silentCounter.count} 段（約 ${estimatedSeconds} 秒靜音）`);

  return {
    transcript: { text: accumulatedText.trim() },
    skippedSilentSegments: silentCounter.count,
    text: accumulatedText.trim() 
  };
};

const basePrompt =
  '錄音文字是一段可能由多人或單人錄製, 由 OPENAI 處理聲音轉文字的逐字稿, 請參考使用者補充筆記校正逐字稿音譯選字或被插入廣告或歡迎台詞的問題, 尤其是姓名及專有名詞以使用者補充筆記為準.';

export const summarizeModes = [
  {
    key: 'summary',
    label: '重點整理',
    prompt: `${basePrompt}將這段文字整理成清楚條列式的重點摘要。`,
  },
  {
    key: 'analysis',
    label: '會議記錄',
    prompt: `${basePrompt}將這段文字整理成會議記錄, 包含參與者(如果有提及), 會議時間(使用音檔時間), 討論項目, 下一步行動(依照日期排列)。`,
  },
  {
    key: 'email',
    label: '信件撰寫',
    prompt: `${basePrompt}把這段文字整理成一封正式的商業郵件，語氣禮貌。`,
  },
  {
    key: 'news',
    label: '新聞稿',
    prompt: `${basePrompt}將這段文字改寫成新聞稿格式，具體且吸引人。`,
  },
  {
    key: 'ai_answer',
    label: 'AI給答案',
    prompt: `${basePrompt} 將這段文字整理分析內容並回答文字中的問題。`,
  },
];


// 核心摘要函式
export async function summarizeWithMode(
  transcript: string,
  modeKey: string,
  targetLang: 'tw' | 'cn' = 'tw',
    metadata?: { startTime?: string; date?: string }
) {
  const mode = summarizeModes.find(m => m.key === modeKey);
  if (!mode) throw new Error('未知的摘要模式');

  const timeStr =
  metadata?.date && metadata?.startTime
    ? `事件發生時間 ${metadata.date} ${metadata.startTime}`
    : '';

  const finalPrompt = `${mode.prompt}\n${timeStr}\n使用者的主機語言是 ${targetLang}，用此語言回覆。`;
  debugLog(finalPrompt);

  let BASE_URL: string;

  if (nginxVersion === 'blue') {
    BASE_URL = 'https://katielab.com/summarize/';
  } else if (nginxVersion === 'green') {
    BASE_URL = 'https://katielab.com/v1/summarize/';
  } else {
    throw new Error('未知的 nginxVersion');
  }

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: transcript, prompt: finalPrompt, targetLang }),
  });

  if (!res.ok) {
    throw new Error('API 回應錯誤');
  }

  const data = await res.json();
  if (!data || !data.result) {
    throw new Error('API 回傳格式錯誤');
  }

  return data.result.trim();
}

// 取得檔名時解開
export function parseDateTimeFromDisplayName(displayName: string): { startTime?: string; date?: string } {
  const timeMatch = displayName.match(/(\d{1,2}:\d{2}:\d{2})/);
  const dateMatch = displayName.match(/(\d{1,2})\/(\d{1,2})/);

  if (!timeMatch || !dateMatch) return {};

  const time = timeMatch[1];
  const [month, day] = [dateMatch[1], dateMatch[2]];
  const year = new Date().getFullYear(); // 預設當年度

  return {
    startTime: time,
    date: `${year}/${month}/${day}`
  };
}

// 存檔時封裝
export async function generateRecordingMetadata(uri: string): Promise<{
  displayName: string;
  date: string;
  durationSec: number;
}> {
  let durationSec = 0;
  let durationText = '?秒';
  let startDate = new Date();

  try {
    const { duration } = await getAudioDuration(uri);
    durationSec = Math.round(duration);
    
    try {
      const stat = await RNFS.stat(uri);
      const fileEnd = new Date(stat.mtime);
      startDate = new Date(fileEnd.getTime() - durationSec * 1000);
    } catch {
      const now = new Date();
      startDate = new Date(now.getTime() - durationSec * 1000);
    }

    const h = Math.floor(durationSec / 3600);
    const m = Math.floor((durationSec % 3600) / 60);
    const s = durationSec % 60;

    if (h > 0) durationText = `${h}小${m}分${s}秒`;
    else if (m > 0) durationText = `${m}分${s}秒`;
    else durationText = `${s}秒`;
  } catch (error) {
    debugError('獲取音檔時長失敗:', error);
  }

  const hh = startDate.getHours().toString().padStart(2, '0');
  const mm = startDate.getMinutes().toString().padStart(2, '0');
  const ss = startDate.getSeconds().toString().padStart(2, '0');

  const displayName = `[錄音] ${durationText} ${hh}:${mm}:${ss} ${startDate.getMonth() + 1}/${startDate.getDate()}`;

  return {
    displayName,
    date: startDate.toISOString(),
    durationSec,
  };
}

// 根據指定秒數進行音檔分割（用於使用者點擊後切段）
export const splitAudioByInterval = async (
  uri: string,
  seconds: number = splitTimeInSeconds
): Promise<RecordingItem[]> => {
  const folder = FileSystem.cacheDirectory!;
  const baseName = uri.split('/').pop()?.replace(/\.(m4a|wav)$/, '') || `rec_${Date.now()}`;

  const outputPattern = `${folder}split_${baseName}_%03d.wav`;

  // 清除舊的切割檔
  const existingFiles = await FileSystem.readDirectoryAsync(folder);
  await Promise.all(
    existingFiles
      .filter(f => f.startsWith(`split_${baseName}_`) && f.endsWith('.wav'))
      .map(f => FileSystem.deleteAsync(folder + f))
  );

  // 切割音檔
  debugLog(`📎 開始分割音檔，每段 ${seconds} 秒`);
  const adjustedSeconds = seconds > 1 ? seconds - 1 : seconds;
const command = `-i "${uri}" -f segment -segment_time ${adjustedSeconds} -ar 16000 -ac 1 -c:a pcm_s16le "${outputPattern}"`;

  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (!ReturnCode.isSuccess(returnCode)) {
    debugError('❌ 分割音檔失敗');
    throw new Error('音檔分段失敗');
  }

  // 讀取並整理所有段落
  const outputFiles = (await FileSystem.readDirectoryAsync(folder))
    .filter(f => f.startsWith(`split_${baseName}_`) && f.endsWith('.wav'))
    .sort((a, b) => a.localeCompare(b)); // 按照 001、002 排序

  const items: RecordingItem[] = outputFiles.map((filename, i) => {
    return {
      uri: `${folder}${filename}`,
      name: filename,
      originalUri: uri,
      isTrimmed: false,
      isEnhanced: false,
      transcript: '',
      summaries: {},
      displayName: `${baseName}_part${i + 1}`,
    };
  });

  debugLog(`✅ 共分割 ${items.length} 段`);
  return items;
};

