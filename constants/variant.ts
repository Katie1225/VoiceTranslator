// constants/variant.ts
export const APP_VARIANT: string = 'notedebug'; // 可切換為 'note'、'clamp'、'notedebug'等
export const nginxVersion: string = 'blue'; // 可切換為 'green(V1)'、'blue' 等
export const APP_TITLE = 'Voice Note';

export const version : string = '1.5.0';
export const debugValue: string  = '1';  // 可切換 1 debug, 0 release
export const SEGMENT_DURATION = debugValue === '1' ? 60 : 300; // 測試模式用0.5分鐘，正式用10分鐘