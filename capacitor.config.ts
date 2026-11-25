import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shortsquiz.studio0',
  appName: 'استوديو شورتس الأسئلة',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#0c0c0c',
  },
};

export default config;
