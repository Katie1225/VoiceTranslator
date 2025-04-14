import AudioRecorderPlayer, {
    AudioEncoderAndroidType,
    AudioSourceAndroidType,
    OutputFormatAndroidType,
  } from 'react-native-audio-recorder-player';
  
  // 建立錄音播放器實體（支援錄音與播放）
  const recorderPlayer = new AudioRecorderPlayer();
  
  // 錄音開始：回傳音檔 URI
  export const startRecording = async (): Promise<string | null> => {
    try {
      const result = await recorderPlayer.startRecorder(undefined, {
        // ✅ 錄音來源：使用 VOICE_RECOGNITION 會套用系統降噪與人聲清晰化處理
        AudioSourceAndroid: AudioSourceAndroidType.VOICE_RECOGNITION,
  
        // ✅ 音訊編碼方式：AAC 為高壓縮率與高品質編碼格式
        AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
  
        // ✅ 輸出檔案格式：MPEG_4 可產生 .m4a 檔案，兼容性高
        OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  
        // ✅ 採樣率：48kHz 是專業錄音的標準（比 44.1kHz 更高）
        AudioSamplingRateAndroid: 48000,
  
        // ✅ 單聲道：一般語音建議單聲道，檔案小、辨識度佳
        AudioChannelsAndroid: 1,
  
        // ✅ 音訊位元率：320kbps 屬高品質錄音，適用語音與音樂
        AudioEncodingBitRateAndroid: 320000,
      });
  
      return result;
    } catch (err) {
      console.error('🎤 錄音失敗', err);
      return null;
    }
  };
  
  // 停止錄音，並取得儲存檔案的路徑
  export const stopRecording = async (): Promise<string | null> => {
    try {
      const result = await recorderPlayer.stopRecorder();
      recorderPlayer.removeRecordBackListener(); // 清除錄音狀態監聽
      return result;
    } catch (err) {
      console.error('🛑 停止錄音失敗', err);
      return null;
    }
  };
  
  // 播放錄音（可額外加上播放進度處理）
  export const playRecording = async (uri: string): Promise<void> => {
    try {
      await recorderPlayer.startPlayer(uri);
    } catch (err) {
      console.error('▶️ 播放失敗', err);
    }
  };
  
  // 停止播放
  export const stopPlayback = async (): Promise<void> => {
    try {
      await recorderPlayer.stopPlayer();
    } catch (err) {
      console.error('⏹ 停止播放失敗', err);
    }
  };
  