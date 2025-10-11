// useAudioPlayer.ts
// 替換 react-native-sound → expo-audio，並保留原本回傳介面與方法名稱
// 供 RecorderLists 與其他呼叫端「零改動」直接使用。

import * as React from 'react';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Asset } from 'expo-asset';

// ---- 工具：把來源轉成可播放的 URI（支援 file://, http(s)://, require(...)）----
async function toPlayableUri(src: string): Promise<string> {
  if (src.startsWith('file://') || /^https?:\/\//.test(src)) return src;
  if (src.includes('://')) return src; // 其他協定
  return `file://${src}`;
}
// 若你也會傳入 require(...)，可改成 string | number 並加上 Asset.fromModule(...) 解析。

type CurrentSoundAdapter = {
  setSpeed: (rate: number) => void;               // 供呼叫端使用（暫時 no-op 或自行保存）
  setCurrentTime: (sec: number) => void;          // 供 onSeek 使用（秒）
  getCurrentTime: (cb: (sec: number) => void) => void; // RecorderLists 裡定時讀取（秒）
};

export function useAudioPlayer() {
  // 內部 player（expo-audio）
  const playerRef = React.useRef<AudioPlayer | null>(null);

  // ---- 對外回傳的狀態（名稱完全對齊你原本的呼叫端）----
  const currentSoundRef = React.useRef<CurrentSoundAdapter | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [playingUri, setPlayingUri] = React.useState<string | null>(null);
  const [currentPlaybackRate, setPlaybackRate] = React.useState(1.0);
  const [playbackPosition, setPlaybackPosition] = React.useState(0); // ms
  const [playbackDuration, setPlaybackDuration] = React.useState(0); // ms

  // ---- 建立 adapter，讓呼叫端的 currentSound.* 照用不誤 ----
  const ensureAdapter = React.useCallback(() => {
    if (currentSoundRef.current) return currentSoundRef.current;
    currentSoundRef.current = {
      setSpeed: (rate: number) => {
        // expo-audio 目前沒有穩定的變速 API；先保存於 state（UI 顯示），不丟錯
        setPlaybackRate(rate);
        // 若未來 expo-audio 提供 setRate，可在此串接 playerRef.current?.setRate(rate)
      },
      setCurrentTime: (sec: number) => {
        playerRef.current?.seekTo(sec);
      },
      getCurrentTime: (cb: (sec: number) => void) => {
        const sec = playerRef.current?.currentTime ?? 0;
        cb(sec);
      },
    };
    return currentSoundRef.current;
  }, []);

  // ---- 讀取 / 切換音檔並播放（保持舊名稱與用法）----
  const playRecording = React.useCallback(
    async (uri: string) => {
      const resolved = await toPlayableUri(uri);

      // 若已載入同一首，直接播放
      if (playerRef.current && playingUri === resolved) {
        await playerRef.current.play();
        setIsPlaying(true);
        return;
      }

      // 卸載舊的
      playerRef.current?.remove();
      playerRef.current = null;

      // 建立新的
      const p = createAudioPlayer({ uri: resolved });
      playerRef.current = p;
      setPlayingUri(resolved);

      // 啟動播放
      await p.play();
      setIsPlaying(true);
    },
    [playingUri]
  );

  // togglePlayback(uri?, index?)：RecorderLists 會傳 (uri, index)
  const togglePlayback = React.useCallback(
    async (uri?: string, _index?: number) => {
      ensureAdapter();

      // 有傳 uri 而且與目前不同 → 先切檔再播
      if (uri && uri !== playingUri) {
        await playRecording(uri);
        return;
      }

      const p = playerRef.current;
      if (!p) {
        if (uri) await playRecording(uri);
        return;
      }

      if (p.playing) {
        await p.pause();
        setIsPlaying(false);
      } else {
        await p.play();
        setIsPlaying(true);
      }
    },
    [ensureAdapter, playRecording, playingUri]
  );

  const stopPlayback = React.useCallback(async () => {
    const p = playerRef.current;
    if (!p) return;
    await p.seekTo(0);
    await p.pause();
    setIsPlaying(false);
  }, []);

  // ---- 播放進度／時長（ms）以 RAF 更新，對齊呼叫端期望 ----
  const rafRef = React.useRef<number | null>(null);
  const tick = React.useCallback(() => {
    const p = playerRef.current;
    if (p) {
      setPlaybackPosition(Math.max(0, (p.currentTime || 0) * 1000));
      setPlaybackDuration(Math.max(0, (p.duration || 0) * 1000));
      setIsPlaying(!!p.playing);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  React.useEffect(() => {
    ensureAdapter();
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      playerRef.current?.remove();
      playerRef.current = null;
    };
  }, [ensureAdapter, tick]);

  // ---- 對外回傳（名稱完全維持）----
  return {
    currentSound: ensureAdapter(),   // 供 .setSpeed / .setCurrentTime / .getCurrentTime
    isPlaying,
    playingUri,
    setPlayingUri,
    currentPlaybackRate,
     playbackRate: currentPlaybackRate, // ← 新增這行，提供舊名
    setPlaybackRate,                 // 你原本在外部會呼叫（UI 顯示/記錄），保留
    playbackPosition,
    playbackDuration,
    playRecording,
    togglePlayback,
    setPlaybackPosition,             // 你外面在 onSeek 會直接 set（毫秒），保留
    stopPlayback,
  };
}
