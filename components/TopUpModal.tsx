// TopUpModal.tsx 完整修正版本
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet } from 'react-native';
import React, { useState } from 'react';
import { debugLog, debugWarn, debugError } from '../utils/debugLog';
import { useTranslation } from '../constants/i18n';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (productId: string) => void;
  styles: any;
  colors: any;
  products: any[];
};

const TopUpModal = ({ visible, onClose, onSelect, styles, colors, products }: Props) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { t } = useTranslation();
  
  const sortedProducts = [...products].sort((a, b) => {
    const priceA = parseFloat((a.localizedPrice ?? '').replace(/[^0-9.]/g, '')) || 0;
    const priceB = parseFloat((b.localizedPrice ?? '').replace(/[^0-9.]/g, '')) || 0;
    return priceA - priceB;
  });

  // 全屏样式
  const fullScreenStyles = StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalContainer: {
      width: '90%',
      maxWidth: 400,
      borderRadius: 16,
      padding: 24,
      elevation: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    modalTitle: {
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 16,
      textAlign: 'center',
    },
    planCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 20,
      marginVertical: 8,
      borderRadius: 12,
      borderWidth: 2,
    },
    planCoins: {
      fontSize: 18,
      fontWeight: 'bold',
    },
    planPrice: {
      fontSize: 18,
      fontWeight: 'bold',
    },
    modalClose: {
      fontSize: 16,
      textAlign: 'center',
      marginTop: 16,
      padding: 12,
      fontWeight: '600',
    },
  });

  const formatTitle = (title: string): string => {
    const suffix = t('storeSuffixToRemove');
    return title.replace(suffix, '').trim();
  };

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={fullScreenStyles.modalOverlay}>
        <View style={[fullScreenStyles.modalContainer, { backgroundColor: colors.container }]}>
          <Text style={[fullScreenStyles.modalTitle, { color: colors.primary }]}>
            {t('topupTitle')}{"\n"}
          </Text>
          <Text style={{ 
            fontSize: 16, 
            color: colors.text, 
            textAlign: 'center', 
            lineHeight: 22,
            marginBottom: 20 
          }}>
            {t('topupDescription')}
            {"\n\n"}
          </Text>

          <FlatList
            data={sortedProducts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const coinText = t('coinAmount') || '{{count}} 金幣';
              const displayText = coinText.replace('{{count}}', String(item.coins || 0));

              return (
                <TouchableOpacity
                  style={[
                    fullScreenStyles.planCard, 
                    { 
                      backgroundColor: colors.background,
                      borderColor: colors.primary,
                      opacity: isProcessing ? 0.5 : 1
                    }
                  ]}
                  onPress={() => {
                    debugLog("🟢 購買商品 ID:", item.id);
                    if (!isProcessing) {
                      setIsProcessing(true);
                      onSelect(item.id);
                      setTimeout(() => setIsProcessing(false), 2000);
                    }
                  }}
                  disabled={isProcessing}
                >
                  <Text style={[fullScreenStyles.planCoins, { color: colors.text }]}>
                    {displayText}
                  </Text>
                  <Text style={[fullScreenStyles.planPrice, { color: colors.primary }]}>
                    {item.localizedPrice || 'NT$ 30'}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
          
          <TouchableOpacity onPress={onClose}>
            <Text style={[fullScreenStyles.modalClose, { color: colors.text }]}>
              {t('cancel')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default TopUpModal;