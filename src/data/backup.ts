import type { SQLiteDatabase } from 'expo-sqlite';
import type { DailyGoal, DateKey, Settings } from '../domain/types';
import { clearResults, insertGoal, loadExtras, loadFeelings, loadGoals, loadSettings, saveFeeling, saveSettings, setExtra, type ExtraKind } from './db';

/**
 * Goal history is the one thing Health Connect can't rebuild, so it can be
 * exported to a JSON file (and imported on a new phone). Everything else
 * (results, streaks) is recalculated after an import.
 */
export type Backup = {
  app: 'daily-spark';
  version: 1;
  exportedAt: string;
  settings: Pick<Settings, 'restDaysPerWeek' | 'rideFactor' | 'maxHr' | 'morningReminder' | 'eveningReminder' | 'startDate'>;
  goals: DailyGoal[];
  /** How hard key sessions felt (added later; optional in older files). */
  feelings?: { date: DateKey; rpe: number }[];
  /** Strength & mobility sessions ticked off (optional in older files). */
  extras?: { date: DateKey; kind: ExtraKind }[];
};

export async function buildBackup(db: SQLiteDatabase, today: DateKey): Promise<Backup> {
  const s = await loadSettings(db, today);
  return {
    app: 'daily-spark',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      restDaysPerWeek: s.restDaysPerWeek,
      rideFactor: s.rideFactor,
      maxHr: s.maxHr,
      morningReminder: s.morningReminder,
      eveningReminder: s.eveningReminder,
      startDate: s.startDate,
    },
    goals: await loadGoals(db, '0000-01-01', '9999-12-31'),
    feelings: [...(await loadFeelings(db, '0000-01-01', '9999-12-31'))].map(([date, rpe]) => ({ date, rpe })),
    extras: await loadExtras(db, '0000-01-01', '9999-12-31'),
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
  const known = await loadFeelings(db, '0000-01-01', '9999-12-31');
  for (const f of backup.feelings ?? []) {
    if (DATE_RE.test(f.date) && f.rpe >= 1 && f.rpe <= 10 && !known.has(f.date)) await saveFeeling(db, f.date, f.rpe);
  }
  for (const x of backup.extras ?? []) if (DATE_RE.test(x.date) && x.kind === 'strength') await setExtra(db, x.date, x.kind, true);
  const after = (await loadGoals(db, '0000-01-01', '9999-12-31')).length;

  const startDate = current.onboarded && current.startDate < backup.settings.startDate
    ? current.startDate
    : backup.settings.startDate;
  // Backups from before flexible rest days stored fixed weekdays instead.
  const { restDays, ...prefs } = backup.settings as Backup['settings'] & { restDays?: number[] };
  if (prefs.restDaysPerWeek === undefined && Array.isArray(restDays)) prefs.restDaysPerWeek = restDays.length;
  await saveSettings(db, { ...prefs, startDate });
  await clearResults(db);
  return after - before;
}
