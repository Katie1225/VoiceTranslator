// components/RecorderControls.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../constants/ThemeContext';
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
    isNotesVisible?: boolean;
    onCreateTextNote: () => void;
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
    isNotesVisible = false,
    onCreateTextNote, // 新增：接收創建文字筆記的函數
}) => {
    const { colors, toggleTheme, setCustomPrimaryColor } = useTheme();
    const [displayTime, setDisplayTime] = useState(0);
    const [menuVisible, setMenuVisible] = useState(false);
    const [decibelHistory, setDecibelHistory] = useState<number[]>([]);
    const { t } = useTranslation();

    // 錄音顯示時間
    useEffect(() => {
        const timer: ReturnType<typeof setInterval> | null =
            recording
                ? setInterval(() => {
                    const currentTime = recordingTimeRef.current || 0;
                    setDisplayTime(currentTime);
                }, 1000)
                : null;

        if (!recording) {
            setDisplayTime(0);
        }

        return () => {
            if (timer) clearInterval(timer);
        };
    }, [recording]);

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
                {/* 左邊 45%：時間 / 標題 - 保持不變 */}
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
                                        ? 2
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
                                })}
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
                            {t('startRecording')}
                        </Text>
                    )}
                </View>

                {/* 中間 15%：錄音按鈕 - 添加三角形 */}
                <View style={{ flex: 1.5, marginRight: 0, alignItems: 'center' }}>
                    {/* 錄音時顯示的小三角形 */}
                    {recording && (
                        <TouchableOpacity
                            onPress={onToggleNotesModal}
                            style={{
                                position: 'absolute',
                                top: -25,  // 調整位置讓三角形更明顯
                                right: -25, // 調整位置讓三角形更明顯
                                zIndex: 10,
                                backgroundColor: 'transparent', // 改為透明背景
                                borderRadius: 10,
                                padding: 6, // 增加點擊區域
                            }}
                        >
                            {isNotesVisible ? null : (
                                <MaterialCommunityIcons name="menu-up" size={40} color={colors.text} />
                            )}
                        </TouchableOpacity>
                    )}

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

                {/* 右邊 15% 小本本按鈕 - 保持不變 */}
                <View style={{ flex: 1.5, marginRight: 20 }}>
                    <TouchableOpacity onPress={onCreateTextNote}>
                        <MaterialCommunityIcons
                            name="text-box-plus"
                            size={30}
                            color={colors.subtext}
                            style={{ marginLeft: 20 }}
                        />
                    </TouchableOpacity>
                </View>
            </View>
        </>
    );
};

export default RecorderControls;