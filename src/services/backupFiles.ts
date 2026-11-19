import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as Sharing from 'expo-sharing';
import { buildBackup, parseBackup, restoreBackup } from '../data/backup';
import { toDateKey } from '../domain/dates';

/** Writes the goal history to a JSON file and opens the share sheet (Drive, email, Files…). */
export async function exportHistory(db: SQLiteDatabase): Promise<void> {
  const today = toDateKey(new Date());
  const backup = await buildBackup(db, today);
  const file = new File(Paths.cache, `daily-spark-backup-${today}.json`);
  file.create({ overwrite: true });
  await file.write(JSON.stringify(backup, null, 2));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your Daily Spark history' });
}

/** Lets the user pick a backup file and merges it in. Returns goals added, or null if cancelled. */
export async function importHistory(db: SQLiteDatabase): Promise<number | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', 'application/octet-stream'] });
  if (picked.canceled) return null;
  const backup = parseBackup(await picked.result.text());
  return restoreBackup(db, backup, toDateKey(new Date()));
}
