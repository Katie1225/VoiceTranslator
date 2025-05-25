import { useState, useRef, useEffect } from 'react';
import { Audio } from 'expo-av';
import { debugLog, debugWarn,debugError } from './debugLog';

export const useAudioPlayer = () => {
    const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playingUri, setPlayingUri] = useState<string | null>(null);
    const [currentPlaybackRate, setCurrentPlaybackRate] = useState(1.0);
    const [playbackPosition, setPlaybackPosition] = useState(0);
    const [playbackDuration, setPlaybackDuration] = useState(0);
    const progressUpdateInterval = useRef<NodeJS.Timeout | null>(null);

    const playRecording = async (uri: string, index?: number) => {
        try {

            const uriForPlayback = uri.startsWith('file://') ? uri : `file://${uri}`;
            if (currentSound && playingUri === uri) {
                if (isPlaying) {
                    await currentSound.pauseAsync();
                    setIsPlaying(false);
                    clearProgressTimer();
                } else {
                    await currentSound.playAsync();
                    setIsPlaying(true);
                    startProgressTimer();
                }
            } else {
                if (currentSound) await currentSound.unloadAsync();

                const uriForPlayback = uri.startsWith('file://') ? uri : `file://${uri}`;

// 修改 playRecording 函數中的音頻創建部分
const { sound, status } = await Audio.Sound.createAsync(
    { uri: uriForPlayback },
    {
        shouldPlay: true,
        rate: currentPlaybackRate,
        shouldCorrectPitch: true,
        progressUpdateIntervalMillis: 250
    },
    (status) => {
        if (status.isLoaded) {
            setPlaybackPosition(status.positionMillis ?? 0);
            // 添加這行來更新持續時間
            setPlaybackDuration(status.durationMillis ?? 0);
            
            if (status.didJustFinish) {
                setIsPlaying(false);
                setPlayingUri(null);
                setPlaybackPosition(0);
                clearProgressTimer();
            }
        }
    }
);

// 從狀態中獲取並設置初始持續時間
if (status.isLoaded && status.durationMillis) {
    setPlaybackDuration(status.durationMillis);
}
                setCurrentSound(sound);
                setPlayingUri(uri);
                setIsPlaying(true);
                startProgressTimer(); // ✅ 撥放時開始 timer
            }
        } catch (err) {
            debugError('播放失敗:', err);
        }
    };

    const togglePlayback = async (uri: string, index?: number) => {
        if (currentSound && playingUri === uri) {
            if (isPlaying) {
                await currentSound.pauseAsync();
                setIsPlaying(false);
                clearProgressTimer();
            } else {
                await currentSound.playAsync();
                setIsPlaying(true);
                startProgressTimer();
            }
        } else {
            await playRecording(uri, index);
        }
    };

    const setPlaybackRate = async (rate: number) => {
        setCurrentPlaybackRate(rate); // 儲存當前播放速度
        if (currentSound) {
            try {
                const status = await currentSound.getStatusAsync();
                if (status.isLoaded) {
                    await currentSound.setRateAsync(rate, true); // true 代表啟用 pitch 校正
                    debugLog("✅ 播放速度已設定為", rate);
                }
            } catch (err) {
                debugError("❌ 設定播放速度失敗：", err);
            }
        }
    };

    // 啟動進度定時器
    const startProgressTimer = () => {
        clearProgressTimer(); // 確保不會重複啟動
        progressUpdateInterval.current = setInterval(async () => {
            if (currentSound) {
                const status = await currentSound.getStatusAsync();
                if (status.isLoaded && status.positionMillis) {
                    setPlaybackPosition(status.positionMillis);
                }
            }
        }, 250);
    };

    // 清除進度定時器
    const clearProgressTimer = () => {
        if (progressUpdateInterval.current) {
            clearInterval(progressUpdateInterval.current);
        }
    };


    useEffect(() => {
        return () => {
            if (currentSound) currentSound.unloadAsync();
            clearProgressTimer();
        };
    }, [currentSound]);

    
        // 清理資源
        useEffect(() => {
            return () => {
                if (currentSound) {
                    currentSound.unloadAsync();
                }
                if (progressUpdateInterval.current) {
                    clearInterval(progressUpdateInterval.current);
                }
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
