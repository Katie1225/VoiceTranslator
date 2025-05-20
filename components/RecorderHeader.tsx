// components/RecorderHeader.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import HamburgerMenu from './HamburgerMenu';
import { handleLogin } from '../utils/loginHelpers';

interface RecorderHeaderProps {
    recording: boolean;
    recordingTimeRef: React.RefObject<number>;
    startRecording: () => void;
    stopRecording: () => void;
    pickAudio: () => void;
    setIsLoggingIn: (v: boolean) => void;
    isDarkMode: boolean;
    toggleTheme: () => void;
    customPrimaryColor: string | null;
    setCustomPrimaryColor: (color: string | null) => void;
    styles: any;
    colors: any;
    title?: string;
}

const RecorderHeader: React.FC<RecorderHeaderProps> = ({
    recording,
    recordingTimeRef,
    startRecording,
    stopRecording,
    pickAudio,
    setIsLoggingIn,
    isDarkMode,
    toggleTheme,
    customPrimaryColor,
    setCustomPrimaryColor,
    styles,
    colors,
    title = 'Voice Note',
}) => {
    const [displayTime, setDisplayTime] = useState(0);
    const [menuVisible, setMenuVisible] = useState(false);

    useEffect(() => {
        const timer = setInterval(() => {
            setDisplayTime(recordingTimeRef.current || 0);
        }, 1000);
        return () => clearInterval(timer);
    }, []);

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
                paddingHorizontal: 6,
                paddingTop: 0,
                minHeight: 70,
            }}>
                {/* 左邊 45%：時間 / 標題 */}
                <View style={{ flex: 4.5, marginRight: 0 }}>
                    <Text numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{ color: colors.primary, fontSize: 26, fontWeight: '500', fontStyle: 'italic' }}>
                        {recording ? `⏱ ${formatTime(displayTime * 1000)}` : title}
                    </Text>
                </View>

                {/* 中間 45%：錄音按鈕 */}
                <View style={{ flex: 4, marginRight: 0 }}>
                    <TouchableOpacity
                        style={recording ? styles.stopButton : styles.recordButton}
                        onPress={recording ? stopRecording : startRecording}
                    >
                        <Text
                            numberOfLines={1}
                            ellipsizeMode="tail"
                            style={styles.buttonText}>
                            {recording ? '停止錄音' : '開始錄音'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* 右邊 15%：上下的 ☰ / ＋ */}
                <View style={{
                    flex: 1.5,
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    height: 70,
                }}>
                    <TouchableOpacity onPress={() => setMenuVisible(!menuVisible)}>
                        <Text style={{ fontSize: 20, color: colors.primary }}>☰</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={pickAudio}>
                        <Text style={{ fontSize: 20, color: colors.primary }}>📂</Text>
                    </TouchableOpacity>
                </View>
            </View>
            {/* ☰ 選單 */}
            <HamburgerMenu
                visible={menuVisible}
                onClose={() => setMenuVisible(false)}
                isDarkMode={isDarkMode}
                toggleTheme={toggleTheme}
                customPrimaryColor={customPrimaryColor}
                setCustomPrimaryColor={setCustomPrimaryColor}
                styles={styles}
                onLoginPress={() => handleLogin(setIsLoggingIn)}
                onLoginSuccess={() => setMenuVisible(false)}
            />
        </>
    );
};

export default RecorderHeader;
