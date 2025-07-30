import Sound from 'react-native-sound';
import { debugLog, debugWarn, debugError } from './debugLog';
import { useState, useEffect, useRef } from 'react';

export const useAudioPlayer = () => {
  const currentSoundRef = useRef<Sound | null>(null);
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
    debugLog('▶️ startProgressTimer 被呼叫');
    clearProgressTimer();
    progressUpdateInterval.current = setInterval(() => {
      if (currentSoundRef.current) {
        currentSoundRef.current.getCurrentTime((seconds) => {
   //       debugLog('📦 getCurrentTime =', seconds);
          setPlaybackPosition(seconds * 1000);
        });
      }
    }, 250);
  };

  const stopPlayback = () => {
    if (currentSoundRef.current) {
      currentSoundRef.current.stop();
      currentSoundRef.current.release();
      currentSoundRef.current = null;
      setIsPlaying(false);
      setPlayingUri(null);
      setPlaybackPosition(0);
    }
    clearProgressTimer();
  };

  const playRecording = async (uri: string, index?: number) => {
    try {
      if (currentSoundRef.current && playingUri === uri) {
        if (isPlaying) {
          currentSoundRef.current.pause();
          setIsPlaying(false);
          clearProgressTimer();
        } else {
          currentSoundRef.current.play();
          setIsPlaying(true);
          startProgressTimer();
        }
        return;
      }

      stopPlayback();

      const sound = new Sound(uri, '', (error) => {
        if (error) {
          debugError('❌ 加載音頻失敗:', uri, error);
          return;
        }
        sound.setNumberOfLoops(0);
        const duration = sound.getDuration();
        if (!duration || isNaN(duration)) {
          debugWarn('❗ 無法取得音檔時長:', uri);
        }

        setPlaybackDuration(duration * 1000);
        setPlayingUri(uri);
        setCurrentPlaybackRate(1.0);
        sound.setSpeed(1.0);

        currentSoundRef.current = sound;

        setIsPlaying(true);
        startProgressTimer();

        sound.play((success) => {
          if (!success) {
            debugError('播放失敗');
          }
          setIsPlaying(false);
          setPlayingUri(null);
          setPlaybackPosition(0);
          clearProgressTimer();
        });
      });
    } catch (err) {
      debugError('播放失敗:', err);
    }
  };

  const togglePlayback = async (uri: string, index?: number) => {
    await playRecording(uri, index);
  };

  const setPlaybackRate = async (rate: number) => {
    setCurrentPlaybackRate(rate);
    if (currentSoundRef.current) {
      currentSoundRef.current.setSpeed(rate);
    }
  };

  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, []);

  return {
    currentSound: currentSoundRef.current,
    isPlaying,
    playingUri,
     setPlayingUri,
    currentPlaybackRate,
    setPlaybackRate,
    playbackPosition,
    playbackDuration,
    playRecording,
    togglePlayback,
    setPlaybackPosition,
    stopPlayback
  };
};
