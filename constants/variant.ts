// constants/variant.ts
export const APP_VARIANT: string = 'notedebug'; // 可切換為 'note'、'clamp'、'notedebug'等
export const nginxVersion: string = 'blue'; // 可切換為 'green(V1)'、'blue' 等
export const APP_TITLE = 'Voice Note';

export const version : string = '1.5.1';
export const debugValue: string  = '0';  // 可切換 1 debug, 0 release

export let SEGMENT_DURATION = 600; // default: 10 分鐘 設定在漢堡選單

export const setSegmentDuration = (sec: number) => {
  SEGMENT_DURATION = sec;
};
