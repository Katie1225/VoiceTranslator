import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { nginxVersion } from '../constants/variant';

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

export async function speedUpAudio(uri: string, speed: number) {
  const outputUri = `${FileSystem.cacheDirectory}sped_up_${Date.now()}_x${speed}.wav`;

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

export async function getAudioDuration(uri: string): Promise<{ duration: number }> {
  const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });

  if (!status.isLoaded) {
    throw new Error('音訊載入失敗');
  }

  const duration = status.durationMillis != null ? status.durationMillis / 1000 : 0;
  await sound.unloadAsync(); // ✅ 記得釋放資源

  return { duration };
}


export const transcribeAudio = async (
  item: RecordingItem,
  onPartial?: (text: string, index: number, total: number) => void,
  targetLang: 'tw' | 'cn' = 'tw'
): Promise<{ transcript: { text: string } }> => {


  try {
    if (!item.uri || !item.name) {
      throw new Error('音檔資訊不完整（uri 或 name 為 null）');
    }


    const trimmedRecording = await trimSilence(item.uri, item.name);
    const wavUri = await speedUpAudio(trimmedRecording.uri, 1.5);

    const fileInfo = await FileSystem.getInfoAsync(wavUri);
    if (!fileInfo.exists || typeof fileInfo.size !== 'number') {
      throw new Error('轉換後的檔案不存在或無法取得大小');
    }

    // 🧠 定義可疑語句
    const suspiciousPhrases = [
      '社群提供',
      '社區提供',
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
      '請不吝點贊訂閱',
      '請不吝點贊訂閱欄目',
      '請不吝點贊訂閱轉發打賞支持明鏡與點點欄目',
      '字幕by索蘭婭╰╯╯',
    ];

    const isSuspicious = (text: string) => {
      return suspiciousPhrases.some(phrase => text.includes(phrase));
    };

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

    const { duration } = await getAudioDuration(wavUri);
    const segmentCount = Math.ceil(duration / 30);
    const now = Date.now();

    for (let i = 0; i < segmentCount; i++) {
      const start = i * 30;
      const segmentName = `segment_${i}_${Date.now()}.wav`;
      const segmentPath = `${FileSystem.cacheDirectory}${segmentName}`;

      const command = `-i "${wavUri}" -ss ${start} -t 30 -ar 16000 -ac 1 "${segmentPath}"`;
      await FFmpegKit.execute(command);
      const { duration: segmentDuration } = await getAudioDuration(segmentPath);
      console.log(`⏱️ 第 ${i + 1} 段時長: ${segmentDuration.toFixed(2)}秒`);
      if (segmentDuration < 1) {
        console.log(`⏭️ 跳過過短分段 (${segmentDuration}s)`);
        continue;
      }

      console.log(`📤 上傳第 ${i + 1} 段`);
      const formData = new FormData();
      formData.append('audio', {
        uri: segmentPath,
        name: segmentName,
        type: 'audio/wav',
      } as any);
      formData.append('targetLang', targetLang);

      let BASE_URL: string;
      if (nginxVersion === 'blue') {
        BASE_URL = 'https://katielab.com/transcribe/';
      } else if (nginxVersion === 'green') {
        BASE_URL = 'https://katielab.com/v1/transcribe/';
      } else {
        throw new Error('未知的 nginxVersion');
      }

      const response = await fetch(BASE_URL, {
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
      } else {
        console.log('✅ 呼叫 Whisper API 成功');
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

      const sentences = text.split(/(?<=[。！？!?\n])/);
      const filtered = sentences.filter(s => !suspiciousPhrases.some(p => s.includes(p)));
      text = filtered.join('').trim();

      if (text.trim()) {
        accumulated += text + '\n';
      }

      onPartial?.(accumulated.trim(), i + 1, segmentCount);
      await FileSystem.deleteAsync(segmentPath, { idempotent: true });  // 清除暫存段落檔案
    }

    return { transcript: { text: accumulated.trim() } };

  } catch (err) {
    console.error('❌ transcribeAudio 全域錯誤：', err);
    throw err;
  }
};

const basePrompt =
  '錄音文字是一段可能由多人或單人錄製, 由 OPENAI 處理聲音轉文字的逐字稿, 專有名詞上可能會有錯誤, 或每次音譯造成不同, 而且可能各國廣告或是歡迎訂閱請刪除. 逐字稿請使用請參考使用者補充筆記校正姓名及專有名詞.';

export const summarizeModes = [
  {
    key: 'summary',
    label: '重點整理',
    prompt: `${basePrompt}將這段文字整理成清楚條列式的重點摘要。`,
  },
  {
    key: 'analysis',
    label: '會議記錄',
    prompt: `${basePrompt}將這段文字整理成會議記錄, 包含參與者(如果有提及), 會議時間(如果有提及), 討論項目, 下一步行動(依照日期排列)。`,
  },
  {
    key: 'email',
    label: '信件撰寫',
    prompt: `${basePrompt}幫我把這段文字整理成一封正式的商業郵件，語氣禮貌。`,
  },
  {
    key: 'news',
    label: '新聞稿',
    prompt: `${basePrompt}將這段文字改寫成新聞稿格式，具體且吸引人。`,
  },
  {
    key: 'ai_answer',
    label: 'AI給答案',
    prompt: `${basePrompt}將這段文字，直接給出一個完整詳細的回答。`,
  },
];


// 核心摘要函式
export async function summarizeWithMode(
  transcript: string,
  modeKey: string,
  targetLang: 'tw' | 'cn' = 'tw'
) {
  const mode = summarizeModes.find(m => m.key === modeKey);
  if (!mode) throw new Error('未知的摘要模式');

  const finalPrompt = `${mode.prompt}\n\n使用者的主機語言是 ${targetLang}，請用此語言回覆。`;

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



