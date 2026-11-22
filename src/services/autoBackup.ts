import { Directory, File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { buildBackup } from '../data/backup';
import { saveSettings } from '../data/db';
import { toDateKey } from '../domain/dates';
import type { Settings } from '../domain/types';

/**
 * Weekly automatic backup of the history to a folder you pick once (Android's
 * folder picker). Keeps the last 8 files. Android doesn't let apps pick a
 * Google Drive folder directly; a phone folder that you sync or copy works.
 */
export const BACKUP_EVERY_MS = 7 * 86_400_000;
export const KEEP_BACKUPS = 8;
const PREFIX = 'daily-spark-backup-';

/** Backups beyond the newest `keep` (names sort by date and time). */
export function oldBackups(names: string[], keep = KEEP_BACKUPS): string[] {
  const ours = names.filter((n) => n.startsWith(PREFIX) && n.endsWith('.json')).sort();
  return ours.slice(0, Math.max(0, ours.length - keep));
}

export function backupDue(settings: Settings, now: number): boolean {
  if (!settings.backupFolder) return false;
  const last = settings.lastAutoBackup;
  if (!last) return true;
  // After a failure, try again in a day rather than a week.
  return now - last.at >= (last.ok ? BACKUP_EVERY_MS : 86_400_000);
}

/** Opens Android's folder picker; returns the folder's address, or null if cancelled. */
export async function chooseBackupFolder(): Promise<string | null> {
  try {
    const dir = await Directory.pickDirectoryAsync();
    return dir?.uri ?? null;
  } catch {
    return null;
  }
}

/** Writes a backup now (if `force` or due). Records how it went in settings. */
export async function runAutoBackup(db: SQLiteDatabase, settings: Settings, force = false): Promise<Settings['lastAutoBackup']> {
  const now = Date.now();
  if (!settings.backupFolder || (!force && !backupDue(settings, now))) return settings.lastAutoBackup;
  let result: NonNullable<Settings['lastAutoBackup']>;
  try {
    const d = new Date(now);
    const stamp = `${toDateKey(now)}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const dir = new Directory(settings.backupFolder);
    const file = dir.createFile(`${PREFIX}${stamp}.json`, 'application/json');
    await file.write(JSON.stringify(await buildBackup(db, toDateKey(now)), null, 2));
    const files = dir.list().filter((x): x is File => x instanceof File);
    const old = new Set(oldBackups(files.map((f) => f.name)));
    for (const f of files) if (old.has(f.name)) f.delete();
    result = { at: now, ok: true };
  } catch (e) {
    result = { at: now, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  await saveSettings(db, { lastAutoBackup: result });
  settings.lastAutoBackup = result;
  return result;
}
