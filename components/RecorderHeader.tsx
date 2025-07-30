// components/RecorderHeader.tsx
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';
import HamburgerMenu from './HamburgerMenu';
import { useTheme } from '../constants/ThemeContext';
import { handleLogin } from '../utils/loginHelpers';
import { Platform } from 'react-native';
import { APP_TITLE } from '../constants/variant';
import { useTranslation } from '../constants/i18n';

interface RecorderHeaderProps {
  mode?: 'main' | 'detail';
  title?: string;
  onBack?: () => void;
  onPickAudio?: () => void;
  onCloseAllMenus?: () => void;
  sortOption?: 'latest' | 'oldest' | 'size' | 'name-asc' | 'name-desc'| 'starred';
  setSortOption?: (opt: any) => void;
  searchQuery?: string;
  setSearchQuery?: (s: string) => void;
  rightSlot?: React.ReactNode;
  setIsLoggingIn?: (v: boolean) => void;
}



const RecorderHeader: React.FC<RecorderHeaderProps> = (props) => {
  const noop = () => { };
  const defaultStr = '';
const { t } = useTranslation(); 
const labelMap: Record<string, string> = {
  latest: t('sortNewest'),
  oldest: t('sortOldest'),
  size: t('sortBySize'),
  'name-asc': t('sortByName'),
'name-desc': t('sortByNameDesc'),
starred: t('sortByFavoriteStar'),
};
  const {
    mode,
    onBack,
    title,
    onPickAudio = noop,
    onCloseAllMenus = noop,
    sortOption = 'latest',
    setSortOption = noop,
    searchQuery = defaultStr,
    setSearchQuery = noop,
    rightSlot = noop,
    setIsLoggingIn = noop,
  } = props;
  const { colors } = useTheme();
  const [menuVisible, setMenuVisible] = useState(false);
  const [isSortModalVisible, setIsSortModalVisible] = useState(false);
  const [isSearchModalVisible, setIsSearchModalVisible] = useState(false);

  const toggleSort = () => {
    onCloseAllMenus();
    setIsSortModalVisible((v) => !v);
  };

  const toggleSearch = () => {
    onCloseAllMenus();
    setIsSearchModalVisible((v) => !v);
  };

  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 8,
          backgroundColor: colors.container,
          borderBottomWidth: 2,
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
            <TouchableOpacity onPress={() => setMenuVisible(!menuVisible)}>
              <Icon name="menu" size={34} color={colors.primary} />
            </TouchableOpacity>
          )}

          <Text
            numberOfLines={1}
            style={{
              fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif-medium',
              marginLeft: 10,
              fontSize: 20,
              fontWeight: '600',
              color: colors.text,
            }}
          >
            {title || APP_TITLE}
          </Text>
        </View>

        {/* 右側操作按鈕 */}
{props.rightSlot ? (
  <View>{props.rightSlot}</View>
) : (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
    <TouchableOpacity onPress={toggleSearch}>
      <Icon name="magnify" size={30} color={colors.primary} />
    </TouchableOpacity>

    {mode !== 'detail' && (
      <>
        <TouchableOpacity onPress={toggleSort}>
          <Icon name="sort" size={30} color={colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity onPress={onPickAudio}>
          <Icon name="folder" size={30} color={colors.primary} />
        </TouchableOpacity>
      </>
    )}
  </View>
)}


        {mode !== 'detail' && (
          <HamburgerMenu
            visible={menuVisible}
            onClose={() => setMenuVisible(false)}
            onLoginPress={async () => {
              const result = await handleLogin(setIsLoggingIn);
              if (result) {
                return new Promise((resolve) => {
                  resolve(true);
                  setMenuVisible(false);
                });
              }
              return false;
            }}
            onLoginSuccess={() => setMenuVisible(false)}
          />
        )}

      </View>

      {isSortModalVisible && (
        <View
          style={{
            position: 'absolute',
            top: 55,
            left: 100,
            right: 10,
            backgroundColor: colors.container,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            borderColor: colors.primary,
            padding: 12,
            elevation: 10,
            zIndex: 999,
          }}
        >
          <Text style={{ fontSize: 12, color: colors.subtext, marginBottom: 4 }}>
 {`${t('currentSort')}：${labelMap[sortOption]}`}
          </Text>
          <View style={{ height: 12 }} />
          <Text
            style={{
              color: colors.text,
              fontSize: 16,
              fontWeight: 'bold',
              marginBottom: 8,
            }}
          >
            {t('chooseSort')}
          </Text>

          {Object.entries(labelMap).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={{
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderColor: colors.border || '#444',
              }}
              onPress={() => {
                setSortOption(key as any);
                // setIsSortModalVisible(false);
              }}
            >
              <Text
                style={{
                  color: sortOption === key ? colors.primary : colors.text,
                  fontWeight: sortOption === key ? 'bold' : 'normal',
                }}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>

            <TouchableOpacity
              onPress={() => {
                setSortOption?.('latest'); // ✅ 清回預設排序（可改成你預設想要的）
                setIsSortModalVisible(false);
              }}
              style={{ paddingVertical: 10, flex: 1, alignItems: 'center' }}
            >
              <Text style={{ color: colors.subtext }}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setIsSortModalVisible(false)}
              style={{ paddingVertical: 10, flex: 1, alignItems: 'center' }}
            >
              <Text style={{ color: colors.primary }}>{t('confirm')}</Text>
            </TouchableOpacity>


          </View>
        </View>
      )}

      {isSearchModalVisible && (
        <View
          style={{
            position: 'absolute',
            top: 55,
            left: 100,
            right: 10,
            backgroundColor: colors.container,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            borderColor: colors.primary,
            padding: 12,
            elevation: 10,
            zIndex: 999,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 16,
              fontWeight: 'bold',
              marginBottom: 8,
            }}
          >
 {mode === 'detail' ? t('searchContent') : t('searchPlaceholder')}
          </Text>

          <TextInput
            placeholder={t('enterKeyword')}
            placeholderTextColor="#888"
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={{
              borderColor: colors.primary,
              borderWidth: 1,
              padding: 10,
              borderRadius: 8,
              color: colors.text,
              backgroundColor: colors.background,
              marginBottom: 16,
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>

            <TouchableOpacity
              onPress={() => {
                setIsSearchModalVisible(false);
                setSearchQuery?.(''); // ✅ 清空搜尋欄內容
              }}
              style={{ paddingVertical: 10, flex: 1, alignItems: 'center' }}
            >
              <Text style={{ color: colors.subtext }}>{t('cancel')}</Text>

            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setIsSearchModalVisible(false)}
              style={{ paddingVertical: 10, flex: 1, alignItems: 'center' }}
            >
              <Text style={{ color: colors.primary }}>{t('confirm')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );
};

export default RecorderHeader;
