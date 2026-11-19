import { describe, expect, it } from 'vitest';
import { fakeDb } from '../test/fakeDb';
import { buildBackup, parseBackup, restoreBackup } from './backup';
import { insertGoal, loadGoals, loadResults, loadSettings, migrate, saveResults, saveSettings } from './db';

const goal = (date: string, minutes: number) => ({
  date,
  goal: { kind: 'duration' as const, seconds: minutes * 60 },
  planVersion: 1,
});

describe('backup', () => {
  it('round-trips goals and preferences to a new phone', async () => {
    const old = fakeDb();
    await migrate(old);
    await saveSettings(old, { startDate: '2026-10-01', onboarded: true, maxHr: 177, restDaysPerWeek: 1 });
    await insertGoal(old, goal('2026-10-01', 30));
    await insertGoal(old, { date: '2026-10-02', goal: null, planVersion: 1 });
    const text = JSON.stringify(await buildBackup(old, '2026-11-19'));

    const fresh = fakeDb();
    await migrate(fresh);
    // The new phone already made today's goal during onboarding.
    await saveSettings(fresh, { startDate: '2026-11-19', onboarded: true });
    await insertGoal(fresh, goal('2026-11-19', 25));
    await saveResults(fresh, [{ date: '2026-11-19', goal: null, value: 1, done: true }]);

    const added = await restoreBackup(fresh, parseBackup(text), '2026-11-19');
    expect(added).toBe(2);
    expect((await loadGoals(fresh, '2026-01-01', '2026-12-31')).map((g) => g.date)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-11-19',
    ]);
    const s = await loadSettings(fresh, '2026-11-19');
    expect(s.startDate).toBe('2026-10-01');
    expect(s.maxHr).toBe(177);
    expect(s.restDaysPerWeek).toBe(1);
    expect((await loadResults(fresh, '2026-01-01', '2026-12-31')).size).toBe(0);
  });

  it('never overwrites a goal that already exists', async () => {
    const db = fakeDb();
    await migrate(db);
    await insertGoal(db, goal('2026-11-19', 25));
    const backup = parseBackup(
      JSON.stringify({
        app: 'daily-spark',
        version: 1,
        exportedAt: '',
        settings: { startDate: '2026-11-19', restDays: [], rideFactor: 3, maxHr: 180, morningReminder: '08:00', eveningReminder: '19:30' },
        goals: [goal('2026-11-19', 99)],
      }),
    );
    expect(await restoreBackup(db, backup, '2026-11-19')).toBe(0);
    const [g] = await loadGoals(db, '2026-11-19', '2026-11-19');
    expect(g.goal).toEqual({ kind: 'duration', seconds: 25 * 60 });
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow('not valid JSON');
    expect(() => parseBackup('{"app":"other"}')).toThrow('not a Daily Spark backup');
    expect(() =>
      parseBackup(JSON.stringify({ app: 'daily-spark', version: 1, settings: { startDate: '2026-01-01' }, goals: [{ date: 'x' }] })),
    ).toThrow('invalid goal');
  });

  it('turns old fixed rest days into a number per week (settings and old backups)', async () => {
    const db = fakeDb();
    await migrate(db);
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('restDays', '[2,5]')");
    expect((await loadSettings(db, '2026-11-19')).restDaysPerWeek).toBe(2);

    const legacy = parseBackup(
      JSON.stringify({
        app: 'daily-spark',
        version: 1,
        exportedAt: '',
        settings: { startDate: '2026-11-01', restDays: [0, 3, 6], rideFactor: 3, maxHr: 180, morningReminder: '08:00', eveningReminder: '19:30' },
        goals: [],
      }),
    );
    const fresh = fakeDb();
    await migrate(fresh);
    await restoreBackup(fresh, legacy, '2026-11-19');
    expect((await loadSettings(fresh, '2026-11-19')).restDaysPerWeek).toBe(3);
  });
});
