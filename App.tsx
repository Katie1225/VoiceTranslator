// App.tsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { APP_VARIANT } from './constants/variant';
import { ThemeProvider } from './constants/ThemeContext';

import RecorderPageVoiceNote from './pages/VoiceNote';
import NoteDetailPage from './pages/NoteDetail';

import TopicSummaryPage from './pages/TopicSummary';
import { RecordingItem } from './utils/audioHelpers-new'; 
import { RecordingProvider } from './constants/RecordingContext';
import { LoginProvider } from './constants/LoginContext';

const variantMap: Record<string, React.FC> = {
  note: RecorderPageVoiceNote,
  clamp: RecorderPageVoiceNote,
  notedebug: RecorderPageVoiceNote,
};

const SelectedPage = variantMap[APP_VARIANT] || (() => {
  console.warn(`⚠️ APP_VARIANT '${APP_VARIANT}' 無效，已使用預設 'note'`);
  return RecorderPageVoiceNote;
})();

// ✅ 完整路由型別
export type RootStackParamList = {
  RecorderPage: undefined;
  NoteDetail: {
    index: number;
    type: 'notes' | 'transcript' | 'summary';
    summaryMode?: string;
    shouldTranscribe?: boolean; // 新增標記表示需要轉文字
  };
  TopicSummaryPage: {
    items: RecordingItem[];
    keyword: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
  <LoginProvider>
    <RecordingProvider>
      <ThemeProvider>
        <NavigationContainer>
          <Stack.Navigator initialRouteName="RecorderPage" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="RecorderPage" component={SelectedPage} />
            <Stack.Screen name="NoteDetail" component={NoteDetailPage} />
            <Stack.Screen name="TopicSummaryPage" component={TopicSummaryPage} />
          </Stack.Navigator>
        </NavigationContainer>
      </ThemeProvider>
    </RecordingProvider>
  </LoginProvider>
  );
}
