// constants/Colors.ts

function getPrimaryBackground(hex: string): string {
  const r = 255 - parseInt(hex.slice(1, 3), 16);
  const g = 255 - parseInt(hex.slice(3, 5), 16);
  const b = 255 - parseInt(hex.slice(5, 7), 16);
  return `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export const additionalColors = {
  blue: '#00C1D4',
  green: '#00BFA6',
  yellow: '#D4B483',
  red: '#B95756',
  purple: '#B483D4'
};

export const lightTheme = {
  primary: '#00C1D4',
  background: '#F7F3E9',
  secondary: '#e0e0e0',
  text: '#222',
  subtext: '#555',
  buttonText: 'white',
  warning: '#F44336',
  container: 'white',
  shadow: '#000000'
};

export const darkTheme = {
  primary: '#00C1D4',
  background: '#2E2B27',
  secondary: '#424242',
  text: '#eee',
  subtext: '#ccc',
  buttonText: 'white',
  warning: '#D32F2F',
  container: '#1E1E1E',
  shadow: '#ffffff'
};

export const partBackgrounds = {
  light: lightTheme,
  dark: darkTheme
};