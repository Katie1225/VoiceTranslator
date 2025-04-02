//RecorderContext.js
import React, { createContext, useState, useRef, useEffect } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Alert, AppState } from 'react-native';

export const RecorderContext = createContext();

export const RecorderProvider = ({ children }) => {
  const [recording, setRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordings, setRecordings] = useState([]);
  const maxRecordingTime = 30 * 60;

  const timerRef = useRef(null);
  const durationRef = useRef(0);

  const startRecording = async () => {
    if (isRecording) return;
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) throw new Error('麥克風權限被拒絕');

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);

      setRecording(recording);
      setIsRecording(true);
      setRecordingDuration(0);
      durationRef.current = 0;

      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setRecordingDuration(durationRef.current);
        if (durationRef.current >= maxRecordingTime) {
          stopRecording(true);
        }
      }, 1000);

    } catch (err) {
      Alert.alert('錄音失敗', err.message);
    }
  };

  const stopRecording = async (showAlert = false) => {
    try {
      if (!recording) return;
      if (timerRef.current) clearInterval(timerRef.current);

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const now = new Date();
      const formattedName = `錄音_${now.toISOString().replace(/[:.]/g, '-')}.wav`;

      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (fileInfo.exists) {
        setRecordings(prev => [{ uri, name: formattedName }, ...prev]);
      }

      if (showAlert) {
        Alert.alert('時間已到', '單次錄音最長30分鐘，此次錄音已自動存檔。');
      }
    } catch (err) {
      Alert.alert('錄音停止失敗', err.message);
    } finally {
      setIsRecording(false);
      setRecording(null);
      setRecordingDuration(0);
      durationRef.current = 0;
    }
  };

  const remainingTime = maxRecordingTime - recordingDuration;

  return (
    <RecorderContext.Provider
      value={{
        isRecording,
        recordings,
        recordingDuration,
        remainingTime,
        startRecording,
        stopRecording,
        setRecordings,
      }}
    >
      {children}
    </RecorderContext.Provider>
  );
};
