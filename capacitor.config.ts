import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.kuba25x.upscalecompare',
  appName: 'Upscale Compare',
  webDir: 'dist-android',
  android: { zoomEnabled: false },
  plugins: { SystemBars: { insetsHandling: 'native' }, App: { disableBackButtonHandler: true } },
};
export default config;
