// contants/ThemeContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { partBackgrounds, additionalColors } from '../constants/Colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStyles } from '@/constants/audioStyles';

type ThemeContextType = {
    isDarkMode: boolean;
    toggleTheme: () => void;
    customPrimaryColor: string | null;
    setCustomPrimaryColor: (color: string | null) => void;
    colors: any;
    styles: any;
    additionalColors: Record<string, string>;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
    const [isDarkMode, setIsDarkMode] = useState(true);
    const [customPrimaryColor, setCustomPrimaryColor] = useState<string | null>(null);

    const themeBase = partBackgrounds[isDarkMode ? 'dark' : 'light'] || {};
    const colors = {
        ...themeBase,
        primary: customPrimaryColor || themeBase.primary || '#00C1D4',
    };

    // 假設 createStyles 是一個函數，根據 colors 生成樣式
    const styles = createStyles(colors);

    const toggleTheme = () => {
        const newMode = !isDarkMode;
        setIsDarkMode(newMode);
        AsyncStorage.setItem('themeMode', newMode ? 'dark' : 'light');
    };

    useEffect(() => {
        const loadPreferences = async () => {
            const theme = await AsyncStorage.getItem('themeMode');
            const color = await AsyncStorage.getItem('primaryColor');

            if (theme === 'dark' || theme === 'light') {
                setIsDarkMode(theme === 'dark');
            }

            if (color) {
                setCustomPrimaryColor(color);
            }
        };

        loadPreferences();
    }, []);

    return (
        <ThemeContext.Provider
            value={{
                isDarkMode,
                toggleTheme,
                customPrimaryColor,
                setCustomPrimaryColor,
                colors,
                styles,
                additionalColors,
            }}
        >
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};