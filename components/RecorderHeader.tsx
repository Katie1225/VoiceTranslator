import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Platform, Image } from 'react-native';
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';
import { useTheme } from '../constants/ThemeContext';
import { APP_TITLE } from '../constants/variant';
import { useTranslation } from '../constants/i18n';
import { useNavigation } from '@react-navigation/native';

interface RecorderHeaderProps {
  mode?: 'main' | 'detail';
  title?: string;
  onBack?: () => void;
  onDelete?: () => void;  // 改為清除用
  onCloseAllMenus?: () => void;
  searchQuery?: string;
  setSearchQuery?: (s: string) => void;
  rightSlot?: React.ReactNode;
  setIsLoggingIn?: (v: boolean) => void;
  autoPlayEnabled?: boolean;
  toggleAutoPlay?: () => void;
  onToggleLayout?: () => void;
  onSwapLanguages?: () => void;
    isLanguageSwapped?: boolean;
}

const RecorderHeader: React.FC<RecorderHeaderProps> = (props) => {
  const noop = () => { };
  const defaultStr = '';
  const { t } = useTranslation();
  const {
    mode,
    onBack,
    title,
    onDelete = noop, // 現在是清除按鈕要用的函式
    onCloseAllMenus = noop,
    rightSlot,
    autoPlayEnabled = false,
    toggleAutoPlay,
    onToggleLayout,
    onSwapLanguages,
     isLanguageSwapped = false,
  } = props;
  const { colors } = useTheme();
  const navigation = useNavigation();

  const [isPressed, setIsPressed] = useState(false);

  const handleSwapPress = () => {
    // 按下時變色
    setIsPressed(true);
    props.onSwapLanguages?.();

  };


  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          alignSelf: 'stretch',
          paddingHorizontal: 14,
          paddingVertical: 8,
          backgroundColor: colors.container,
          borderTopWidth: 1,
          borderTopColor: colors.primary,
          borderBottomWidth: 1,
          borderBottomColor: colors.primary,
        }}
      >
        {/* 左側按鈕區塊 */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {mode === 'detail' ? (
            <TouchableOpacity onPress={onBack}>
              <Icon name="arrow-left" size={30} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => navigation.navigate('MenuPage' as never)}>
              <Icon name="menu" size={34} color={colors.primary} />
            </TouchableOpacity>
          )}

          <Text
            numberOfLines={1}
            style={{
              fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif-medium',
              marginLeft: 10,
              fontSize: 20,
              fontWeight: '500',
              color: colors.text,
            }}
          >
            {title || APP_TITLE}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>

          <TouchableOpacity onPress={() => navigation.navigate('LanguagePage' as never)}>
            <Icon name="triangle" size={20} color={colors.primary} style={{ transform: [{ rotate: '180deg' }] }} />
          </TouchableOpacity>

          {/* 🔄 語言交換按鈕 */}
          {props.onSwapLanguages && (
            <TouchableOpacity onPress={handleSwapPress}>
              <View style={{ padding: 6 }}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 4,
                    backgroundColor: isLanguageSwapped ? colors.primary : colors.container,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  {/* 安全的圖片渲染 */}
                  <Image
                    source={require('../assets/translate_swap3.png')}
                    style={{
                      width: 34,
                      height: 34,
                      tintColor: isLanguageSwapped ? colors.background : colors.primary,
                      resizeMode: 'contain',
                    }}
                    onError={(e) => console.log('圖片載入失敗:', e.nativeEvent.error)}
                  />
                </View>
              </View>
            </TouchableOpacity>
          )}

          {toggleAutoPlay && (
            <TouchableOpacity onPress={toggleAutoPlay}>
              <Icon
                name={autoPlayEnabled ? 'volume-high' : 'volume-off'}
                size={28}
                color={colors.primary}
              />
            </TouchableOpacity>
          )}

          {onDelete !== noop && (
            <TouchableOpacity onPress={onDelete}>
              <Icon name="delete-outline" size={30} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>


      </View>
    </>
  );
};

export default RecorderHeader;
