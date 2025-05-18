// App.tsx

// 直接定義 APP_VARIANT（可以手動切換）
import { APP_VARIANT } from './constants/variant';

import RecorderPageVoiceNote from './pages/VoiceNote';

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

export default function App() {
  return <SelectedPage />;
}
