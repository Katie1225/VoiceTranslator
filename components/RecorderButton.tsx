// components/RecorderButton.tsx
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

type Props = {
  recording: boolean;
  recordingTime: number;
  onStart: () => void;
  onStop: () => void;
  styles: any;
  colors: any;
  title?: string; 
};

const formatTime = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
};

const RecorderButton = ({ recording, recordingTime, onStart, onStop, styles, colors, title, }: Props) => (
  <View style={[styles.recordSection, { flexDirection: 'row', alignItems: 'center', justifyContent:  'flex-start' }]}>
    <Text style={{ color: colors.primary, marginRight: 12 , marginLeft: 12 ,fontSize: 26,fontWeight: '500',fontStyle: 'italic' }}>
      {recording ? `⏱ ${formatTime(recordingTime * 1000)}` : title}
    </Text>
    <TouchableOpacity
      style={recording ? styles.stopButton : styles.recordButton}
      onPress={recording ? onStop : onStart}
    >
      <Text style={styles.buttonText}>
        {recording ? '停止錄音' : '開始錄音'}
      </Text>
    </TouchableOpacity>
  </View>
);

export default RecorderButton;
