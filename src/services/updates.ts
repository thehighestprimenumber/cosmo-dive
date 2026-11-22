import * as Updates from 'expo-updates';

/**
 * Over-the-air updates (EAS Update): app changes that don't touch native code
 * arrive without installing an APK. Checked when the app starts and when it
 * comes back to the foreground; downloaded in the background.
 */
export const updatesEnabled = () => Updates.isEnabled && !__DEV__;

/** Download a newer update if there is one. True when one is ready to apply. */
export async function fetchUpdate(): Promise<boolean> {
  if (!updatesEnabled()) return false;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return false;
    const r = await Updates.fetchUpdateAsync();
    return r.isNew;
  } catch {
    return false; // offline or no updates server: try again next time
  }
}

/** Restart into the downloaded update. */
export const applyUpdate = () => Updates.reloadAsync();

/** For Diagnostics: which update is running. */
export function updateInfo(): string {
  if (!Updates.isEnabled) return 'Updates: off in this build';
  const id = Updates.updateId ? Updates.updateId.slice(0, 8) : 'built-in';
  const when = Updates.createdAt ? Updates.createdAt.toLocaleString() : '';
  return `Update ${id}${when ? ` (${when})` : ''} · channel ${Updates.channel ?? '?'} · runtime ${(Updates.runtimeVersion ?? '?').slice(0, 8)}`;
}
