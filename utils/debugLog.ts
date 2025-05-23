import { debugValue } from '../constants/variant';

export const debugLog = (...args: any[]) => {
  if (debugValue === '1') {
    console.log('[DEBUG]', ...args);
  }
};

export const debugWarn = (...args: any[]) => {
  if (debugValue === '1') {
    console.warn('[WARN]', ...args);
  }
};

export const debugError = (...args: any[]) => {
  if (debugValue === '1') {
    console.error('[ERROR]', ...args);
  }
};