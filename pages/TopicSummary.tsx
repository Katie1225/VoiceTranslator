// TopicSummaryPage.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useTheme } from '../constants/ThemeContext';
import { summarizeWithMode, RecordingItem } from '../utils/audioHelpers';
import RecorderHeader from '@/components/RecorderHeader';
import { useTranslation } from '../constants/i18n';

export default function TopicSummaryPage() {
  const route = useRoute();
  const navigation = useNavigation();
  const { styles, colors } = useTheme();
  const { t } = useTranslation();
  
  const { items, keyword } = route.params as {
    items: RecordingItem[];
    keyword: string;
  };

  const [summary, setSummary] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // 下面 debug
  useEffect(() => {
    setLoading(false); // 🔧 加這行看看畫面能否顯示 text
  }, []);

  const text = items
    .map(item => {
      const lines: string[] = [];

      if (!item.displayName) return null;
      lines.push(`🎙️ ${t('record')}: ${item.displayName}`);

      if (item.summaries?.summary) {
        lines.push(`🧠 ${t('toolbox')}:\n${item.summaries.summary}`);
      } else if (item.transcript) {
        lines.push(`📝 ${t('transcript')}:\n${item.transcript}`);
      } else if (item.notes) {
        lines.push(`✍️ ${t('notes')}:\n${item.notes}`);
      }

      // ✅ 加入子音檔內容
      if (item.derivedFiles?.splitParts?.length) {
        item.derivedFiles.splitParts.forEach((part, idx) => {
          const label = part.displayName || `${t('splitPart')} ${idx + 1}`;
          const content =
            part.notes?.trim()
              ? `✍️ ${label} ${t('notes')}:\n${part.notes}`
              : part.transcript?.trim()
                ? `📝 ${label} ${t('transcript')}:\n${part.transcript}`
                : null;

          if (content) {
            lines.push(content);
          }
        });
      }

      return lines.join('\n\n');
    })
    .filter(Boolean)
    .join('\n\n──────────────\n\n');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <RecorderHeader
          mode="detail"
          title={`「${keyword}」${t('summary')}`}
          onBack={() => navigation.goBack()}
        />

        {loading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{
                padding: 16,
                backgroundColor: colors.container,
              }}
            >
              <Text style={styles.transcriptText} selectable>{text}</Text>
            </ScrollView>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}