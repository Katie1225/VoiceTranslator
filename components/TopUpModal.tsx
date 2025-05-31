import { View, Text, TouchableOpacity, Modal, FlatList } from 'react-native';
import React, { useState } from 'react';
import { debugLog, debugWarn, debugError } from '../utils/debugLog';


type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (productId: string) => void;
  styles: any;
  colors: any;
  products: any[]; // 從 getProducts 回傳的陣列
};

const TopUpModal = ({ visible, onClose, onSelect, styles, colors, products}: Props) => {
  const [isProcessing, setIsProcessing] = useState(false);
  // Sort products by price (low to high)
  const sortedProducts = [...products].sort((a, b) => {
    const priceA = parseFloat((a.localizedPrice ?? '').replace(/[^0-9.]/g, '')) || 0;
    const priceB = parseFloat((b.localizedPrice ?? '').replace(/[^0-9.]/g, '')) || 0;
    return priceA - priceB;
  });

  // Format product title to remove "錄音筆記-凱凱實驗室"
  const formatTitle = (title: string) => {
    return title.replace(/\(錄音筆記-凱凱實驗室\)/g, '').trim();
  };

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContainer, { backgroundColor: colors.container }]}>
          <Text style={[styles.modalTitle, { color: colors.primary, textAlign: 'center' }]}>
            💰 儲值金幣{"\n"}
          </Text>
          <Text style={{ fontSize: 13, color: colors.text, textAlign: 'center', lineHeight: 18 }}>
            請選擇金幣方案以繼續使用錄音筆記與 AI 加值功能
            {"\n\n"}
          </Text>

          <FlatList
            data={sortedProducts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.planCard, isProcessing && { opacity: 0.5 }]}
                onPress={() => {
                  debugLog("🟢 購買商品 ID:", item.id);
                  if (!isProcessing) {
                    setIsProcessing(true);
                    onSelect(item.id);
                    setTimeout(() => setIsProcessing(false), 2000); // 2秒內防止重複點擊
                  }
                }}
                disabled={isProcessing}
              >
                <Text style={styles.planCoins}>{item.coins} 金幣</Text>
                <Text style={styles.planPrice}>{item.localizedPrice || ''}</Text>

              </TouchableOpacity>
            )}
          />
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.modalClose, { color: colors.text }]}>取消</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default TopUpModal;