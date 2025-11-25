// constants/variant.ts
export const APP_VARIANT: string = 'notedebug'; // 可切換為 'note'、'clamp'、'notedebug'等
export const nginxVersion: string = 'blue'; // 可切換為 'green(V1)'、'blue' 等  blue 的 whisper 還是 wav 要 copy green
export const APP_TITLE = 'Voice Translator';

export const version : string = '0.0.6';
export const debugValue: string  = '1';  // 可切換 1 debug, 0 release

// 初始免費額度
export const getInitialFreeCoins = () => {
  return debugValue === '1' ? 15 : 10000; // 測試給15，正式給100
};

// 初次登入獎勵配置
export const getSignupBonus = (): number => {
  return debugValue === '1' ? 20 : 200;
};

// 產品配置
export const productToCoins: Record<string, number> = {
    'topup_1': debugValue === '1' ? 100 : 5000,
};

export const productIds = Object.keys(productToCoins);
