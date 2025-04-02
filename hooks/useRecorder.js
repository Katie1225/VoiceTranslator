// 📁 src/hooks/useRecorder.js
import { useContext } from 'react';
import { RecorderContext } from '../components/context/RecorderContext';

const useRecorder = () => {
  const context = useContext(RecorderContext);

  if (!context) {
    throw new Error('useRecorder 必須在 RecorderProvider 中使用');
  }

  return context;
};

export default useRecorder;
