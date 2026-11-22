import type { SQLiteDatabase } from 'expo-sqlite';
import type { CoachRecord } from '../domain/coach';
import type { ChatMessage } from '../domain/coachChat';
import type { WeekPlan } from '../domain/plan';
import { DEFAULT_SETTINGS, type DailyGoal, type DateKey, type DayResult, type GoalMeta, type GoalSpec, type Settings } from '../domain/types';

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
  // v2: why each goal is what it is (GoalMeta JSON).
  `ALTER TABLE goals ADD COLUMN meta TEXT;`,
  // v3: weekly plans (which day each key session is on).
  `CREATE TABLE week_plans (
     week TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  // v4: the AI coach's weekly reviews (and failed attempts).
  `CREATE TABLE coach_reviews (
     week TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  // v5: the coach chat.
  `CREATE TABLE coach_chat (
     id TEXT PRIMARY KEY NOT NULL,
     at INTEGER NOT NULL,
     data TEXT NOT NULL
   );`,
  // v6: how hard key sessions felt (1–10), and extras you tick off (strength & mobility).
  `CREATE TABLE feelings (
     date TEXT PRIMARY KEY NOT NULL,
     rpe INTEGER NOT NULL,
     at INTEGER NOT NULL
   );
   CREATE TABLE extras (
     date TEXT NOT NULL,
     kind TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (date, kind)
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
  const stored: Record<string, unknown> = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  // Fixed rest days (plans v1–v2) became a number of flexible rest days per week.
  if (stored.restDaysPerWeek === undefined && Array.isArray(stored.restDays)) {
    stored.restDaysPerWeek = stored.restDays.length;
  }
  delete stored.restDays;
  delete stored.minDistanceKm;
  delete stored.widgetState; // stored here too, but it isn't a setting
  delete stored.weatherCache; // same
  return { ...DEFAULT_SETTINGS, startDate: today, ...(stored as Partial<Settings>) };
}

export async function saveSettings(db: SQLiteDatabase, patch: Partial<Settings>): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [key, value] of Object.entries(patch)) {
      await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, JSON.stringify(value));
    }
  });
}

// ---- goals ----

type GoalRow = { date: string; spec: string | null; plan_version: number; meta: string | null };

const toGoal = (r: GoalRow): DailyGoal => ({
  date: r.date,
  goal: r.spec ? (JSON.parse(r.spec) as GoalSpec) : null,
  planVersion: r.plan_version,
  ...(r.meta ? { meta: JSON.parse(r.meta) as GoalMeta } : {}),
});

export async function loadGoals(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<DailyGoal[]> {
  const rows = await db.getAllAsync<GoalRow>(
    'SELECT date, spec, plan_version, meta FROM goals WHERE date >= ? AND date <= ? ORDER BY date',
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
    'INSERT OR IGNORE INTO goals (date, spec, plan_version, created_at, meta) VALUES (?, ?, ?, ?, ?)',
    g.date,
    g.goal ? JSON.stringify(g.goal) : null,
    g.planVersion,
    new Date().toISOString(),
    g.meta ? JSON.stringify(g.meta) : null,
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

// ---- weekly plans ----

export async function loadWeekPlan(db: SQLiteDatabase, week: DateKey): Promise<WeekPlan | null> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM week_plans WHERE week = ?', week);
  return row ? (JSON.parse(row.data) as WeekPlan) : null;
}

export async function saveWeekPlan(db: SQLiteDatabase, plan: WeekPlan): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO week_plans (week, data, updated_at) VALUES (?, ?, ?)',
    plan.week,
    JSON.stringify(plan),
    new Date().toISOString(),
  );
}

// ---- coach reviews ----

export async function loadCoachRecord(db: SQLiteDatabase, week: DateKey): Promise<CoachRecord | null> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM coach_reviews WHERE week = ?', week);
  return row ? (JSON.parse(row.data) as CoachRecord) : null;
}

export async function saveCoachRecord(db: SQLiteDatabase, week: DateKey, record: CoachRecord): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO coach_reviews (week, data, updated_at) VALUES (?, ?, ?)',
    week,
    JSON.stringify(record),
    new Date().toISOString(),
  );
}

// ---- coach chat ----

export async function loadChat(db: SQLiteDatabase): Promise<ChatMessage[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM coach_chat ORDER BY at, id');
  return rows.map((r) => JSON.parse(r.data) as ChatMessage);
}

export async function saveChatMessage(db: SQLiteDatabase, m: ChatMessage): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO coach_chat (id, at, data) VALUES (?, ?, ?)', m.id, m.at, JSON.stringify(m));
}

export async function clearChat(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM coach_chat');
}

// ---- how it felt (1–10) ----

export async function loadFeelings(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<Map<DateKey, number>> {
  const rows = await db.getAllAsync<{ date: string; rpe: number }>(
    'SELECT date, rpe FROM feelings WHERE date >= ? AND date <= ?',
    from,
    to,
  );
  return new Map(rows.map((r) => [r.date, r.rpe]));
}

export async function saveFeeling(db: SQLiteDatabase, date: DateKey, rpe: number): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO feelings (date, rpe, at) VALUES (?, ?, ?)', date, rpe, Date.now());
}

// ---- extras (strength & mobility) ----

export type ExtraKind = 'strength';

export async function loadExtras(db: SQLiteDatabase, from: DateKey, to: DateKey): Promise<{ date: DateKey; kind: ExtraKind }[]> {
  return db.getAllAsync<{ date: string; kind: ExtraKind }>(
    'SELECT date, kind FROM extras WHERE date >= ? AND date <= ? ORDER BY date',
    from,
    to,
  );
}

export async function setExtra(db: SQLiteDatabase, date: DateKey, kind: ExtraKind, done: boolean): Promise<void> {
  if (done) await db.runAsync('INSERT OR REPLACE INTO extras (date, kind, at) VALUES (?, ?, ?)', date, kind, Date.now());
  else await db.runAsync('DELETE FROM extras WHERE date = ? AND kind = ?', date, kind);
}
