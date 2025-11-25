//pages/LanguagePage.tsx

import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  TextInput,
  ScrollView 
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../constants/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { getAvailableLanguages, getDeviceLanguage, LanguageCode } from '../constants/languages';
import { useTranslation } from '../constants/i18n'; 
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';

export default function LanguagePage() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [selectedLang, setSelectedLang] = useState<LanguageCode>('en');
  const [searchText, setSearchText] = useState('');
  const [allLanguages, setAllLanguages] = useState(getAvailableLanguages());
  const { t } = useTranslation();
  
  
  useEffect(() => {
    (async () => {
      const storedLang = await AsyncStorage.getItem('targetLang');
      if (storedLang) {
        setSelectedLang(storedLang as LanguageCode);
      } else {
        const deviceLang = getDeviceLanguage();
        setSelectedLang(deviceLang);
      }
    })();
  }, []);

  // 搜尋過濾功能
  useEffect(() => {
    if (searchText.trim() === '') {
      setAllLanguages(getAvailableLanguages());
    } else {
      const filtered = getAvailableLanguages().filter(lang => 
        lang.englishName.toLowerCase().includes(searchText.toLowerCase()) ||
        lang.label.toLowerCase().includes(searchText.toLowerCase()) ||
        lang.value.toLowerCase().includes(searchText.toLowerCase())
      );
      setAllLanguages(filtered);
    }
  }, [searchText]);

  const handleSelectLang = async (lang: LanguageCode) => {
    setSelectedLang(lang);
    await AsyncStorage.setItem('targetLang', lang);
    navigation.goBack();
  };

  const clearSearch = () => {
    setSearchText('');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* 返回箭頭和搜尋條在同一行 */}
      <View style={styles.topBar}>
        {/* 返回箭頭 */}
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={40} color={colors.primary} />
        </TouchableOpacity>
        
        {/* 搜尋條 */}
        <View style={[styles.searchContainer, { backgroundColor: colors.container }]}>
          <Icon name="magnify" size={20} color={colors.subtext} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
  placeholder={t('searchPlaceholder')} 
            placeholderTextColor={colors.subtext}
            value={searchText}
            onChangeText={setSearchText}
            returnKeyType="search"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={clearSearch} style={styles.clearButton}>
              <Icon name="close-circle" size={20} color={colors.subtext} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 語言列表 */}
      <ScrollView 
        style={styles.listContainer}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={true}
      >
        {allLanguages.length > 0 ? (
          allLanguages.map((lang) => (
            <TouchableOpacity
              key={lang.value}
              style={[
                styles.item,
                { borderColor: colors.primary },
                selectedLang === lang.value && { backgroundColor: colors.primary + '33' },
              ]}
              onPress={() => handleSelectLang(lang.value)}
            >
              <Text
                style={{
                  fontSize: 18,
                  color: selectedLang === lang.value ? colors.primary : colors.text,
                }}
              >
                {lang.label}
              </Text>
            </TouchableOpacity>
          ))
        ) : (
          // 沒有搜尋結果時顯示
          <View style={styles.noResults}>
            <Icon name="magnify-close" size={40} color={colors.subtext} />
            <Text style={[styles.noResultsText, { color: colors.subtext }]}>
              找不到符合的語言
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 20, // 為狀態欄留出空間
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingBottom: 10,
  },
  backButton: {
    padding: 8,
    marginRight: 10,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 4,
  },
  clearButton: {
    padding: 4,
  },
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  item: {
    padding: 10,
    borderWidth: 1,
    borderRadius: 10,
    marginVertical: 6,
  },
  noResults: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  noResultsText: {
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
});