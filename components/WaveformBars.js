import React from 'react';
import { View } from 'react-native';

const WaveformBars = ({ waveform = [], color = '#3b64ce', height = 40 }) => {
  return (
    <View style={{ flexDirection: 'row', height, alignItems: 'flex-end' }}>
      {waveform.map((v, i) => (
        <View
          key={i}
          style={{
            width: 2,
            height: v * height,
            backgroundColor: color,
            marginHorizontal: 1,
            borderRadius: 1,
          }}
        />
      ))}
    </View>
  );
};

export default WaveformBars;
