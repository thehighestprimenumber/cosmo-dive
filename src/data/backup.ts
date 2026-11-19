import type { SQLiteDatabase } from 'expo-sqlite';
import type { DailyGoal, DateKey, Settings } from '../domain/types';
import { clearResults, insertGoal, loadGoals, loadSettings, saveSettings } from './db';

/**
 * Goal history is the one thing Health Connect can't rebuild, so it can be
 * exported to a JSON file (and imported on a new phone). Everything else
 * (results, streaks) is recalculated after an import.
 */
export type Backup = {
  app: 'daily-spark';
  version: 1;
  exportedAt: string;
  settings: Pick<Settings, 'restDays' | 'rideFactor' | 'maxHr' | 'morningReminder' | 'eveningReminder' | 'startDate'>;
  goals: DailyGoal[];
};

export async function buildBackup(db: SQLiteDatabase, today: DateKey): Promise<Backup> {
  const s = await loadSettings(db, today);
  return {
    app: 'daily-spark',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      restDays: s.restDays,
      rideFactor: s.rideFactor,
      maxHr: s.maxHr,
      morningReminder: s.morningReminder,
      eveningReminder: s.eveningReminder,
      startDate: s.startDate,
    },
    goals: await loadGoals(db, '0000-01-01', '9999-12-31'),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Throws a readable error if the file isn't a Daily Spark backup. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const b = data as Partial<Backup>;
  if (b?.app !== 'daily-spark' || b.version !== 1 || !Array.isArray(b.goals) || !b.settings) {
    throw new Error('This file is not a Daily Spark backup.');
  }
  for (const g of b.goals) {
    if (!g || typeof g.date !== 'string' || !DATE_RE.test(g.date) || typeof g.planVersion !== 'number') {
      throw new Error('The backup contains an invalid goal.');
    }
  }
  if (typeof b.settings.startDate !== 'string' || !DATE_RE.test(b.settings.startDate)) {
    throw new Error('The backup has an invalid start date.');
  }
  return b as Backup;
}

/**
 * Adds the backup's goals (goals already on this phone win, as they are never
 * rewritten) and its preferences. The plan start moves back to the earliest
 * of the two, so the streak replays the whole history. Returns goals added.
 */
export async function restoreBackup(db: SQLiteDatabase, backup: Backup, today: DateKey): Promise<number> {
  const current = await loadSettings(db, today);
  const before = (await loadGoals(db, '0000-01-01', '9999-12-31')).length;
  for (const g of backup.goals) await insertGoal(db, g);
  const after = (await loadGoals(db, '0000-01-01', '9999-12-31')).length;

  const startDate = current.onboarded && current.startDate < backup.settings.startDate
    ? current.startDate
    : backup.settings.startDate;
  await saveSettings(db, { ...backup.settings, startDate });
  await clearResults(db);
  return after - before;
}
