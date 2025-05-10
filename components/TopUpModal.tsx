import React from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList } from 'react-native';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (productId: string) => void;
  styles: any;
  colors: any;
  products: any[]; // 從 getProducts 回傳的陣列
};

const TopUpModal = ({ visible, onClose, onSelect, styles, colors, products }: Props) => {
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
            data={products}
            keyExtractor={(item) => item.productId}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.planCard}
                onPress={() => onSelect(item.productId)}
              >
                <Text style={styles.planCoins}>{item.title}</Text>
                <Text style={styles.planPrice}>{item.localizedPrice}</Text>
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
