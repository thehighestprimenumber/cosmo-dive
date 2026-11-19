import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_SETTINGS, type DailyGoal, type DateKey, type DayResult, type GoalSpec, type Settings } from '../domain/types';

export const DB_NAME = 'daily-spark.db';

/**
 * Schema
 * - goals:       one row per day, written once (the only history Health Connect can't rebuild).
 * - day_results: a cache of how each day went. It can always be recomputed
 *                from goals + Health Connect ("Rebuild history" in Settings).
 * - settings:    key/value JSON.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE goals (
     date TEXT PRIMARY KEY NOT NULL,
     spec TEXT,
     plan_version INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE day_results (
     date TEXT PRIMARY KEY NOT NULL,
     value REAL NOT NULL,
     done INTEGER NOT NULL,
     computed_at TEXT NOT NULL
   );
   CREATE TABLE settings (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
    version++;
  }
}

// ---- settings ----

export async function loadSettings(db: SQLiteDatabase, today: DateKey): Promise<Settings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  return { ...DEFAULT_SETTINGS, startDate: today, ...stored };
}

export async function saveSettings(db: SQLiteDatabase, patch: Partial<Settings>): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [key, value] of Object.entries(patch)) {
      await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, JSON.stringify(value));
    }
  });
}

// ---- goals ----

type GoalRow = { date: string; spec: string | null; plan_version: number };

const toGoal = (r: GoalRow): DailyGoal => ({
  date: r.date,
  goal: r.spec ? (JSON.parse(r.spec) as GoalSpec) : null,
  planVersion: r.plan_version,
});

export async function loadGoals(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<DailyGoal[]> {
  const rows = await db.getAllAsync<GoalRow>(
    'SELECT date, spec, plan_version FROM goals WHERE date >= ? AND date <= ? ORDER BY date',
    from,
    to,
  );
  return rows.map(toGoal);
}

export async function lastGoalDate(db: SQLiteDatabase): Promise<DateKey | null> {
  const row = await db.getFirstAsync<{ date: string | null }>('SELECT MAX(date) AS date FROM goals');
  return row?.date ?? null;
}

/** Goals are never overwritten: INSERT OR IGNORE keeps the original if one exists. */
export async function insertGoal(db: SQLiteDatabase, g: DailyGoal): Promise<void> {
  await db.runAsync(
    'INSERT OR IGNORE INTO goals (date, spec, plan_version, created_at) VALUES (?, ?, ?, ?)',
    g.date,
    g.goal ? JSON.stringify(g.goal) : null,
    g.planVersion,
    new Date().toISOString(),
  );
}

/**
 * The only place a goal is ever removed: replacing today's not-yet-completed
 * goal (rules or settings changed). Past goals are never touched.
 */
export async function deleteGoal(db: SQLiteDatabase, date: DateKey): Promise<void> {
  await db.runAsync('DELETE FROM goals WHERE date = ?', date);
  await db.runAsync('DELETE FROM day_results WHERE date = ?', date);
}

// ---- day results cache ----

export async function loadResults(
  db: SQLiteDatabase,
  from: DateKey,
  to: DateKey,
): Promise<Map<DateKey, { value: number; done: boolean }>> {
  const rows = await db.getAllAsync<{ date: string; value: number; done: number }>(
    'SELECT date, value, done FROM day_results WHERE date >= ? AND date <= ?',
    from,
    to,
  );
  return new Map(rows.map((r) => [r.date, { value: r.value, done: r.done === 1 }]));
}

export async function saveResults(db: SQLiteDatabase, results: DayResult[]): Promise<void> {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const r of results) {
      await db.runAsync(
        'INSERT OR REPLACE INTO day_results (date, value, done, computed_at) VALUES (?, ?, ?, ?)',
        r.date,
        r.value,
        r.done ? 1 : 0,
        now,
      );
    }
  });
}

export async function clearResults(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM day_results');
}
