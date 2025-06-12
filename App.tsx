// App.tsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// 直接定義 APP_VARIANT（可以手動切換）
import { APP_VARIANT } from './constants/variant';
import { ThemeProvider } from './constants/ThemeContext';
import RecorderPageVoiceNote from './pages/VoiceNote';
import NoteDetailPage from './components/NoteDetailPage'; 

const variantMap: Record<string, React.FC> = {
  note: RecorderPageVoiceNote,
  clamp: RecorderPageVoiceNote,
  notedebug: RecorderPageVoiceNote,
};

// 若輸入無效，預設用 VoiceNote
const SelectedPage = variantMap[APP_VARIANT] || (() => {
  console.warn(`⚠️ APP_VARIANT '${APP_VARIANT}' 無效，已使用預設 'note'`);
  return RecorderPageVoiceNote;
})();

export type RootStackParamList = {
  RecorderPage: undefined;
  NoteDetail: {
    item: any;
    index: number;
    type: 'transcript' | 'summary' | 'notes';
    summaryMode?: 'summary' | 'tag' | 'action'; // ✅ 加這行
  };
};


const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <ThemeProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="RecorderPage" screenOptions={{ headerShown: false }}>
          <Stack.Screen name="RecorderPage" component={RecorderPageVoiceNote} />
          <Stack.Screen name="NoteDetail" component={NoteDetailPage} />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>
  );
}