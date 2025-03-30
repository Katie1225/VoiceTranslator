import { View } from 'react-native';
import AudioRecorder from '../../components/AudioRecorder';

export default function Home() {
  return (
    <View style={{ flex: 1 }}>
      <AudioRecorder />
    </View>
  );
}