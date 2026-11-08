import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.kuba25x.upscalecompare',
  appName: 'Upscale Compare',
  webDir: 'dist-android',
  android: { zoomEnabled: false },
  plugins: {
    // DisplayLayout owns edge-to-edge insets and the orientation-dependent bar policy.
    SystemBars: { insetsHandling: 'disable', hidden: false, style: 'DARK' },
    App: { disableBackButtonHandler: true },
  },
};
export default config;
