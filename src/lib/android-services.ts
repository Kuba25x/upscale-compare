import { App } from '@capacitor/app';
import {
  pickOriginals,
  restoreAndroidSession,
  saveAndroidSession,
  discardOriginals,
} from './android';

// Loaded by the Android entry only, before App mounts or any native lifecycle effect runs.
export const androidServices = {
  app: App,
  pickOriginals,
  restoreAndroidSession,
  saveAndroidSession,
  discardOriginals,
};
export type AndroidServices = typeof androidServices;
