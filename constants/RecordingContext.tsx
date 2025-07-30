// constants/RecordingContext.tsx
import React, { createContext, useState, useContext } from 'react';
import { RecordingItem } from '../utils/audioHelpers';


type RecordingContextType = {
  recordings: RecordingItem[];
  setRecordings: React.Dispatch<React.SetStateAction<RecordingItem[]>>;
  lastVisitedRecording: LastVisitedRecording;
  setLastVisitedRecording: React.Dispatch<React.SetStateAction<LastVisitedRecording>>;
  };

type LastVisitedRecording = {
  index: number;
  uri?: string;
  type?: 'transcript' | 'summary' | 'notes';
    isPlaying?: boolean; 
} | null;

const RecordingContext = createContext<RecordingContextType | undefined>(undefined);

export const RecordingProvider = ({ children }: { children: React.ReactNode }) => {
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [lastVisitedRecording, setLastVisitedRecording] = useState<LastVisitedRecording>(null);

  return (
    <RecordingContext.Provider value={{
      recordings,
      setRecordings,
      lastVisitedRecording,
      setLastVisitedRecording,
    }}>
      {children}
    </RecordingContext.Provider>
  );
};

export const useRecordingContext = () => {
  const context = useContext(RecordingContext);
  if (!context) throw new Error("useRecordingContext must be used within RecordingProvider");
  return context;
};
