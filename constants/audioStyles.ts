//audio.Styles.ts

import { StyleSheet } from 'react-native';

// 動態樣式
export const createStyles = (colors: any) => StyleSheet.create({
   playbackContainer: {
    padding: 6,
    backgroundColor: colors.container,
    borderRadius: 8,
    marginBottom:6,
  },
  playbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  audioTitle: {
    fontSize: 14,
    flex: 1,
  },
  audioTitleInput: {
    flex: 1,
    fontSize: 16,
    borderBottomWidth: 1,
    paddingVertical: 4,
  },
  playbackSlider: {
    width: '100%',
    height: 30,
  },
  playbackFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  playingText: {
    fontWeight: 'bold',
  }, // 粗體字
  container: {
    paddingTop: 20,
    flex: 1,
    backgroundColor: colors.background,
  },
  recordingItem: {
    backgroundColor: colors.container,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    borderWidth:0.5,
borderColor: colors.primary,

    minHeight: 50,
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
  nameRow: {                                   //名稱條
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
  },
  
  transcriptBlock: {                            //小字容器
    paddingHorizontal: 8,
    marginTop: 4,
    height: 25,
  },
  
  transcriptBlockText: {                          //小字文字
    fontSize: 12,
    lineHeight: 22,
    color: colors.subtext,
    paddingRight: 8, // 保留操作列空間
  },
  
  progressContainer: {                            //進度條
    flexDirection: 'column',
    paddingHorizontal: 8,
    marginTop: 20,
    height: 30
  },
  
  actionButtons: {                                  //錄音筆記重點摘要隱藏
    marginTop: 8,
    height: 50,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },

  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: colors.text,
  },
  emptyListContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyListText: {
    fontSize: 16,
    color: colors.text,
    opacity: 0.6,
  },
  menuButton: {
    paddingTop: 30,
    position: 'absolute',
    top: 10,
    right: 20,
    zIndex: 10,
  },
  menuIcon: {
    fontSize: 24,
    color: colors.primary,
  },
  menuContainer: {
    paddingTop: 20,
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: colors.container,
    borderRadius: 8,
    padding: 12,
    zIndex: 10,
    elevation: 5,
  },
  menuItemButton: {
    paddingVertical: 15,
  },
  menuItem: {
    fontSize: 16,
    color: colors.text,
  },
  menuHeader: {
    fontSize: 14,
    //fontWeight: 'bold',
    color: colors.text,
    marginTop: 0,
    marginBottom: 5
  },
  colorOptionsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 10
  },
  colorOption: {
    width: 30,
    height: 30,
    borderRadius: 15,
    margin: 5,
    borderWidth: 2,
    borderColor: 'transparent'
  },
  selectedColor: {
    borderColor: colors.text
  },
  recordSection: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: colors.container,
    borderBottomWidth: 1,
    borderBottomColor: colors.secondary,
  },
  recordButton: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
    minWidth: 90,         // 🔥新增
    alignItems: 'center',  // 🔥新增
    justifyContent: 'center', // 🔥新增
  },
  
  stopButton: {
    backgroundColor: 'red',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
    minWidth: 90,         // 🔥新增
    alignItems: 'center',  // 🔥新增
    justifyContent: 'center', // 🔥新增
  },
  buttonText: {
    color: colors.buttonText,
    fontWeight: 'bold',
    fontSize: 16,
  },
  volumeMeter: {
    marginTop: 15,
    width: '80%',
  },

  volumeBar: {
    height: 6,
    backgroundColor: colors.secondary,
    borderRadius: 3,
    marginTop: 5,
    overflow: 'hidden',
  },
  volumeLevel: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  listContainer: {
    flex: 1,
    padding: 15,
  },

  playIconContainer: {
    marginRight: 10,
    width: 24,
    alignItems: 'center',
  },
  playIcon: {
    fontSize: 16,
    color: colors.primary,
  },
  nameContainer: {
    flex: 1,
  },
  nameInput: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    padding: 5,
    fontSize: 16,
    color: colors.text,
  },
  recordingName: {
    fontSize: 16,
    lineHeight: 22, // 固定行高
    textAlignVertical: 'center',
    overflow: 'hidden',
    color: colors.text,
  },
  playOptionsMenu: {
    position: 'absolute',
    left: 10,
    top: 10,
    backgroundColor: colors.container,
    borderRadius: 8,
    padding: 8,
    elevation: 12,
    zIndex: 1000, // 👈 重點：比 optionsMenuLayered 更高
    minWidth: 120,
  },
  derivedFilesContainer: {
    marginLeft: 20,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    paddingLeft: 10,
  },
  derivedFileItem: {
    flex: 1,
  },
  derivedFileContent: {
    flex: 1,
  },
  derivedMoreButton: {
    paddingHorizontal: 10,
  },
  derivedOptionsMenu: {
    backgroundColor: '#fff',
    borderRadius: 5,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    minWidth: 120,
  },

  bar: {
    width: 4,
    backgroundColor: '#3b64ce',
    marginRight: 8,
    borderRadius: 4,
    marginTop: 3,
  },

  volumeAndTimeContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 0,
    height: 40,
    backgroundColor: 'transparent', // 可加上 '#eee' 調試
  },
  
  volumeContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 40,
    width: '75%',
    marginRight: 0,
    paddingRight: 0,
  },
  
  timeContainer: {
    width: '25%',
    marginLeft: 0,
    paddingLeft: 0,
    justifyContent: 'center',
  },
  
  volumeText: {
    fontSize: 14,
    color: colors.text,
  },
  menuButtonContainer: {
    alignItems: 'center',  // 水平置中
    justifyContent: 'center', // 垂直置中（可選）
    padding: 10, // 按鈕周圍的間距
  },

  derivedFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  mainFileRow: {
    marginBottom: 8, // 原始檔案與強化版之間的間距
  },

  derivedFileName: {
    color: colors.text,
    fontSize: 14,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  progressBar: {
    height: 10,
    backgroundColor: colors.secondary,
    borderRadius: 2,
    marginBottom: 5,
    width: '100%', // 要加這行！
    overflow: 'hidden',

  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  timeText: {
    fontSize: 12,
    color: colors.text,
    textAlign: 'center',
  },
  moreButton: {
    marginLeft: 10,
    padding: 0,
  },
  moreIcon: {
    fontSize: 20,
    color: colors.text,
  },
  optionsMenu: {
    position: 'absolute',
    right: 0,
    top: 30,
    backgroundColor: colors.container,
    borderRadius: 8,
    padding: 8,
    elevation: 5,
    zIndex: 20,
    minWidth: 120,
  },
  optionButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  optionText: {
    color: colors.text,
    fontSize: 14,
  },
  deleteText: {
    color: colors.warning,
  },
  speedOptionsMenu: {
    position: 'absolute',
    right: 60,
    top: 0,
    backgroundColor: colors.cardBackground,
    borderRadius: 8,
    padding: 8,
    elevation: 4,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 10,
  },
  transcriptContainer: {                           // 錄音筆記跟重點摘要容器
    backgroundColor: colors.background,
    padding: 12,
    borderRadius: 12,
    marginTop: 10,
    elevation: 2,
  },
  transcriptText: {                              // 錄音筆記跟重點摘要顯示文字
    fontSize: 14,
    color: colors.text,
  },
  
 
 transcriptTextInput: {                          // 錄音筆記跟重點摘要編輯文字
    fontSize: 14,
    color: colors.text,
    padding: 8,
    backgroundColor: colors.background,
    borderRadius: 8,
    minHeight: 100,
    textAlignVertical: 'top',
    width: '100%',
  },
  
  transcriptActionsRow: {                         // 錄音筆記跟重點摘要編輯文字的儲存與取消按鈕
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 12,
    gap: 12
  },
  
  transcriptActionButton: {                        // 錄音筆記跟重點摘要編輯文字的儲存與取消文字
    fontSize: 13,  
    color: colors.subtext,
  }, 
  extraLine: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
    lineHeight: 18,
  } ,
  headerBlock: {
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    //marginBottom: 5,
  },
  modalOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0, 0, 0, 0.6)',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 9999,
  elevation: 9999,
},

modalContainer: {
  width: '85%',
  borderRadius: 12,
  padding: 20,
  backgroundColor: colors.container, // 使用淺色或深色主底
},

modalTitle: {
  fontSize: 18,
  fontWeight: 'bold',
  textAlign: 'center',
  marginBottom: 16,
  color: colors.primary,
},

planCard: {
  paddingVertical: 6,       // 減少上下空間
  paddingHorizontal: 12,
  borderRadius: 10,
  marginBottom: 14,          // 卡片間距也稍微收一點
  backgroundColor: colors.primary,
  borderWidth: 0,
},

recommendedCard: {}, // ❌ 清空推薦樣式（不加特殊處理）

planCoins: {
  fontSize: 16,
  fontWeight: 'bold',
  color: 'white', // 白字
  textAlign: 'center',
},

planMinutes: {
  fontSize: 14,
  color: 'white',  // 白字
  textAlign: 'center',
},

planPrice: {
  fontSize: 14,
  marginTop: 6,
  color: 'white',  // 白字
  textAlign: 'center',
},

modalClose: {
  textAlign: 'center',
  marginTop: 20,
  fontSize: 16,
  color: colors.text, // 根據深色/淺色切換
},
 
});

