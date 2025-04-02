// 📁 src/components/RecordingIndicator.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import useRecorder from '../hooks/useRecorder';

const RecordingIndicator = () => {
  const { isRecording, recordingDuration } = useRecorder();

  if (!isRecording) return null;

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.dot} />
      <Text style={styles.text}>錄音中 {formatTime(recordingDuration)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 40,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    zIndex: 9999,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'red',
    marginRight: 6,
  },
  text: {
    color: 'white',
    fontSize: 12,
  },
});

export default RecordingIndicator;