// App.tsx
import { APP_VARIANT } from './constants/AppVariant';
import RecorderPageVoiceNote from './pages/VoiceNote';
import RecorderPageVoiceClamp from './pages/VoiceClamp';

const variantMap: Record<string, React.FC> = {
  note: RecorderPageVoiceNote,
  clamp: RecorderPageVoiceClamp,
};

// ✅ 若輸入無效，預設用 VoiceNote，並印出警告
const SelectedPage = variantMap[APP_VARIANT] || (() => {
  console.warn(`⚠️ APP_VARIANT '${APP_VARIANT}' 無效，已使用預設 'note'`);
  return RecorderPageVoiceNote;
})();

export default function App() {
  return <SelectedPage />;
}
