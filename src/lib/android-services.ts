import { App } from '@capacitor/app';
import {
  pickOriginals,
  loadAndroidThumbnail,
  restoreAndroidSession,
  saveAndroidSession,
  discardOriginals,
} from './android';

// Loaded by the Android entry only, before App mounts or any native lifecycle effect runs.
export const androidServices = {
  app: App,
  pickOriginals,
  loadAndroidThumbnail,
  restoreAndroidSession,
  saveAndroidSession,
  discardOriginals,
};
export type AndroidServices = typeof androidServices;
