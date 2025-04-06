//audio.Styles.ts

import { StyleSheet } from 'react-native';

// 動態樣式
export const createStyles = (colors: any) => StyleSheet.create({
    container: {
      paddingTop: 20,
      flex: 1,
      backgroundColor: colors.background,
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
    },
    stopButton: {
      backgroundColor: colors.warning,
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 25,
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
    volumeText: {
      fontSize: 12,
      color: colors.text,
      textAlign: 'center',
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
    recordingItem: {
      backgroundColor: colors.container,
      borderRadius: 10,
      padding: 15,
      marginBottom: 12,
      elevation: 2,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
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
      color: colors.text,
    },
    playOptionsMenu: {
        position: 'absolute',
        left:10,
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
      progressContainer: {
        marginTop: 8,
        width: '100%',
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
      padding: 5,
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
      zIndex: 9999,
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
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      zIndex: 10,
    },
  });
  
