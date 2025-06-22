// TopicSummaryPage.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useTheme } from '../constants/ThemeContext';
import { summarizeWithMode, RecordingItem } from '../utils/audioHelpers';
import RecorderHeader from '@/components/RecorderHeader';

export default function TopicSummaryPage() {
  const route = useRoute();
  const navigation = useNavigation();
  const { styles, colors } = useTheme();

  const { items, keyword } = route.params as {
    items: RecordingItem[];
    keyword: string;
  };

  const [summary, setSummary] = useState<string>('');
  const [loading, setLoading] = useState(true);
/*
  useEffect(() => {
    const runSummary = async () => {
      try {
        const text = items
          .map(item => [item.displayName, item.transcript, item.notes].filter(Boolean).join('\n'))
          .join('\n\n');
        const prompt = `以下是關於「${keyword}」的所有錄音內容：\n\n${text}\n\n請根據這些內容產出統整摘要，包含：\n1. 主題摘要\n2. 事件時間軸\n3. 關鍵標籤\n4. 建議行動`;

        const result = await summarizeWithMode({ transcript: prompt } as any, 'summary');
        setSummary(result);
      } catch (err) {
        Alert.alert('AI 分析失敗', (err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    runSummary();
  }, []); */
  // 下面 debug
useEffect(() => {
  setLoading(false); // 🔧 加這行看看畫面能否顯示 text
}, []);

const text = items
  .map(item => {
    const lines = [];

    if (!item.displayName) return null;

    lines.push(`🎙️ ${item.displayName}`);

    if (item.summaries?.summary) {
      lines.push(`🧠 AI工具箱重點整理:\n${item.summaries.summary}`);
    } else if (item.transcript) {
      lines.push(`📝 錄音文檔:\n${item.transcript}`);
    } else if (item.notes) {
      lines.push(`✍️ 談話筆記:\n${item.notes}`);
    } else {
      return null; // 什麼都沒有就不顯示這筆
    }

    return lines.join('\n\n');
  })
  .filter(Boolean) // 移除 null
  .join('\n\n──────────────\n\n');
// debug 結束
  return (
<View style={{ flex: 1, backgroundColor: colors.background}}>
  <RecorderHeader
  mode="detail" 
    title={`「${keyword}」重點整理`}
    onBack={() => navigation.goBack()}
  />

      {loading ? (
        <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 40 }} />
      ) : (
<ScrollView
  contentContainerStyle={{
    padding: 16,
    backgroundColor: colors.container,

  }}
>
  <Text style={styles.transcriptText}>{text}</Text>
</ScrollView>
      )}
    </View>
  );
}
