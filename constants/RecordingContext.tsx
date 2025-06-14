// constants/RecordingContext.tsx
import React, { createContext, useState, useContext } from 'react';
import { RecordingItem } from '../utils/audioHelpers';

type RecordingContextType = {
  recordings: RecordingItem[];
  setRecordings: React.Dispatch<React.SetStateAction<RecordingItem[]>>;
};

const RecordingContext = createContext<RecordingContextType | undefined>(undefined);

export const RecordingProvider = ({ children }: { children: React.ReactNode }) => {
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  return (
    <RecordingContext.Provider value={{ recordings, setRecordings }}>
      {children}
    </RecordingContext.Provider>
  );
};

export const useRecordingContext = () => {
  const context = useContext(RecordingContext);
  if (!context) throw new Error("useRecordingContext must be used within RecordingProvider");
  return context;
};
