// contants/ThemeContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { partBackgrounds, additionalColors } from '../constants/Colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStyles } from '@/constants/audioStyles';

export type FontScale = 'small' | 'medium' | 'large';

type ThemeContextType = {
    isDarkMode: boolean;
    toggleTheme: () => void;
    customPrimaryColor: string | null;
    setCustomPrimaryColor: (color: string | null) => void;
    fontScale: FontScale;
    setFontScale: (size: FontScale) => void;
    colors: any;
    styles: any;
    additionalColors: Record<string, string>;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getComplementaryColor(hex: string, degree = 5): string {
    // 1. hex → RGB
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0, s = 0, l = (max + min) / 2;

    if (d !== 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
            case g: h = ((b - r) / d + 2); break;
            case b: h = ((r - g) / d + 4); break;
        }
        h *= 60;
    }

    // 2. 調整色相
    h = (h + degree) % 360;

    // 3. HSL → RGB
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r1 = 0, g1 = 0, b1 = 0;

    if (h < 60) [r1, g1, b1] = [c, x, 0];
    else if (h < 120) [r1, g1, b1] = [x, c, 0];
    else if (h < 180) [r1, g1, b1] = [0, c, x];
    else if (h < 240) [r1, g1, b1] = [0, x, c];
    else if (h < 300) [r1, g1, b1] = [x, 0, c];
    else[r1, g1, b1] = [c, 0, x];

    const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`.toUpperCase();
}

function getTintedPrimary(hex: string, ratio = 0.25): string {
    const r = Math.round((1 - ratio) * parseInt(hex.slice(1, 3), 16) + ratio * 255);
    const g = Math.round((1 - ratio) * parseInt(hex.slice(3, 5), 16) + ratio * 255);
    const b = Math.round((1 - ratio) * parseInt(hex.slice(5, 7), 16) + ratio * 255);
    return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [customPrimaryColor, _setCustomPrimaryColor] = useState<string | null>(null);
    const [fontScale, setFontScaleState] = useState<FontScale>('medium');


    // 寫入 AsyncStorage
    const setFontScale = (size: FontScale) => {
        setFontScaleState(size);
        AsyncStorage.setItem('fontScale', size);
    };

    // 包裝 setCustomPrimaryColor 並寫入 AsyncStorage
    const setCustomPrimaryColor = (color: string | null) => {
        _setCustomPrimaryColor(color);
        if (color) {
            AsyncStorage.setItem('primaryColor', color);
        } else {
            AsyncStorage.removeItem('primaryColor');
        }
    };
    const themeBase = partBackgrounds[isDarkMode ? 'dark' : 'light'] || {};
    const finalPrimary = customPrimaryColor || themeBase.primary || '#00C1D4';

    const colors = {
        ...themeBase,
        primary: finalPrimary,
        complementary: getComplementaryColor(finalPrimary), // 
        primaryTint: getTintedPrimary(finalPrimary, 0.5),

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
            const savedScale = await AsyncStorage.getItem('fontScale');

            if (theme === 'dark' || theme === 'light') {
                setIsDarkMode(theme === 'dark');
            }

            if (color) {
                setCustomPrimaryColor(color);
            }


            if (savedScale === 'small' || savedScale === 'medium' || savedScale === 'large') {
                setFontScaleState(savedScale as FontScale);
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
                fontScale,
                setFontScale,
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