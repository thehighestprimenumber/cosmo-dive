import { requireOptionalNativeModule } from 'expo-modules-core';

type WearSyncModule = { sendState(json: string): Promise<boolean>; getStrengthDone(): Promise<string> };

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

/** Days the guided strength session was finished on the watch ("YYYY-MM-DD"). Empty without a watch. */
export async function strengthDoneOnWatch(): Promise<string[]> {
  if (!native) return [];
  try {
    const list = JSON.parse(await native.getStrengthDone()) as unknown;
    return Array.isArray(list) ? list.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  } catch {
    return [];
  }
}
