import type { SQLiteDatabase } from 'expo-sqlite';
import { saveSettings, setExtra } from '../data/db';
import type { DateKey, Settings } from '../domain/types';

/**
 * Strength sessions finished on the watch become ticks on the phone, once
 * each: a day you later untick on the phone isn't ticked again.
 */
export async function importWatchStrength(
  db: SQLiteDatabase,
  settings: Settings,
  fromWatch: DateKey[],
): Promise<DateKey[]> {
  const fresh = fromWatch.filter((d) => !settings.watchStrengthImported.includes(d));
  if (!fresh.length) return [];
  for (const d of fresh) await setExtra(db, d, 'strength', true);
  const imported = [...settings.watchStrengthImported, ...fresh].sort().slice(-60);
  await saveSettings(db, { watchStrengthImported: imported });
  settings.watchStrengthImported = imported;
  return fresh;
}
