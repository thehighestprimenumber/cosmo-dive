/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';
import { loadGoals, migrate } from '../data/db';
import { addDays, startOfDay, toDateKey } from '../domain/dates';
import { DEFAULT_SETTINGS, type Activity, type Settings } from '../domain/types';
import type { ActivitySource } from '../sources/ActivitySource';
import { refresh } from './sync';

/** Just enough of expo-sqlite's async API, backed by Node's built-in SQLite. */
function fakeDb(): SQLiteDatabase {
  const db = new DatabaseSync(':memory:');
  const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
  const api = {
    execAsync: async (sql: string) => db.exec(sql),
    runAsync: async (sql: string, ...p: unknown[]) => db.prepare(sql).run(...(flat(p) as never[])),
    getAllAsync: async (sql: string, ...p: unknown[]) => db.prepare(sql).all(...(flat(p) as never[])),
    getFirstAsync: async (sql: string, ...p: unknown[]) => db.prepare(sql).get(...(flat(p) as never[])) ?? null,
    withTransactionAsync: async (fn: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return api as unknown as SQLiteDatabase;
}

function walk(date: string, minutes: number): Activity {
  const start = startOfDay(date).getTime() + 9 * 3_600_000;
  return {
    id: date,
    sport: 'walk',
    start,
    end: start + minutes * 60_000,
    durationS: minutes * 60,
    distanceM: minutes * 80,
    hr: [],
    origin: 'test',
  };
}

function sourceOf(acts: Activity[]): ActivitySource {
  return {
    name: 'test',
    status: async () => ({ state: 'ready' }),
    requestAccess: async () => true,
    getActivities: async (from, to) => acts.filter((a) => a.start >= from.getTime() && a.start < to.getTime()),
  };
}

const settings: Settings = { ...DEFAULT_SETTINGS, restDays: [], startDate: '2026-11-02', onboarded: true };

describe('refresh', () => {
  it('back-fills one goal per day, never rewrites them, and builds a streak', async () => {
    const db = fakeDb();
    await migrate(db);
    // Short walks in October set the baseline; long walks in November beat every goal.
    const acts = Array.from({ length: 41 }, (_, i) => {
      const d = addDays('2026-10-01', i);
      return walk(d, d < '2026-11-01' ? 30 : 300);
    });
    const now = new Date(2026, 10, 10, 20, 0); // 10 Nov, evening

    const snap = await refresh(db, sourceOf(acts), settings, { now });
    const goals = await loadGoals(db, '2026-01-01', '2026-12-31');
    expect(goals.map((g) => g.date)).toEqual(Array.from({ length: 9 }, (_, i) => addDays('2026-11-02', i)));
    expect(snap.today).toBe('2026-11-10');
    expect(snap.todayProgress?.done).toBe(true);
    expect(snap.streak.current).toBe(9);
    expect(snap.streak.freezes).toBe(1);

    // A second refresh with different rules must not change stored goals.
    const before = JSON.stringify(goals);
    await refresh(db, sourceOf(acts), { ...settings, restDays: [0, 1, 2, 3, 4, 5, 6] }, { now });
    expect(JSON.stringify(await loadGoals(db, '2026-01-01', '2026-12-31'))).toBe(before);
  });

  it('re-checks history when activities change (e.g. a deleted workout)', async () => {
    const db = fakeDb();
    await migrate(db);
    const acts = Array.from({ length: 41 }, (_, i) => {
      const d = addDays('2026-10-01', i);
      return walk(d, d < '2026-11-01' ? 30 : 300);
    });
    const now = new Date(2026, 10, 10, 20, 0);
    await refresh(db, sourceOf(acts), settings, { now });

    const without5th = acts.filter((a) => a.id !== '2026-11-05');
    const snap = await refresh(db, sourceOf(without5th), settings, { now, fullRebuild: true });
    // 3 days done → 5th missed (no freeze yet) → 5 more done.
    expect(snap.days.get('2026-11-05')?.status).toBe('missed');
    expect(snap.streak.current).toBe(5);
    expect(snap.streak.longest).toBe(5);
  });

  it('leaves today pending rather than missed', async () => {
    const db = fakeDb();
    await migrate(db);
    const now = new Date(2026, 10, 2, 9, 0);
    const snap = await refresh(db, sourceOf([]), settings, { now });
    expect(toDateKey(now)).toBe('2026-11-02');
    expect(snap.days.get('2026-11-02')?.status).toBe('pending');
    expect(snap.streak.current).toBe(0);
  });
});
