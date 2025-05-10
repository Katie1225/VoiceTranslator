// components/TopUpModal.tsx
import React from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { logCoinUsage, COIN_UNIT_MINUTES, COIN_COST_PER_UNIT } from '../utils/googleSheetAPI';

const TopUpModal = ({ visible, onClose, onSelect, styles, colors }: {
    visible: boolean;
    onClose: () => void;
    onSelect: (productId: string) => void;
    styles: any;
    colors: any;
}) => {
    const plans = [
        { id: 'topup_100', coins: 100, price: 'USD $1.99', minutes: '~ 100 分鐘' },
        { id: 'topup_400', coins: 400, price: 'USD $4.99', minutes: '~ 6 小時 40 分' },
        { id: 'topup_1000', coins: 1000, price: 'USD $9.99', minutes: '~ 16 小時 40 分', recommended: true },
    ];

    return (
        <Modal transparent visible={visible} animationType="fade">
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContainer, { backgroundColor: colors.container }]}>
<Text style={[styles.modalTitle, { color: colors.primary, textAlign: 'center' }]}>
  💰 儲值金幣{"\n"}</Text>
<Text style={{ fontSize: 13, color: colors.text, textAlign: 'center', lineHeight: 18 }}>
  錄音轉文字每分鐘 {COIN_COST_PER_UNIT} 金幣，{"\n"}
  加值功能每次 10 金幣。{"\n"}{"\n"}
</Text>
                    {plans.map((plan) => (
                        <TouchableOpacity
                            key={plan.id}
                            style={[styles.planCard, plan.recommended && styles.recommendedCard]}
                            onPress={() => onSelect(plan.id)}
                        >
                            <Text style={styles.planCoins}>
                                {plan.coins} 金幣 {plan.recommended ? '🔥 最超值' : ''}
                            </Text>
                            {/*            <Text style={styles.planMinutes}>{plan.minutes}</Text> */}
                            <Text style={styles.planPrice}>{plan.price}</Text>
                        </TouchableOpacity>
                    ))}
                    <TouchableOpacity onPress={onClose}>
                        <Text style={[styles.modalClose, { color: colors.text }]}>取消</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

export default TopUpModal;
