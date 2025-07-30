// components/RecorderControls.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import HamburgerMenu from './HamburgerMenu';
import { handleLogin } from '../utils/loginHelpers';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../constants/ThemeContext';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { Platform } from 'react-native';
import { useTranslation } from '../constants/i18n';

interface RecorderControlsProps {
    recording: boolean;
    recordingTimeRef: React.RefObject<number>;
    startRecording: () => void;
    stopRecording: () => void;
    pickAudio: () => void;
    setIsLoggingIn: (v: boolean) => void;
    title?: string;
    currentDecibels: number;
    onToggleNotesModal: () => void;
}

const RecorderControls: React.FC<RecorderControlsProps> = ({
    recording,
    recordingTimeRef,
    startRecording,
    stopRecording,
    pickAudio,
    setIsLoggingIn,
    title,
    currentDecibels,
    onToggleNotesModal,
}) => {
    const { colors, toggleTheme, setCustomPrimaryColor } = useTheme();
    const [displayTime, setDisplayTime] = useState(0);
    const [menuVisible, setMenuVisible] = useState(false);
    const [decibelHistory, setDecibelHistory] = useState<number[]>([]);
const { t } = useTranslation();
    useEffect(() => {
        let timer: NodeJS.Timeout;

        if (recording) {
            // 每次開始錄音時重置時間
            setDisplayTime(0);

            timer = setInterval(() => {
                // 直接使用 recordingTimeRef.current 但確保從0開始
                const currentTime = recordingTimeRef.current || 0;
                setDisplayTime(currentTime);
            }, 1000);
        } else {
            setDisplayTime(0);
        }

        return () => {
            if (timer) clearInterval(timer);
        };
    }, [recording]); // 只依賴 recording 狀態

    useEffect(() => {
        setDecibelHistory((prev) => {
            const next = [...prev, currentDecibels];
            if (next.length > 50) next.shift(); // 只保留最近 40 筆
            return next;
        });
    }, [currentDecibels]);

    useEffect(() => {
        if (!recording) {
            setDecibelHistory([]); // ✅ 停止錄音時清空記錄
        }
    }, [recording]);

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    };

    return (
        <>
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 0,
                minHeight: 70,
            }}>
                {/* 左邊 45%：時間 / 標題 */}

                <View style={{ flex: 5.5, alignItems: 'center', justifyContent: 'center', marginLeft: -10, }}>
                    {recording ? (
                        <>
                            <Text
                                style={{
                                    color: colors.primary,
                                    fontSize: 18,
                                    fontWeight: '500',
                                    fontStyle: 'italic',
                                    paddingHorizontal: 10,
                                    textAlign: 'center',
                                }}
                            >
                                ⏱ {formatTime(displayTime * 1000)}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', height: 30, overflow: 'hidden' }}>
                                {decibelHistory.map((dB, index) => {
                                    const height = dB < -90
                                        ? 2 // ← 強制最小 2px
                                        : Math.max(2, ((Math.max(-90, Math.min(dB, 0)) + 100) / 100) * 30);
                                    return (
                                        <View
                                            key={index}
                                            style={{
                                                width: 2,
                                                height,
                                                backgroundColor: colors.primary + '80',
                                                marginHorizontal: 0.6,
                                            }}
                                        />
                                    );
                                })
}
                            </View>
                        </>
                    ) : (
                        <Text
                            numberOfLines={1}
                            ellipsizeMode="tail"
                            style={{
                                color: colors.primary,
                                fontSize: 20,
                                fontWeight: '500',
                                fontStyle: 'italic',
                                textAlign: 'center',
                                marginRight: 0,
                                marginBottom: 15,
                                fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'Noto Sans TC',
                            }}
                        >
                            {/*現在開始記錄*/}
                              {t('startRecording')}
                        </Text>
                    )}
                </View>

                {/* 中間 15%：錄音按鈕 */}
                <View style={{ flex: 1.5, marginRight: 0 }}>
                    <TouchableOpacity
                        style={{
                            width: 60,
                            height: 60,
                            borderRadius: 30,
                            backgroundColor: recording ? '#CF4237' : colors.complementary,
                            justifyContent: 'center',
                            alignItems: 'center',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.2,
                            shadowRadius: 2,
                            elevation: 4,
                        }}
                        onPress={recording ? stopRecording : startRecording}
                    >
                        {recording ? (
                            <MaterialCommunityIcons name="stop" size={30} color="white" />
                        ) : (
                            <MaterialCommunityIcons name="microphone" size={30} color="white" />
                        )}
                    </TouchableOpacity>
                </View>
                {/* 左邊 15% 編寫筆 */}
                <View style={{ flex: 1.5, marginRight: 20 }}>
                    {recording && (
                        <TouchableOpacity onPress={onToggleNotesModal}>
                            <MaterialCommunityIcons name="pencil-plus" size={30} color={colors.subtext} style={{ marginLeft: 10 }} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </>
    );
};

export default RecorderControls;
