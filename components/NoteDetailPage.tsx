import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import Sound from 'react-native-sound';
import { useTheme } from '../constants/ThemeContext';
import RecorderHeader from '../components/RecorderHeader';



export default function NoteDetailPage() {
  const route = useRoute();
  const navigation = useNavigation();
  const { styles, colors } = useTheme();

const { item, index, type: initialType, summaryMode: initialSummaryMode } = route.params as {
  item: any;
  index: number;
  type: 'transcript' | 'summary' | 'notes';
  summaryMode?: 'summary' | 'tag' | 'action';
};


  const [summaryMode, setSummaryMode] = useState(initialSummaryMode || 'summary');

  const [viewType, setViewType] = useState(initialType);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [sound, setSound] = useState<Sound | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // 初始化音檔
  useEffect(() => {
    const s = new Sound(item.uri, '', (error) => {
      if (!error) {
        setDuration(s.getDuration() * 1000);
      }
    });
    setSound(s);

    return () => {
      s.release();
    };
  }, []);

  useEffect(() => {
    if (isPlaying && sound) {
      const interval = setInterval(() => {
        sound.getCurrentTime((sec) => {
          setPosition(sec * 1000);
        });
      }, 300);
      return () => clearInterval(interval);
    }
  }, [isPlaying, sound]);

  const togglePlay = () => {
    if (!sound) return;
    if (isPlaying) {
      sound.pause();
      setIsPlaying(false);
    } else {
      sound.play(() => {
        setIsPlaying(false);
        setPosition(0);
      });
      setIsPlaying(true);
    }
  };

  const formatTime = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}:${rem.toString().padStart(2, '0')}`;
  };

  const content =
    viewType === 'transcript'
      ? item.transcript || ''
      : viewType === 'summary'
      ? item.summaries?.summary || ''
      : item.notes || '';

  const handleSave = () => {
    console.log(`儲存 ${viewType}:`, editValue);
    setIsEditing(false);
  };

  return (
    <View style={[styles.container, { paddingTop: 50, paddingHorizontal: 16 }]}>
      {/* Header */}
<RecorderHeader
  mode="detail"
  title={item.displayName}
  onBack={() => navigation.goBack()}
/>

      {/* 播放列 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <TouchableOpacity onPress={togglePlay}>
          <Text style={{ fontSize: 24, marginRight: 12 }}>{isPlaying ? '❚❚' : '▶'}</Text>
        </TouchableOpacity>
        <Slider
          minimumValue={0}
          maximumValue={duration}
          value={position}
          onSlidingComplete={(value) => {
            if (sound) {
              sound.setCurrentTime(value / 1000);
              setPosition(value);
            }
          }}
          style={{ flex: 1 }}
        />
        <Text style={{ marginLeft: 8 }}>{formatTime(position)}</Text>
      </View>

      {/* 三顆切換按鈕 */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 12 }}>
        {['transcript', 'summary', 'notes'].map((key) => (
          <TouchableOpacity
            key={key}
            onPress={() => {
              setViewType(key as any);
              setIsEditing(false);
            }}
            style={{
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: 8,
              backgroundColor: viewType === key ? colors.primary : colors.primary + '55',
            }}
          >
            <Text style={{ color: 'white' }}>
              {key === 'transcript' ? '錄音文檔' : key === 'summary' ? 'AI摘要' : '談話筆記'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 內容區塊 */}
      {isEditing ? (
        <>
          <ScrollView keyboardShouldPersistTaps="handled">
            <TextInput
              value={editValue}
              onChangeText={setEditValue}
              multiline
              style={{
                padding: 12,
                fontSize: 16,
                color: colors.text,
                borderWidth: 1,
                borderColor: colors.primary,
                borderRadius: 8,
                textAlignVertical: 'top',
              }}
              autoFocus
            />
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
            <TouchableOpacity onPress={handleSave}>
              <Text style={styles.transcriptActionButton}>💾 儲存</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsEditing(false)}>
              <Text style={styles.transcriptActionButton}>✖️ 取消</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <ScrollView>
            <Text style={styles.transcriptText}>{content}</Text>
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
            <TouchableOpacity onPress={() => {
              setEditValue(content);
              setIsEditing(true);
            }}>
              <Text style={styles.transcriptActionButton}>✏️ 修改</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}
