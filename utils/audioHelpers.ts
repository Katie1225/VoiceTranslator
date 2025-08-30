//import { FFmpegKit, ReturnCode,  MediaInformationSession,FFprobeKit } from 'ffmpeg-kit-react-native';
import { NativeModules } from 'react-native';
const { FFmpegWrapper } = NativeModules;

import * as FileSystem from 'expo-file-system';
import Sound from 'react-native-sound';
import { nginxVersion } from '../constants/variant';
import { debugLog, debugWarn, debugError } from './debugLog';
import * as RNFS from 'react-native-fs';
import { Alert, } from 'react-native';
import { useTranslation } from '../constants/i18n';


export type RecordingItem = {
  size?: number;
  uri: string;
  name: string;
  displayName?: string;
  displayDate?: string;
  originalUri?: string;
  isEnhanced?: boolean;
  isTrimmed?: boolean;
  isStarred?: boolean; // ⭐️ 
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
splitParts?: RecordingItem[];
  };
  durationSec?: number;
   start?: number;          
  end?: number;            
  createdAt?: string;       
  isSplitPart?: boolean;    
};

export const notifyAwsRecordingEvent = async (
  type: 'start' | 'stop',
  payload: {
    timestamp: number;
    userId?: string;
    fileName?: string;
  }
) => {

  try {
    const baseUrl = nginxVersion === 'green'
      ? 'https://katielab.com/v1/recording-event/'
      : 'https://katielab.com/recording-event/';

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        timestamp: payload.timestamp,
        userId: payload.userId || 'anonymous',
        fileName: payload.fileName,
      }),
    });

    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const json = await res.json();
      debugLog(`📡 AWS ${type} 回應:`, json);
      return json;
    } else {
      const text = await res.text(); // ⬅️ 改用 text 解析
      debugWarn(`❌ AWS ${type} 回傳非 JSON:`, text);
      return null;
    }
  } catch (err: any) {
    debugError(`❌ AWS ${type} 失敗:`, err?.message || String(err));
    return null;
  }
};

export const notitifyWhisperEvent = async (
  type: 'start' | 'stop',
  payload: {
    timestamp: number;
    userId?: string;
    fileName?: string;
  }
) => {
  try {
  
    const baseUrl = nginxVersion === 'green'
      ? 'https://katielab.com/v1/transcribe/welcome/'
      : 'https://katielab.com/transcribe/welcome/';

    const res = await fetch(baseUrl, {
        method: 'POST',
      })
    const json = await res.json();
    debugLog('🎧 Whisper 歡迎詞:', json.text || '(無文字內容)');
    return json;
  } catch (err: any) {
    debugError(`❌ Whisper ${type} 失敗:`, err?.message || String(err));
    return null;
  }
};


// 靜音剪輯處理
export const trimSilence = async (uri: string, name: string): Promise<RecordingItem> => {
  const baseName = name.replace(/\.(m4a|wav)$/, '');
  const outputName = `trim_${baseName}.m4a`;
  const outputPath = `${FileSystem.documentDirectory}${outputName}`;

  try {
    await FileSystem.deleteAsync(outputPath, { idempotent: true });
  } catch (err) {
    debugError('⚠️ 無法刪除舊剪輯檔：', err);
  }

  debugLog(`✂️ 開始剪輯音檔 ${name}`);

  const command = `-i "${uri}" -af silenceremove=start_periods=1:start_silence=0.3:start_threshold=-40dB:stop_periods=-1:stop_silence=0.3:stop_threshold=-40dB -y "${outputPath}"`;

  await FFmpegWrapper.run(command);
  const exists = await RNFS.exists(outputPath);
  if (!exists) debugError('靜音剪輯失敗');

  return {
    uri: outputPath,
    name: outputName,
    originalUri: uri,
    isTrimmed: true,
    size: (await RNFS.stat(outputPath)).size
  };
};

// 音檔加速
export async function speedUpAudio(uri: string, speed: number, outputName?: string) {
  const fileName = outputName
    ? `sped_up_${outputName}_x${speed}.wav`
    : `sped_up_${Date.now()}_x${speed}.wav`;

  const outputUri = `${FileSystem.cacheDirectory}${fileName}`;

  const cmd = `-i "${uri}" -filter:a "atempo=${speed}" -ar 16000 -ac 1 -f wav "${outputUri}"`;

  await FFmpegWrapper.run(cmd);
  const exists = await RNFS.exists(outputUri);
  if (!exists) debugError('加速音訊失敗');

  return outputUri;
}

export async function getAudioDurationInSeconds(uri: string): Promise<number> {
  return new Promise((resolve) => {
    const sound = new Sound(uri, '', (error) => {
      if (error) {
        debugError('❌ 無法讀取音訊:', error);
        resolve(0);
        return;
      }
      const duration = sound.getDuration();
      sound.release();
      resolve(duration);
    });
  });
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

// 切斷工具 for 自動存檔

/**
 * 從主錄音中擷取一段片段（不重新編碼）
 * 用於錄音過程中每30分鐘自動存檔
 * @param inputUri 主錄音路徑（m4a）
 * @param startSec 開始秒數
 * @param durationSec 片段長度（例如1800秒）
 * @returns 分段檔案資訊
 */
export const splitAudioSegments = async (
  inputUri: string,
  startSec: number,
  durationSec: number,
  t: (key: string, params?: Record<string, string | number>) => string = (k) => k,
  parentDisplayName?: string  // ✅ 新增參數，傳入主音檔的 displayName
): Promise<RecordingItem | null> => {
  try {
    const inputPath = inputUri.replace(/^file:\/\//, '');
    const normalizedInputPath = inputPath.startsWith('/') ? inputPath : `/${inputPath}`;

    const folder = `${RNFS.ExternalDirectoryPath}/segments/`;
    await RNFS.mkdir(folder);

    const baseName = inputPath.split('/').pop()?.replace(/\.[^/.]+$/, '') ?? `rec_${Date.now()}`;
    const outputName = `${baseName}_segment_${startSec}_${startSec + durationSec}.m4a`;
    const outputPath = `${folder}${outputName}`;

    try {
      await RNFS.unlink(outputPath);
    } catch (e) {
      debugLog('無舊檔案可刪除');
    }

    const adjustedStart = startSec === 0 ? 0.01 : startSec;
    const command = `-i "${normalizedInputPath}" -ss ${adjustedStart} -t ${durationSec} -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
    debugLog(`執行 FFmpeg 命令: ${command}`);
    await FFmpegWrapper.run(command);

    const exists = await RNFS.exists(outputPath);
    if (!exists) {
      debugError('分割檔案未建立');
    }

    const stat = await RNFS.stat(outputPath);
    if (stat.size < 1000) {
      debugWarn(`分段檔案過小（${stat.size} bytes），將自動移除`);
      await RNFS.unlink(outputPath);
      return null;
    }

    const rangeText = t('splitRange', {
      start: Math.floor(startSec / 60),
      end: Math.floor((startSec + durationSec) / 60),
    });

    return {
      uri: `file://${outputPath}`,
      name: outputName,
      start: startSec,
      end: startSec + durationSec,
      durationSec,
      displayName: parentDisplayName ? `${parentDisplayName} | ${rangeText}` : rangeText,  // ✅ 主音檔名稱連動
      createdAt: new Date().toISOString(),
      isSplitPart: true,
    };
  } catch (err) {
    debugError('分割音檔失敗:', err);
    if (err instanceof Error) {
      debugError('錯誤詳情:', {
        message: err.message,
        stack: err.stack,
        inputUri,
        startSec,
        durationSec,
      });
    }
    return null;
  }
};

// 切段工具 for whisper
export const splitAudioIntoSegments = async (
  uri: string,
  seconds = 30,
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

  await FFmpegWrapper.run(command);
  const exists = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory!);
  if (!exists.length) debugError('切割音檔失敗');

  // 讀取並排序分段檔案
  const allFiles = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory!);
  return allFiles
    .filter(f => f.startsWith('segment_') && f.endsWith('.wav') && !f.includes('_small'))
    .sort((a, b) => a.localeCompare(b)) // 確保順序正確
    .map(f => `${FileSystem.cacheDirectory}${f}`);
};

export const sendToWhisper = async (
  wavUri: string,
  lang: 'tw' | 'cn' = 'tw',
  t: (key: string, params?: Record<string, string | number>) => string = (k) => k
): Promise<string> => {
   
  try {
    let apiUrl: string;
    if (nginxVersion === 'blue') {
      apiUrl = 'https://katielab.com/transcribe/';
    } else if (nginxVersion === 'green') {
      apiUrl = 'https://katielab.com/v1/transcribe/';
    } else {
throw new Error(t('serverError'));
    }
    const fileStat = await FileSystem.getInfoAsync(wavUri);
    if (!fileStat.exists) {
      debugError(`音檔不存在: ${wavUri}`);
      return '';
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
      debugError(`Whisper API 錯誤: ${response.status} - ${errText}`);
      return '';
    }
    const data = await response.json();
    let text = data?.text || data?.transcript || '';
    // 定義可疑語句
    const suspiciousPhrases = [
      '社群提供',
      '社區提供',
      '節目由', '贊助', '製作單位',
      '感謝本集',
      '請勿模仿',
      '純屬虛構',
      '主持人',
      '歡迎收聽',
      '觀眾朋友',
      '網友朋友',
      '今天的節目',
      '忽略任何字幕來源',
      '字幕by索蘭婭',
      '廣告', '內容',
      '請不吝點贊', '訂閱', '欄目', '轉發', '打賞', '支持', '明鏡與點點欄目',
      '字幕by索蘭婭╰╯╯',
      'ご視聴ありがとうございました',
      '야, 그만하고 있을걸',
      '感謝觀看',
      '위클리, 멀리 굉장히 흔쾌히 정리 되어있는데',
      '本日もご覧いただきありがとうございます',
      '良い一日を',
      '見てくれてありがとう',
'오늘도 시청해 주셔서 감사합니다.',
'MBC 뉴스 이덕영입니다.',
    ];

    // ✅ 清洗句子內容
    const sentences: string[] = text.split(/(?<=[。！？!?\n])/);
    const filtered = sentences.filter(s => !suspiciousPhrases.some(p => s.includes(p))); // 移除廣告句
    debugLog(filtered);
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
  targetLang: 'tw' | 'cn' = 'tw',
  t: (key: string, params?: Record<string, string | number>) => string = (k) => k
): Promise<{
  transcript: { text: string },
  skippedSilentSegments: number,
  text: string
}> => {
   
  if (!item.uri || !item.displayName) {
    throw new Error('音檔資訊不完整（uri 或 name 為 null）');
  }

  // 1. Split into segments
  const segmentUris = await splitAudioIntoSegments(item.uri, 30);
  let accumulatedText = '';
  const baseName = item.displayName.replace(/\.[^/.]+$/, '');
  const silentCounter = { count: 0 };

  //onPartial?.('⏳ 開始處理音檔...', 0, 0);
onPartial?.(t('transcriptionStart'), 0, 0);

  // 2. Process each segment sequentially
  for (let index = 0; index < segmentUris.length; index++) {
    try {
      const segmentUri = segmentUris[index];
      let audioToSend = segmentUri;  // 預設使用原始段
      let trimmed: RecordingItem | null = null;
      let spedUp: string | null = null;

      try {
        // ✂️ 嘗試剪輯
        trimmed = await trimSilence(segmentUri, `${baseName}_seg${index}`);
        audioToSend = trimmed.uri;

        // ⏩ 嘗試加速
        try {
          spedUp = await speedUpAudio(trimmed.uri, 1.5, `${baseName}_seg${index}`);
          audioToSend = spedUp;
        } catch (e) {
          debugError(`⚠️ 加速失敗，使用剪輯檔`, e);
        }

      } catch (e) {
        debugError(`⚠️ 剪輯失敗，使用原始段`, e);
        audioToSend = segmentUri;
      }

      // ✅ 檢查音檔有效性（大小、靜音）
      const validAudio = await processTrimmedAudio(audioToSend, silentCounter);
      if (!validAudio) {
        debugLog(`🛑 第 ${index + 1} 段被視為無效或靜音，跳過`);
        continue;
      }

      // 📤 上傳到 Whisper
      debugLog(`📤 上傳第 ${index + 1} 段至 Whisper`);
      const text = await sendToWhisper(audioToSend, targetLang, t);

      // 累積結果
      if (text.trim()) {
        accumulatedText += text + '\n';
      }

      // 回傳進度
      if (index < segmentUris.length - 1) {
       // onPartial?.(`⏳ 處理音檔中...\n${accumulatedText.trim()}`, index + 1, segmentUris.length);
onPartial?.(`${t('transcriptionStart')}\n${accumulatedText.trim()}`, index + 1, segmentUris.length);
      } else onPartial?.(accumulatedText.trim(), index + 1, segmentUris.length);

      // 🧹 清理檔案
      if (trimmed?.uri) await FileSystem.deleteAsync(trimmed.uri, { idempotent: true });
      if (spedUp) await FileSystem.deleteAsync(spedUp, { idempotent: true });
      await FileSystem.deleteAsync(segmentUri, { idempotent: true });

      debugLog(`✅ 第 ${index + 1} 段處理完成`);


    } catch (err) {
      debugError(`❌ 第 ${index + 1} 段處理失敗：`, err);
      // Continue with next segment even if one fails
     // accumulatedText += `[第 ${index + 1} 段處理失敗]\n`;
      // onPartial?.(accumulatedText.trim(), index + 1, segmentUris.length);
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

export const getSummarizeModes = (t: (key: string) => string) => [
  { key: 'summary', label: t('summary') },
  { key: 'analysis', label: t('meetingNotes') },
  { key: 'email', label: t('emailDraft') },
  { key: 'news', label: t('pressRelease') },
  { key: 'ai_answer', label: t('aiAnswer') },
];

const basePrompt =
  '錄音文字是一段可能由多人或單人錄製, 由whisper所處理聲音轉文字的逐字稿, 參考使用者補充筆記校正逐字稿音譯選字, 尤其是姓名及專有名詞以使用者補充筆記為準. 當內容是生活類以生活方式回答, 當涉及工商領域時, 你是一位資深技術助理，使用者是專業人員, 你的回答將用於會議紀錄、內部報告與技術決策。回答需具備：1. 條列清楚 2. 有工程深度 3. 避免空泛或無效內容。 不要給廢話或像新手的解釋，要講重點，貼近實作與決策需要。';

export const summarizeModes = [
  {
    key: 'summary',
    label: '重點整理',
   // prompt: `${basePrompt}將這段文字整理成清楚條列式的重點摘要。`,
  },
  {
    key: 'analysis',
    label: '會議記錄',
  //  prompt: `${basePrompt}將這段文字整理成會議記錄, 包含參與者(如果有提及), 會議時間(使用音檔時間), 討論項目, 下一步行動(依照日期排列)。`,
  },
  {
    key: 'email',
    label: '信件撰寫',
  //  prompt: `${basePrompt}把這段文字整理成一封正式的商業郵件，語氣禮貌。`,
  },
  {
    key: 'news',
    label: '新聞稿',
 //   prompt: `${basePrompt}將這段文字改寫成新聞稿格式，具體且吸引人。`,
  },
  {
    key: 'ai_answer',
    label: 'AI給答案',
  //  prompt: `${basePrompt} 將這段文字整理分析內容並回答文字中的問題。`,
  },
];

// 1) 把一個錄音項目要用來做摘要的文字組起來：標題 + 筆記 + 逐字稿
export function composeSummaryTextFromItem(
  item: any,
  opts?: { mergeSplitParts?: boolean; withLabels?: boolean }
): string {
  const { mergeSplitParts = false, withLabels = true } = opts || {};

  const title = (item?.displayName || item?.name || '').trim();

  // 逐字稿：主檔可選擇把子段合併；子檔就用自己的 transcript
  let transcript = (item?.transcript || '').trim();
  if (
    mergeSplitParts &&
    item?.derivedFiles?.splitParts?.length
  ) {
    transcript = item.derivedFiles.splitParts
      .map((p: any) => {
        const name = (p?.displayName || p?.name || 'Segment').trim();
        const text = (p?.transcript || '').trim();
        return text ? `【${name}】\n${text}` : '';
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  const notes = (item?.notes || '').trim();

  const pieces = [
    title && (withLabels ? `標題：${title}` : title),
    notes && (withLabels ? `使用者補充筆記：\n${notes}` : notes),
    transcript && (withLabels ? `錄音文字如下：\n${transcript}` : transcript),
  ].filter(Boolean);

  return pieces.join('\n\n').trim();
}

// 2) 直接「以錄音項目」呼叫摘要（內部自動組裝字串）
export async function summarizeItemWithMode(
  item: any,
  mode: string,            // 例：'summary' | 'analysis' | ...
  t: (k: string, p?: any) => string,
  meta?: { startTime?: string; date?: string },
  opts?: { mergeSplitParts?: boolean; withLabels?: boolean }
): Promise<string> {
  const text = composeSummaryTextFromItem(item, opts);
  // 沿用你原本的 summarizeWithMode
  return await summarizeWithMode(text, mode as any, t, meta);
}

// 核心摘要函式 
export async function summarizeWithMode(
  transcript: string,
  modeKey: string,
  t: (key: string, params?: Record<string, string | number>) => string = (k) => k,
  metadata?: { startTime?: string; date?: string },
  onPartial?: (text: string, index: number, total: number) => void
): Promise<string> {

  const timeStr =
    metadata?.date && metadata?.startTime
      ? t('prompt.eventTime', { date: metadata.date, time: metadata.startTime })
      : '';

  const basePrompt = t('prompt.base');
  const template = t(`prompt.${modeKey}`); // e.g. 'prompt.summary'
  const fullPrompt = template.replace('{{base}}', basePrompt);

  const finalPrompt = [fullPrompt, timeStr, t('prompt.respondInUserLanguage')].filter(Boolean).join('\n');

  debugLog('[🧠 summaryPrompt]', finalPrompt);

  const BASE_URL = nginxVersion === 'blue'
    ? 'https://katielab.com/summarize/'
    : nginxVersion === 'green'
    ? 'https://katielab.com/v1/summarize/'
    : (() => { throw new Error(t('serverError')) })();

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: transcript, prompt: finalPrompt }),
  });

  if (!res.ok) throw debugError('API 回應錯誤');

  const data = await res.json();
  if (!data?.result) throw debugError('API 回傳格式錯誤');

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

// displayname 命名準則
export function generateDisplayNameParts(userTitle: string = '', 
  durationSec: number = 0,
  t: (key: string, params?: Record<string, string | number>) => string = (k) => k): {
  label: string;
  metadataLine: string;
} {
     const now = new Date();
  const h = Math.floor(durationSec / 3600);
  const m = Math.floor((durationSec % 3600) / 60);
  const s = durationSec % 60;

/*  const durationText =
    h > 0 ? `${h}小${m}分${s}秒` :
      m > 0 ? `${m}分${s}秒` :
        `${s}秒`; */

  let durationText = '';
  if (h > 0) {
    durationText = t('duration.hms', { h, m, s });
  } else if (m > 0) {
    durationText = t('duration.ms', { m, s });
  } else {
    durationText = t('duration.s', { s });
  }

  const time = now.toTimeString().split(' ')[0]; // "HH:MM:SS"
  const dateStr = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;

 // const label = userTitle.trim() || '錄音';
   const label = userTitle.trim() || t('record');
  const metadataLine = `${durationText} ${time} ${dateStr}`;

  return { label, metadataLine };
}
export async function getAudioDuration(uri: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const sound = new Sound(uri, '', (error) => {
      if (error) {
        reject(debugError('音訊載入失敗'));
        return;
      }

      const duration = sound.getDuration();
      sound.release();
      resolve({ duration });
    });
  });
}

// 存檔時封裝
export async function generateRecordingMetadata(uri: string): Promise<{
  date: string;
  durationSec: number;
  size: number;
}> {
  let durationSec = 0;
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
  } catch (error) {
    debugError('獲取音檔時長失敗:', error);
  }

  const stat = await RNFS.stat(uri);
  return {
    date: startDate.toISOString(),
    durationSec,
    size: stat.size ?? 0,
  };
}

//存儲文字
export function updateRecordingFields(
  recordings: RecordingItem[],
  index: number,
  uri: string | undefined,
  fields: Partial<RecordingItem>
): RecordingItem[] {
  const updated = [...recordings];

  if (uri && uri !== recordings[index].uri) {
    const updatedParts = (updated[index].derivedFiles?.splitParts || []).map((p) =>
      p.uri === uri ? { ...p, ...fields } : p
    );
    updated[index] = {
      ...updated[index],
      derivedFiles: {
        ...updated[index].derivedFiles,
        splitParts: updatedParts,
      },
    };
  } else {
    updated[index] = {
      ...updated[index],
      ...fields,
    };
  }

  return updated;
}


