// components/HamburgerMenu.tsx
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { lightTheme, darkTheme, additionalColors } from '../constants/Colors';

type Props = {
    visible: boolean;
    onClose: () => void;
    isDarkMode: boolean;
    setIsDarkMode: (value: boolean) => void;
    customPrimaryColor: string | null;
    setCustomPrimaryColor: (color: string | null) => void;
    styles: any;
  };
  

const HamburgerMenu = ({
  visible,
  onClose,
  isDarkMode,
  setIsDarkMode,
  customPrimaryColor,
  setCustomPrimaryColor,
  styles,
}: Props) => {
  if (!visible) return null;

  return (
    <View style={styles.menuContainer}>
      <Text style={styles.menuItem}>版本: v1.2.9</Text>

      <TouchableOpacity
        onPress={() => { onClose(); setIsDarkMode(!isDarkMode); }}
        style={styles.menuItemButton}
      >
        <Text style={styles.menuItem}>
          {isDarkMode ? '切換淺色模式' : '切換深色模式'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.menuHeader}>主題顏色</Text>
      <View style={styles.colorOptionsContainer}>
        <TouchableOpacity
          style={[
            styles.colorOption,
            { backgroundColor: isDarkMode ? darkTheme.primary : lightTheme.primary },
            !customPrimaryColor && styles.selectedColor
          ]}
          onPress={() => { onClose(); setCustomPrimaryColor(null); }}
        />
        {Object.entries(additionalColors).map(([name, color]) => (
          <TouchableOpacity
            key={name}
            style={[
              styles.colorOption,
              { backgroundColor: color },
              customPrimaryColor === color && styles.selectedColor
            ]}
            onPress={() => { onClose(); setCustomPrimaryColor(color); }}
          />
        ))}
      </View>
    </View>
  );
};

export default HamburgerMenu;
