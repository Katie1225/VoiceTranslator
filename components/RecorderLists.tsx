// components/RecorderLists.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView, StatusBar,
  Alert,
  ActivityIndicator,
  TouchableWithoutFeedback,
  FlatList,
} from 'react-native';
import SoundLevel from 'react-native-sound-level';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import PlaybackBar from './PlaybackBar';
import { APP_TITLE, SEGMENT_DURATION, setSegmentDuration } from '../constants/variant';
import { useTranslation } from '../constants/i18n';

import {
  RecordingItem,
  splitAudioSegments,
  generateRecordingMetadata,
} from '../utils/audioHelpers';

import { useAudioPlayer } from '../utils/useAudioPlayer';

import MoreMenu from './MoreMenu';
import { debugLog, debugWarn, debugError } from '../utils/debugLog';
import { shareRecordingFile, saveEditedRecording, prepareEditing } from '../utils/editingHelpers';
import { useTheme } from '../constants/ThemeContext';
import { useRecordingContext } from '../constants/RecordingContext';

interface Props {
  items: RecordingItem[];
  searchQuery: string;
  setRecordings: React.Dispatch<React.SetStateAction<RecordingItem[]>>;
  isLoading: boolean;
  saveRecordings: (data: RecordingItem[]) => Promise<void>;
  safeDeleteFile: (uri: string) => Promise<void>;
  isSelectionMode: boolean;
  selectedItems: Set<string>;
  setIsSelectionMode: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedItems: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedPlayingIndex: number | null;
  setSelectedPlayingIndex: React.Dispatch<React.SetStateAction<number | null>>;
}

const RecorderLists: React.FC<Props> = ({
  items,
  searchQuery,
  setRecordings,
  isSelectionMode,
  isLoading,
  selectedItems,
  setIsSelectionMode,
  setSelectedItems,
  selectedPlayingIndex,
  setSelectedPlayingIndex,
  saveRecordings,
  safeDeleteFile,
}) => {
  const { colors, styles, isDarkMode } = useTheme();
  const {
    recordings,
    lastVisitedRecording,
    setLastVisitedRecording
  } = useRecordingContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const title = APP_TITLE;
  useKeepAwake();
  const { t } = useTranslation();

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isTranscribingIndex, setIsTranscribingIndex] = useState<number | null>(null);
  const [summarizingState, setSummarizingState] = useState<{ index: number; mode: string; } | null>(null);
  const [isEditingNotesIndex, setIsEditingNotesIndex] = useState<number | null>(null);
  const isAnyProcessing = isTranscribingIndex !== null || summarizingState !== null || isEditingNotesIndex !== null;
  const [summaryMode, setSummaryMode] = useState('summary');
  const [showNotesIndex, setShowNotesIndex] = useState<number | null>(null);
  const [playbackRates, setPlaybackRates] = useState<Record<string, number>>({});
  const [splittingUri, setSplittingUri] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const [selectedContext, setSelectedContext] = useState<{
    type: 'main' | 'enhanced' | 'trimmed';
    index: number;
    position: { x: number; y: number };
  } | null>(null);

  const [speedMenuIndex, setSpeedMenuIndex] = useState<number | null>(null);
  const [speedMenuPosition, setSpeedMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [showTranscriptIndex, setShowTranscriptIndex] = useState<number | null>(null);
  const [showSummaryIndex, setShowSummaryIndex] = useState<number | null>(null);
  const [selectedSplitContext, setSelectedSplitContext] = useState<{
    parentIndex: number;
    partUri: string;
    position: { x: number; y: number };
  } | null>(null);

  const [editingState, setEditingState] = useState<{
    type: 'transcript' | 'summary' | 'name' | 'notes' | null;
    index: number | null;
    text: string;
    mode?: string;
  }>({ type: null, index: null, text: '' });

  const {
    currentSound,
    isPlaying,
    playingUri,
    setPlayingUri,
    currentPlaybackRate,
    setPlaybackRate,
    playbackPosition,
    playbackDuration,
    playRecording,
    togglePlayback,
    setPlaybackPosition,
    stopPlayback,
  } = useAudioPlayer();

  // 修复播放逻辑 - 统一播放状态管理
  // 修复播放逻辑
  const handlePlayPause = async (uri: string, index: number) => {
    try {
      closeAllMenus();

      // 如果正在播放的是同一个文件，则暂停
      if (isPlaying && playingUri === uri) {
        await stopPlayback();
        setSelectedPlayingIndex(null);
      } else {
        // 停止当前播放并播放新的文件
        if (isPlaying) {
          await stopPlayback();
        }

        const rate = playbackRates[uri] ?? 1.0;

        // 修复：先播放，再设置速度
        await playRecording(uri); // 只传一个参数

        // 播放后设置速度
        if (currentSound) {
          currentSound.setSpeed(rate);
        }

        setSelectedPlayingIndex(index);
        setPlayingUri(uri);
      }
    } catch (error) {
      debugError('播放控制错误:', error);
      Alert.alert(t('playbackError'), t('playbackFailed'));
    }
  };

  // 修复播放条可见性逻辑
  const getPlaybackBarVisibility = (itemUri: string, index: number) => {
    // 如果正在播放这个项目，或者这个项目被选中，就显示播放条
    return (isPlaying && playingUri === itemUri) || selectedPlayingIndex === index;
  };

  // 修復文字摘要顯示邏輯 - 只顯示純文字，不要時間標籤
  const getDisplayText = (item: RecordingItem) => {
    // 優先顯示 notes，其次顯示 transcript
    if (item.notes?.trim()) {
      // 過濾掉時間標籤行（包含 "--" 的行）
      const lines = item.notes.split('\n').filter(line =>
        !line.includes('–') && !line.includes('--') && line.trim()
      );
      return lines.join('\n').trim();
    } else if (item.transcript?.trim()) {
      return item.transcript.trim();
    }
    return null;
  };

  // 修復長音檔文字摘要顯示 - 只顯示純文字
  const getMainItemDisplayText = (item: RecordingItem) => {
    const hasSplit = (item.derivedFiles?.splitParts?.length ?? 0) > 0;

    // 優先顯示 notes（過濾時間標籤）
    if (item.notes?.trim()) {
      const lines = item.notes.split('\n').filter(line =>
        !line.includes('–') && !line.includes('--') && line.trim()
      );
      return lines.join('\n').trim();
    }

    if (hasSplit) {
      // 長音檔：顯示第一個分段的 transcript
      return item.derivedFiles?.splitParts?.[0]?.transcript?.trim() || null;
    } else {
      // 短音檔：顯示 transcript
      return item.transcript?.trim() || null;
    }
  };
  const toggleExpand = async (uri: string) => {
    const found = recordings.find(r => r.uri === uri);
    if (!found) {
      debugWarn(`❌ toggleExpand：找不到錄音 uri: ${uri}`);
      return;
    }

    const hasSplit = !!found.derivedFiles?.splitParts?.length;

    if (!hasSplit) {
      if (splittingUri) {
        debugLog(`⏳ 分段處理中，忽略重複點擊: ${splittingUri}`);
        return;
      }

      setSplittingUri(uri);
      debugLog(`🪓 [分段展開] ${found.displayName} 尚未切段，開始切割`);

      try {
        const metadata = await generateRecordingMetadata(uri);
        const totalSec = Math.floor(metadata.durationSec);
        const segmentLength = SEGMENT_DURATION;
        const parts: RecordingItem[] = [];

        for (let start = 0; start < totalSec; start += segmentLength) {
          try {
            debugLog(`⏱ 嘗試分段：start=${start}s, duration=${segmentLength}s`);
            const part = await splitAudioSegments(uri, start, segmentLength, t, found.displayName);
            if (part) {
              if (!part.notes?.trim() && found.notes?.trim()) {
                part.notes = found.notes;
              }
              debugLog(`✅ 成功分段：${part.displayName}`);
              parts.push(part);
            }
          } catch (e) {
            debugError(`❌ 分段錯誤：start=${start}`, e);
          }
        }

        const temp = (found as any).tempNoteSegs || [];
        parts.forEach((p, i) => {
          p.notes = (temp[i]?.text || '').trim();
        });
        (found as any).tempNoteSegs = [];

        const updated = recordings.map(r =>
          r.uri === uri
            ? { ...r, derivedFiles: { ...r.derivedFiles, splitParts: parts } }
            : r
        );

        setRecordings(updated);
        await saveRecordings(updated);
        debugLog(`📦 分段完成，共 ${parts.length} 段`);
        setSplittingUri(null);
        setExpandedItems(prev => new Set([...prev, uri]));
      } catch (e) {
        debugError(`❌ 分段前 metadata 錯誤: ${uri}`, e);
        setSplittingUri(null);
      }
    } else {
      setExpandedItems(prev => {
        const copy = new Set(prev);
        copy.has(uri) ? copy.delete(uri) : copy.add(uri);
        return copy;
      });
    }
  };

  const resetEditingState = () => {
    setEditingState({ type: null, index: null, text: '' });
    setIsEditingNotesIndex(null);
  };

  const closeAllMenus = (options: {
    preserveEditing?: boolean;
    preserveSummaryMenu?: boolean;
  } = {}) => {
    const { preserveEditing = false, preserveSummaryMenu = false } = options;
    setSelectedIndex(null);
    setSpeedMenuIndex(null);
    setSelectedContext(null);

    if (!preserveEditing) {
      resetEditingState();
    }
  };

  const startEditing = (
    index: number,
    type: 'name' | 'transcript' | 'summary' | 'notes',
    uri?: string
  ) => {
    const editing = prepareEditing(recordings, index, type, summaryMode, uri);
    if (editing) {
      setEditingState(editing);
      setSelectedIndex(null);
    } else {
      debugError('Failed to prepare editing state');
    }
  };

  const saveEditing = () => {
    if (editingState.type === 'name' && typeof editingState.index === 'number') {
      const newName = editingState.text?.trim() || '';
      if (!newName) return;

      const updated = [...recordings];
      const main = updated[editingState.index];
      if (!main) return;

      main.displayName = newName;

      const parts = main.derivedFiles?.splitParts;
      if (Array.isArray(parts)) {
        parts.forEach((part) => {
          const suffix = part.displayName?.split('|')[1]?.trim();
          part.displayName = suffix ? `${newName} | ${suffix}` : newName;
        });
      }

      setRecordings(updated);
      saveRecordings(updated);
      setEditingState({ type: null, index: null, text: '' });
      return;
    }

    const updated = saveEditedRecording(recordings, editingState, summaryMode);
    setRecordings(updated);
    saveRecordings(updated);
    setEditingState({ type: null, index: null, text: '' });
  };

  const deleteRecording = async (index: number) => {
    Alert.alert(
      t('deleteRecordingTitle'),
      t('deleteRecordingMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          onPress: async () => {
            closeAllMenus();
            try {
              const item = recordings[index];
              await safeDeleteFile(item.uri);
              if (item.derivedFiles?.enhanced?.uri) {
                await safeDeleteFile(item.derivedFiles.enhanced.uri);
              }
              if (item.derivedFiles?.trimmed?.uri) {
                await safeDeleteFile(item.derivedFiles.trimmed.uri);
              }
              if (item.derivedFiles?.splitParts?.length) {
                for (const part of item.derivedFiles.splitParts) {
                  await safeDeleteFile(part.uri);
                }
              }

              const updated = [...recordings];
              updated.splice(index, 1);
              setRecordings(updated);
              await saveRecordings(updated);
            } catch (err) {
              Alert.alert(t('deleteFailed'), (err as Error).message);
            }
          }
        }
      ]
    );
    setSelectedIndex(null);
  };

  const deleteSplitPart = (parentIndex: number, partUri: string) => {
    const updated = [...recordings];
    const parent = updated[parentIndex];
    if (!parent || !parent.derivedFiles?.splitParts) return;

    parent.derivedFiles.splitParts = parent.derivedFiles.splitParts.filter(
      (p: { uri: string; }) => p.uri !== partUri
    );

    setRecordings(updated);
    saveRecordings(updated);
  };

  // 修复：添加必要的 useEffect
  useEffect(() => {
    AsyncStorage.getItem('VN_SEGMENT_DURATION').then(v => {
      if (v) setSegmentDuration(Number(v));
    });
  }, []);

  useEffect(() => {
    if (lastVisitedRecording && flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: lastVisitedRecording.index,
          animated: true,
        });
      }, 400);

      if (lastVisitedRecording.uri) {
        const parent = recordings[lastVisitedRecording.index];
        if (parent && parent.derivedFiles?.splitParts?.some((p: { uri: string | undefined; }) => p.uri === lastVisitedRecording.uri)) {
          setExpandedItems(prev => new Set([...prev, parent.uri]));
        }
      }
    }
  }, [lastVisitedRecording]);

  useEffect(() => {
    return () => {
      SoundLevel.stop();
    };
  }, []);

  const visibleMiniType = (index: number) =>
    showNotesIndex === index ? 'notes' :
      showTranscriptIndex === index ? 'transcript' :
        showSummaryIndex === index ? 'summary' : null;

  return (
    <>
      <StatusBar
        backgroundColor={colors.container}
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
      />
      <TouchableWithoutFeedback onPress={() => closeAllMenus({ preserveEditing: false })}>
        <SafeAreaView style={[styles.container, { marginTop: 0, paddingTop: 0 }]}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>
                {Platform.OS === 'android' ? t('checkingPermissions') : t('loadingRecordings')}
              </Text>
            </View>
          ) : (
            <>
              {recordings.length === 0 ? (
                <View style={styles.emptyListContainer}>
                  <Text style={styles.emptyListText}>{t('noRecordings')}</Text>
                </View>
              ) : (
                <FlatList
                  ref={flatListRef}
                  onScroll={() => {
                    closeAllMenus({ preserveEditing: true });
                  }}
                  scrollEnabled={!editingState.type}
                  keyboardShouldPersistTaps="handled"
                  style={[styles.listContainer, {
                    marginTop: 40,
                    marginBottom: 90,
                  }]}
                  data={items}
                  keyExtractor={(item) => item.uri}
                  contentContainerStyle={{
                    paddingTop: 10,
                    paddingBottom: 20,
                  }}
                  initialNumToRender={10}
                  maxToRenderPerBatch={10}
                  windowSize={5}
                  removeClippedSubviews={true}
                  renderItem={({ item, index }) => {
                    const isThisPlaying = isPlaying && playingUri === item.uri;
                    const durationMs = (item?.durationSec ?? 0) * 1000;
                    const rateForThis = playbackRates[item.uri] ?? 1.0;
                    const parts = item.derivedFiles?.splitParts || [];
                    const hasSplit = parts.length > 0;
                    const isExpanded = expandedItems.has(item.uri);

                    const isLastVisitedMainOrChild =
                      lastVisitedRecording?.index === index && (
                        !lastVisitedRecording?.uri ||
                        recordings[index]?.derivedFiles?.splitParts?.some((p: { uri: string | undefined; }) => p.uri === lastVisitedRecording?.uri)
                      );

                    const isCardPlaying =
                      playingUri === item.uri ||
                      (item.derivedFiles?.splitParts?.some((p: RecordingItem) => {
                        return typeof p.uri === 'string' && p.uri === playingUri;
                      }) ?? false);

                    const isPrimarySelected =
                      isPlaying
                        ? isCardPlaying
                        : selectedPlayingIndex === index || isLastVisitedMainOrChild;

                    // 修复：判断是否显示主音档的三个按钮
                    const shouldShowMainButtons =
                      (isThisPlaying && !playingUri?.includes('split_')) ||
                      (selectedPlayingIndex === index && !playingUri?.includes('split_'));

                    // 修复：获取主音档显示文字
                    const mainDisplayText = getMainItemDisplayText(item);


                    return (
                      <View
                        key={item.uri}
                        style={{
                          position: 'relative',
                          zIndex: selectedContext?.index === index ? 999 : 0,
                          marginBottom: 12
                        }}
                      >
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => {
                            if (isSelectionMode) {
                              setSelectedItems(prev => {
                                const newSet = new Set(prev);
                                if (newSet.has(item.uri)) {
                                  newSet.delete(item.uri);
                                } else {
                                  newSet.add(item.uri);
                                }
                                return newSet;
                              });
                            } else {
                              setLastVisitedRecording(null);
                              setSelectedPlayingIndex(index);
                              setPlayingUri(item.uri);
                              setExpandedItems(prev => new Set([...prev, item.uri]));
                            }
                          }}
                          onLongPress={() => {
                            setIsSelectionMode(true);
                            setSelectedItems(new Set([item.uri]));
                          }}
                        >
                          <View
                            style={[
                              styles.recordingItem,
                              isSelectionMode && selectedItems.has(item.uri) && {
                                borderWidth: 2,
                                borderColor: colors.primary,
                                backgroundColor: colors.primary + '10',
                                borderRadius: 12,
                              },
                              (isPrimarySelected) && {
                                borderWidth: 3,
                                borderColor: colors.primary,
                                borderRadius: 12,
                              }
                            ]}
                          >
                            {isSelectionMode && (
                              <View style={{ position: 'absolute', top: 5, right: 10, zIndex: 20 }}>
                                <View style={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: 12,
                                  borderWidth: 2,
                                  borderColor: selectedItems.has(item.uri) ? colors.primary : '#999',
                                  backgroundColor: selectedItems.has(item.uri) ? colors.primary : colors.container,
                                  alignItems: 'center',
                                  justifyContent: 'center'
                                }}>
                                  {selectedItems.has(item.uri) && (
                                    <Text style={{ color: 'white', fontSize: 14, fontWeight: 'bold' }}>✓</Text>
                                  )}
                                </View>
                              </View>
                            )}

                            {/* 修复：主音档播放条 */}
                            <PlaybackBar
                              item={item}
                              isPlaying={isThisPlaying}
                              isVisible={getPlaybackBarVisibility(item.uri, index)}
                              playbackPosition={playingUri === item.uri ? playbackPosition : 0}
                              playbackDuration={durationMs}
                              playbackRate={rateForThis}
                              editableName={true}
                              showSpeedControl={true}
                              onPlayPause={() => handlePlayPause(item.uri, index)}
                              onSeek={(positionMs) => {
                                if (currentSound) {
                                  currentSound.setCurrentTime(positionMs / 1000);
                                  setPlaybackPosition(positionMs);
                                }
                              }}
                              onEditRename={(newName) => {
                                const updated = recordings.map((rec, i) => {
                                  if (i !== index) return rec;

                                  const updatedParts = rec.derivedFiles?.splitParts?.map((part: RecordingItem) => {
                                    const suffix = part.displayName?.split('|')[1]?.trim();
                                    return { ...part, displayName: suffix ? `${newName} | ${suffix}` : newName };
                                  });

                                  return {
                                    ...rec,
                                    displayName: newName,
                                    derivedFiles: {
                                      ...rec.derivedFiles,
                                      splitParts: updatedParts ?? rec.derivedFiles?.splitParts,
                                    },
                                  };
                                });

                                setRecordings(updated);
                                saveRecordings(updated);
                              }}
                              onMorePress={(e) => {
                                e.stopPropagation();
                                if (selectedContext?.index === index && selectedContext?.type === 'main') {
                                  setSelectedContext(null);
                                  return;
                                }
                                e.target.measureInWindow((x: number, y: number, width: number, height: number) => {
                                  setSelectedContext({
                                    type: 'main',
                                    index,
                                    position: { x, y: y + height }
                                  });
                                });
                              }}
                              onSpeedPress={(e) => {
                                e.stopPropagation();
                                e.target.measureInWindow((x: number, y: number, width: number, height: number) => {
                                  setSpeedMenuIndex(index);
                                  setSpeedMenuPosition({ x, y: y + height });
                                });
                              }}
                              styles={styles}
                              colors={colors}
                              editingState={editingState}
                              setEditingState={setEditingState}
                              itemIndex={index}
                              setRecordings={setRecordings}
                              saveRecordings={saveRecordings}
                              renderRightButtons={
                                editingState.type === 'name' && editingState.index === index ? (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <TouchableOpacity onPress={saveEditing}>
                                      <Text style={[styles.transcriptActionButton, { color: colors.primary }]}>💾</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={resetEditingState}>
                                      <Text style={styles.transcriptActionButton}>✖️</Text>
                                    </TouchableOpacity>
                                  </View>
                                ) : null
                              }
                            />

                            {/* 修復：文字摘要顯示區塊 - 主音檔 */}
                            {(mainDisplayText !== null || (!hasSplit && (item.transcript?.trim() || item.notes?.trim()))) && (
                              <View pointerEvents="box-none">
                                <TouchableOpacity
                                  onPress={() => {
                                    closeAllMenus();
                                    stopPlayback();
                                    setSelectedPlayingIndex(null);

                                    if (hasSplit) {
                                      navigation.navigate('NoteDetail', {
                                        index,
                                        type: 'notes',
                                      });
                                      setLastVisitedRecording({ index, type: 'notes' });
                                    } else {
                                      const type = item.notes?.trim()
                                        ? 'notes'
                                        : item.transcript?.trim()
                                          ? 'transcript'
                                          : null;

                                      if (type) {
                                        navigation.navigate('NoteDetail', {
                                          index,
                                          type,
                                          shouldTranscribe: type === 'transcript' && !item.transcript,
                                        });
                                        setLastVisitedRecording({ index, type });
                                      }
                                    }
                                  }}
                                >
                                  <View style={styles.transcriptBlock}>
                                    <Text
                                      style={styles.transcriptBlockText}
                                      numberOfLines={1}
                                      ellipsizeMode="tail"
                                    >
                                      {mainDisplayText || item.transcript?.trim() || item.notes?.trim()}
                                    </Text>
                                  </View>
                                </TouchableOpacity>
                              </View>
                            )}

                            {/* 修复：三个按钮 - 主音档 */}
                            {shouldShowMainButtons && (
                              <View style={styles.actionButtons}>
                                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                                  <TouchableOpacity
                                    style={{
                                      paddingVertical: 5,
                                      paddingHorizontal: 8,
                                      backgroundColor: visibleMiniType(index) === 'notes' ? colors.primary : colors.primary + '80',
                                      borderRadius: 8,
                                      opacity: isAnyProcessing ? 0.4 : 1,
                                    }}
                                    disabled={isAnyProcessing || (editingState.type === 'notes' && editingState.index !== null)}
                                    onPress={() => {
                                      closeAllMenus();
                                      stopPlayback();
                                      setSelectedPlayingIndex(null);
                                      navigation.navigate('NoteDetail', {
                                        index,
                                        type: 'notes',
                                      });
                                      setLastVisitedRecording({ index, type: 'notes' });
                                    }}
                                  >
                                    <Text style={{
                                      color: visibleMiniType(index) === 'notes' ? colors.text : colors.subtext,
                                      fontSize: 13,
                                      textAlign: 'center',
                                    }}>
                                      {t('notes')}
                                    </Text>
                                  </TouchableOpacity>

                                  <TouchableOpacity
                                    style={{
                                      paddingVertical: 5,
                                      paddingHorizontal: 8,
                                      backgroundColor: visibleMiniType(index) === 'transcript' ? colors.primary : colors.primary + '80',
                                      borderRadius: 8,
                                      opacity: isAnyProcessing ? 0.4 : 1,
                                    }}
                                    disabled={isAnyProcessing}
                                    onPress={async () => {
                                      closeAllMenus();
                                      stopPlayback();
                                      setSelectedPlayingIndex(null);
                                      navigation.navigate('NoteDetail', {
                                        index,
                                        type: 'transcript',
                                        shouldTranscribe: !recordings[index].transcript,
                                      });
                                      setLastVisitedRecording({ index, type: 'transcript' });
                                    }}
                                  >
                                    <Text style={{
                                      color: visibleMiniType(index) === 'transcript' ? colors.text : colors.subtext,
                                      fontSize: 13,
                                      textAlign: 'center',
                                    }}>
                                      {t('transcript')}
                                    </Text>
                                  </TouchableOpacity>

                                  <TouchableOpacity
                                    style={{
                                      paddingVertical: 5,
                                      paddingHorizontal: 8,
                                      backgroundColor: visibleMiniType(index) === 'summary' ? colors.primary : colors.primary + '80',
                                      borderRadius: 8,
                                      opacity: 1,
                                    }}
                                    disabled={isAnyProcessing}
                                    onPress={() => {
                                      closeAllMenus();
                                      stopPlayback();
                                      setSelectedPlayingIndex(null);
                                      navigation.navigate('NoteDetail', {
                                        index,
                                        type: 'summary',
                                        summaryMode,
                                      });
                                      setLastVisitedRecording({ index, type: 'summary' });
                                    }}
                                  >
                                    <Text style={{
                                      color: visibleMiniType(index) === 'summary' ? colors.text : colors.subtext,
                                      fontSize: 13,
                                      textAlign: 'center',
                                    }}>
                                      {t('toolbox')}
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            )}

                            {item.durationSec > SEGMENT_DURATION && (
                              <TouchableOpacity
                                onPress={() => toggleExpand(item.uri)}
                                disabled={splittingUri === item.uri}
                                style={{ paddingLeft: 16, paddingTop: 4 }}
                              >
                                <Text style={{ fontSize: 12, color: colors.primary }}>
                                  {splittingUri === item.uri
                                    ? t('splittingInProgress')
                                    : isExpanded
                                      ? t('collapseSegments')
                                      : t('expandSegments')
                                  }
                                </Text>
                              </TouchableOpacity>
                            )}

                            {isExpanded && item.derivedFiles?.splitParts?.map((part: RecordingItem, subIndex: number) => {
                              const isThisSplitPlaying = isPlaying && playingUri === part.uri;
                              const partDurationMs = (part.durationSec ?? 0) * 1000;
                              const partRate = playbackRates[part.uri] ?? 1.0;
                              const shouldShowSplitButtons = isThisSplitPlaying;
                              const partDisplayText = getDisplayText(part);

                              return (
                                <View
                                  key={part.uri}
                                  style={{
                                    marginLeft: 16,
                                    paddingLeft: 8,
                                    borderLeftWidth: 2,
                                    borderLeftColor: colors.primary + '40',
                                  }}
                                >
                                  <PlaybackBar
                                    item={part}
                                    isPlaying={isThisSplitPlaying}
                                    isVisible={playingUri === part.uri}
                                    playbackPosition={playingUri === part.uri ? playbackPosition : 0}
                                    playbackDuration={partDurationMs}
                                    playbackRate={partRate}
                                    styles={styles}
                                    colors={colors}
                                    showSpeedControl={true}
                                    onPlayPause={() => handlePlayPause(part.uri, index)}
                                    onSeek={(positionMs) => {
                                      if (currentSound) {
                                        currentSound.setCurrentTime(positionMs / 1000);
                                        setPlaybackPosition(positionMs);
                                      }
                                    }}
                                    onEditRename={(newName) => {
                                      const updated = [...recordings];
                                      const parent = updated[index];

                                      if (!parent.derivedFiles?.splitParts) return;

                                      const newParts = parent.derivedFiles.splitParts.map((p: RecordingItem) =>
                                        p.uri === part.uri ? { ...p, displayName: newName } : p
                                      );

                                      updated[index] = {
                                        ...parent,
                                        derivedFiles: {
                                          ...parent.derivedFiles,
                                          splitParts: newParts,
                                        },
                                      };

                                      setRecordings(updated);
                                      saveRecordings(updated);
                                    }}
                                    onMorePress={(e) => {
                                      e.stopPropagation();
                                      if (
                                        selectedSplitContext &&
                                        selectedSplitContext.parentIndex === index &&
                                        selectedSplitContext.partUri === part.uri
                                      ) {
                                        setSelectedSplitContext(null);
                                        return;
                                      }
                                      e.target.measureInWindow((x: number, y: number, width: number, height: number) => {
                                        setSelectedSplitContext({
                                          parentIndex: index,
                                          partUri: part.uri,
                                          position: { x, y: y + height },
                                        });
                                      });
                                    }}
                                    onSpeedPress={(e) => {
                                      e.stopPropagation();
                                      e.target.measureInWindow((x: number, y: number, width: number, height: number) => {
                                        setSpeedMenuIndex(index);
                                        setSpeedMenuPosition({ x, y: y + height });
                                      });
                                    }}
                                    setRecordings={setRecordings}
                                    saveRecordings={saveRecordings}
                                    variant="sub"
                                  />

                                  {partDisplayText && (
                                    <View pointerEvents="box-none">
                                      <TouchableOpacity
                                        onPress={async () => {
                                          closeAllMenus();
                                          stopPlayback();
                                          setSelectedPlayingIndex(null);

                                          const type = part.notes?.trim()
                                            ? 'notes'
                                            : part.transcript?.trim()
                                              ? 'transcript'
                                              : null;

                                          if (type) {
                                            navigation.navigate('NoteDetail', {
                                              index,
                                              uri: part.uri,
                                              type,
                                              shouldTranscribe: type === 'transcript' && !part.transcript,
                                            });
                                            setLastVisitedRecording({ index, uri: part.uri, type });
                                          }
                                        }}
                                      >
                                        <View style={styles.transcriptBlock}>
                                          <Text
                                            style={styles.transcriptBlockText}
                                            numberOfLines={1}
                                            ellipsizeMode="tail"
                                          >
                                            {partDisplayText}
                                          </Text>
                                        </View>
                                      </TouchableOpacity>
                                    </View>
                                  )}

                                  {shouldShowSplitButtons && (
                                    <View style={styles.actionButtons}>
                                      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                                        <TouchableOpacity
                                          style={{
                                            paddingVertical: 5,
                                            paddingHorizontal: 8,
                                            backgroundColor: visibleMiniType(index) === 'notes' ? colors.primary : colors.primary + '80',
                                            borderRadius: 8,
                                            opacity: isAnyProcessing ? 0.4 : 1,
                                          }}
                                          disabled={isAnyProcessing}
                                          onPress={() => {
                                            closeAllMenus();
                                            stopPlayback();
                                            setSelectedPlayingIndex(null);
                                            navigation.navigate('NoteDetail', {
                                              index,
                                              uri: part.uri,
                                              type: 'notes',
                                            });
                                            setLastVisitedRecording({ index, uri: part.uri, type: 'notes' });
                                          }}
                                        >
                                          <Text style={{
                                            color: visibleMiniType(index) === 'notes' ? colors.text : colors.subtext,
                                            fontSize: 13,
                                            textAlign: 'center',
                                          }}>
                                            {t('notes')}
                                          </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                          style={{
                                            paddingVertical: 5,
                                            paddingHorizontal: 8,
                                            backgroundColor: visibleMiniType(index) === 'transcript' ? colors.primary : colors.primary + '80',
                                            borderRadius: 8,
                                            opacity: isAnyProcessing ? 0.4 : 1,
                                          }}
                                          disabled={isAnyProcessing}
                                          onPress={() => {
                                            closeAllMenus();
                                            stopPlayback();
                                            setSelectedPlayingIndex(null);
                                            navigation.navigate('NoteDetail', {
                                              index,
                                              uri: part.uri,
                                              type: 'transcript',
                                              shouldTranscribe: !part.transcript,
                                            });
                                            setLastVisitedRecording({ index, uri: part.uri, type: 'transcript' });
                                          }}
                                        >
                                          <Text style={{
                                            color: visibleMiniType(index) === 'transcript' ? colors.text : colors.subtext,
                                            fontSize: 13,
                                            textAlign: 'center',
                                          }}>
                                            {t('transcript')}
                                          </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                          style={{
                                            paddingVertical: 5,
                                            paddingHorizontal: 8,
                                            backgroundColor: visibleMiniType(index) === 'summary' ? colors.primary : colors.primary + '80',
                                            borderRadius: 8,
                                            opacity: 1,
                                          }}
                                          disabled={isAnyProcessing}
                                          onPress={() => {
                                            closeAllMenus();
                                            stopPlayback();
                                            setSelectedPlayingIndex(null);
                                            navigation.navigate('NoteDetail', {
                                              index,
                                              uri: part.uri,
                                              type: 'summary',
                                              summaryMode,
                                            });
                                            setLastVisitedRecording({ index, uri: part.uri, type: 'summary' });
                                          }}
                                        >
                                          <Text style={{
                                            color: visibleMiniType(index) === 'summary' ? colors.text : colors.subtext,
                                            fontSize: 13,
                                            textAlign: 'center',
                                          }}>
                                            {t('toolbox')}
                                          </Text>
                                        </TouchableOpacity>
                                      </View>
                                    </View>
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        </TouchableOpacity>
                      </View>
                    );
                  }}
                />
              )}

              {/* 三點選單浮動層 */}
              {selectedContext && (
                <MoreMenu
                  index={selectedContext.index}
                  item={
                    selectedContext.type === 'main'
                      ? recordings[selectedContext.index]
                      : recordings[selectedContext.index].derivedFiles?.[selectedContext.type]!
                  }
                  isDerived={selectedContext.type !== 'main'}
                  title={title}
                  position={selectedContext.position}
                  styles={styles}
                  closeAllMenus={() => setSelectedContext(null)}
                  onRename={(index) => {
                    setSelectedSplitContext(null);
                    setTimeout(() => {
                      startEditing(index, 'name');
                    }, 0);
                  }}
                  onShare={(uri) => {
                    shareRecordingFile(uri, () => setSelectedIndex(null));
                  }}
                  onDelete={(index) => {
                    deleteRecording(index);
                    setShowTranscriptIndex(null);
                    setShowSummaryIndex(null);
                    setShowNotesIndex(null);
                    resetEditingState();
                    setSelectedContext(null);
                  }}
                  showDelete={true}
                />
              )}

              {/* 子音檔三點選單 */}
              {selectedSplitContext && (
                <MoreMenu
                  index={selectedSplitContext.parentIndex}
                  item={
                    recordings[selectedSplitContext.parentIndex]
                      .derivedFiles?.splitParts?.find((p: { uri: string }) => p.uri === selectedSplitContext.partUri)!
                  }
                  isDerived={true}
                  title={title}
                  position={selectedSplitContext.position}
                  styles={styles}
                  closeAllMenus={() => setSelectedSplitContext(null)}
                  onRename={(index) => {
                    setSelectedSplitContext(null);
                    const partUri = selectedSplitContext?.partUri;
                    setTimeout(() => {
                      startEditing(index, 'name', partUri);
                    }, 0);
                  }}
                  onShare={(uri) => {
                    shareRecordingFile(uri, () => setSelectedIndex(null));
                  }}
                  onDelete={() => {
                    deleteSplitPart(
                      selectedSplitContext.parentIndex,
                      selectedSplitContext.partUri
                    );
                    setSelectedSplitContext(null);
                  }}
                  showDelete={true}
                />
              )}

              {/* 速度選單 */}
              {speedMenuIndex !== null && speedMenuPosition && (
                <View style={{
                  position: 'absolute',
                  left: speedMenuPosition.x - 60,
                  top: speedMenuPosition.y + 5,
                  backgroundColor: colors.container,
                  borderRadius: 8,
                  padding: 8,
                  zIndex: 9999,
                  elevation: 10,
                }}>
                  {[0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                    <TouchableOpacity
                      key={rate}
                      style={[
                        styles.optionButton,
                        currentPlaybackRate === rate && { backgroundColor: colors.primary + '20' },
                      ]}
                      onPress={async () => {
                        closeAllMenus();

                        const uri = playingUri;
                        if (!uri) return;
                        setPlaybackRates(prev => ({ ...prev, [uri]: rate }));

                        if (isPlaying && playingUri === uri) {
                          await setPlaybackRate(rate);
                        }

                        setSpeedMenuIndex(null);
                      }}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          currentPlaybackRate === rate && { fontWeight: 'bold' },
                        ]}
                      >
                        {rate}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* 回頂端按鈕 */}
              {recordings.length > 10 && editingState.index === null && (
                <TouchableOpacity
                  onPress={() => flatListRef.current?.scrollToOffset({ animated: true, offset: 0 })}
                  style={{
                    position: 'absolute',
                    bottom: 90,
                    right: 20,
                    backgroundColor: colors.primary + '80',
                    paddingVertical: 10,
                    paddingHorizontal: 16,
                    borderRadius: 30,
                    shadowColor: '#000',
                    shadowOpacity: 0.2,
                    shadowOffset: { width: 0, height: 2 },
                    shadowRadius: 4,
                    elevation: 5,
                  }}
                >
                  <Text style={{ color: 'white', fontSize: 18 }}>↑</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </SafeAreaView>
      </TouchableWithoutFeedback>
    </>
  );

};

export default RecorderLists;