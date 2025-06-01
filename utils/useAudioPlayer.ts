import Sound from 'react-native-sound';
import { debugLog, debugWarn, debugError } from './debugLog';
import React, { useState, useEffect, useRef } from 'react';

export const useAudioPlayer = () => {
  const [currentSound, setCurrentSound] = useState<Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const [currentPlaybackRate, setCurrentPlaybackRate] = useState(1.0);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const progressUpdateInterval = useRef<NodeJS.Timeout | null>(null);

  const clearProgressTimer = () => {
    if (progressUpdateInterval.current) {
      clearInterval(progressUpdateInterval.current);
      progressUpdateInterval.current = null;
    }
  };

  const startProgressTimer = () => {
    clearProgressTimer();
    progressUpdateInterval.current = setInterval(() => {
      if (currentSound && isPlaying) {
        currentSound.getCurrentTime((seconds) => {
          setPlaybackPosition(seconds * 1000);
        });
      }
    }, 250);
  };

  const playRecording = async (uri: string, index?: number) => {
    try {
      // 如果正在播放同一音檔，則暫停
      if (currentSound && playingUri === uri) {
        if (isPlaying) {
          currentSound.pause();
          setIsPlaying(false);
          clearProgressTimer();
        } else {
          currentSound.play();
          setIsPlaying(true);
          startProgressTimer();
        }
        return;
      }

      // 停止並釋放當前音檔
      if (currentSound) {
        currentSound.stop();
        currentSound.release();
        setCurrentSound(null);
      }

      // 重置狀態
      setPlaybackPosition(0);
      setPlayingUri(null);
      setIsPlaying(false);
      clearProgressTimer();

      // 初始化新音檔
      const sound = new Sound(uri, '', (error) => {
        if (error) {
          debugError('加載音頻失敗:', error);
          return;
        }

        setPlaybackDuration(sound.getDuration() * 1000);
        setPlayingUri(uri);
        setCurrentSound(sound);
        
        // 設置播放速率
        sound.setSpeed(currentPlaybackRate);
        
        sound.play((success) => {
          if (!success) {
            debugError('播放失敗');
          }
          setIsPlaying(false);
          setPlayingUri(null);
          setPlaybackPosition(0);
          clearProgressTimer();
        });

        setIsPlaying(true);
        startProgressTimer();
      });

      setCurrentSound(sound);
    } catch (err) {
      debugError('播放失敗:', err);
    }
  };

  const togglePlayback = async (uri: string, index?: number) => {
    await playRecording(uri, index);
  };

  const setPlaybackRate = async (rate: number) => {
    setCurrentPlaybackRate(rate);
    if (currentSound) {
      currentSound.setSpeed(rate);
    }
  };

  useEffect(() => {
    return () => {
      if (currentSound) {
        currentSound.stop();
        currentSound.release();
      }
      clearProgressTimer();
    };
  }, [currentSound]);

  return {
    currentSound,
    isPlaying,
    playingUri,
    currentPlaybackRate,
    setPlaybackRate,
    playbackPosition,
    playbackDuration,
    playRecording,
    togglePlayback,
    setPlaybackPosition
  };
};
