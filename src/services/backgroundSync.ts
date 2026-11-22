import * as BackgroundTask from 'expo-background-task';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { DB_NAME, loadSettings, migrate, saveSettings } from '../data/db';
import { toDateKey } from '../domain/dates';
import { sourceFor } from '../sources';
import { afterSync } from './afterSync';
import { workCalendarFor } from './calendar';
import { weatherFor } from './weather';
import { importWatchStrength } from './watchStrength';
import { strengthDoneOnWatch } from '../../modules/wear-sync';
import { refresh } from './sync';

export const SYNC_TASK = 'daily-spark-sync';

/**
 * Must run at import time (it is imported from the root layout), so Android
 * can find the task when it starts the app in the background.
 *
 * Android decides when this actually runs (at least ~30 min apart, less often
 * on low battery). Samsung's battery optimisation can delay it further:
 * set the app's battery usage to "Unrestricted".
 */
TaskManager.defineTask(SYNC_TASK, async () => {
  let db: SQLite.SQLiteDatabase | null = null;
  try {
    db = await SQLite.openDatabaseAsync(DB_NAME);
    await migrate(db);
    const settings = await loadSettings(db, toDateKey(new Date()));
    if (!settings.onboarded) return BackgroundTask.BackgroundTaskResult.Success;

    const source = sourceFor(settings);
    if ((await source.status()).state !== 'ready') return BackgroundTask.BackgroundTaskResult.Failed;

    await importWatchStrength(db, settings, await strengthDoneOnWatch()).catch(() => []);
    const snap = await refresh(db, source, settings, { calendar: workCalendarFor(settings), weather: weatherFor(db, settings) });
    await afterSync(db, settings, snap, { inBackground: true });
    await saveSettings(db, { lastBackgroundSync: Date.now() });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  } finally {
    await db?.closeAsync().catch(() => {});
  }
});

export async function registerBackgroundSync(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) return;
  await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 30 });
}

export async function backgroundSyncStatus(): Promise<{ available: boolean; registered: boolean }> {
  const status = await BackgroundTask.getStatusAsync();
  return {
    available: status === BackgroundTask.BackgroundTaskStatus.Available,
    registered: await TaskManager.isTaskRegisteredAsync(SYNC_TASK),
  };
}
