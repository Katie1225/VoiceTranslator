// components/RecorderHeader.tsx
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';
import HamburgerMenu from './HamburgerMenu';
import { useTheme } from '../constants/ThemeContext';
import { handleLogin } from '../utils/loginHelpers';
import { Platform } from 'react-native';

interface RecorderHeaderProps {
  mode?: 'main' | 'detail';
  title?: string;
  onBack?: () => void;

  onPickAudio?: () => void;
  onCloseAllMenus?: () => void;
  sortOption?: 'latest' | 'oldest' | 'size' | 'name-asc' | 'name-desc';
  setSortOption?: (opt: any) => void;
  searchQuery?: string;
  setSearchQuery?: (s: string) => void;
  setIsLoggingIn?: (v: boolean) => void;
}

const labelMap: Record<string, string> = {
  latest: '最新在上',
  oldest: '最舊在上',
  size: '依大小排序',
  'name-asc': '名稱 A → Z',
  'name-desc': '名稱 Z → A',
};

const RecorderHeader: React.FC<RecorderHeaderProps> = (props) => {
  const noop = () => {};
  const defaultStr = '';

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
       {mode === 'detail' ? (
      // ✅ 詳細頁模式
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 10,
          paddingVertical: 8,
          backgroundColor: colors.container,
          borderBottomWidth: 2,
          borderBottomColor: colors.primary,
        }}
      >
        <TouchableOpacity onPress={onBack}>
          <Icon name="arrow-left" size={30} color={colors.primary} />
        </TouchableOpacity>

        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            marginLeft: 12,
            fontSize: 20,
            fontWeight: '600',
            color: colors.text,
          }}
        >
          {title || '詳細內容'}
        </Text>
      </View>
    ) : (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 10,
          paddingVertical: 8,
          backgroundColor: colors.container,
          borderBottomWidth: 2,
          borderBottomColor: colors.primary,
        }}
      >
        <TouchableOpacity onPress={() => setMenuVisible(!menuVisible)}>
          <Icon name="menu" size={34} color={colors.primary} />
        </TouchableOpacity>

        <Text
          numberOfLines={1}
          style={{
            fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif-medium' ,
            flex: 1,
            marginLeft: 10,
            fontSize: 20,
            fontWeight: '600',
            color: colors.text,
          }}
        >
          Voice Note
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>

                    <TouchableOpacity onPress={toggleSearch}>
            <Icon name="magnify" size={30} color={colors.primary} />
          </TouchableOpacity>


          <TouchableOpacity onPress={toggleSort}>
            <Icon name="sort" size={30} color={colors.primary} />
          </TouchableOpacity>

                    <TouchableOpacity onPress={onPickAudio}>
            <Icon name="folder" size={30} color={colors.primary} />
          </TouchableOpacity>


        </View>

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
      </View>
)}
      {isSortModalVisible && (
        <View
          style={{
            position: 'absolute',
            top: 70,
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
            目前排序：{labelMap[sortOption]}
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
            選擇排序方式
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
                setIsSortModalVisible(false);
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

          <TouchableOpacity
            onPress={() => setIsSortModalVisible(false)}
            style={{ paddingVertical: 10, alignItems: 'center' }}
          >
            <Text style={{ color: colors.subtext }}>取消</Text>
          </TouchableOpacity>
        </View>
      )}

      {isSearchModalVisible && (
        <View
          style={{
            position: 'absolute',
            top: 70,
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
            搜尋錄音名稱
          </Text>

          <TextInput
            placeholder="輸入關鍵字"
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
          <TouchableOpacity
            onPress={() => setIsSearchModalVisible(false)}
            style={{ paddingVertical: 10, alignItems: 'center' }}
          >
            <Text style={{ color: colors.subtext }}>完成</Text>
          </TouchableOpacity>
        </View>
      )}
    
    </>
    
  );
};

export default RecorderHeader;
