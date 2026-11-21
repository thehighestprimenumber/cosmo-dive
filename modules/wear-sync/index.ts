import { requireOptionalNativeModule } from 'expo-modules-core';

type WearSyncModule = { sendState(json: string): Promise<boolean> };

// Null outside a native Android build (tests, Expo Go): sending is then a no-op.
const native = requireOptionalNativeModule<WearSyncModule>('WearSync');

/** Send the widget state to the paired watch (Wear OS Data Layer). Resolves false if it couldn't. */
export async function sendStateToWatch(json: string): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.sendState(json);
  } catch {
    return false;
  }
}
