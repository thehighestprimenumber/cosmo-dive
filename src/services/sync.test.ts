import { describe, expect, it } from 'vitest';
import { loadGoals, migrate } from '../data/db';
import { fakeDb } from '../test/fakeDb';
import { addDays, startOfDay, toDateKey } from '../domain/dates';
import { DEFAULT_SETTINGS, type Activity, type Settings } from '../domain/types';
import type { ActivitySource } from '../sources/ActivitySource';
import { refresh } from './sync';

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

const settings: Settings = { ...DEFAULT_SETTINGS, restDaysPerWeek: 2, startDate: '2026-11-02', onboarded: true };

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
    await refresh(db, sourceOf(acts), { ...settings, restDaysPerWeek: 0, rideFactor: 9 }, { now });
    expect(JSON.stringify(await loadGoals(db, '2026-01-01', '2026-12-31'))).toBe(before);
  });

  it('re-checks history when activities change (e.g. a deleted workout)', async () => {
    // No rest days, so the deleted workout's day is a miss.
    const noRest = { ...settings, restDaysPerWeek: 0 };
    const db = fakeDb();
    await migrate(db);
    const acts = Array.from({ length: 41 }, (_, i) => {
      const d = addDays('2026-10-01', i);
      return walk(d, d < '2026-11-01' ? 30 : 300);
    });
    const now = new Date(2026, 10, 10, 20, 0);
    await refresh(db, sourceOf(acts), noRest, { now });

    const without5th = acts.filter((a) => a.id !== '2026-11-05');
    const snap = await refresh(db, sourceOf(without5th), noRest, { now, fullRebuild: true });
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

  it('replaces today\'s goal from older rules, unless it is already done', async () => {
    const { insertGoal } = await import('../data/db');
    const now = new Date(2026, 10, 10, 9, 0);
    const oldGoal = {
      date: '2026-11-10',
      goal: { kind: 'distance' as const, meters: 2300, suggestedSport: 'walk' as const },
      planVersion: 1,
    };

    // Not done yet → replaced by the current rules.
    const db = fakeDb();
    await migrate(db);
    await insertGoal(db, oldGoal);
    await refresh(db, sourceOf([]), { ...settings, startDate: '2026-11-10' }, { now });
    const [replaced] = await loadGoals(db, '2026-11-10', '2026-11-10');
    expect(replaced.planVersion).toBeGreaterThan(1);

    // Already done → kept exactly as it was.
    const db2 = fakeDb();
    await migrate(db2);
    await insertGoal(db2, oldGoal);
    await refresh(db2, sourceOf([walk('2026-11-10', 60)]), { ...settings, startDate: '2026-11-10' }, { now });
    const [kept] = await loadGoals(db2, '2026-11-10', '2026-11-10');
    expect(kept).toEqual(oldGoal);
  });

  it('days without the goal use the week\'s flexible rest days before breaking the streak', async () => {
    const db = fakeDb();
    await migrate(db);
    // Mon 9 – Fri 13 Nov: walk Mon, nothing Tue–Thu, walk Fri. Two rest days per week.
    const acts = [walk('2026-11-09', 300), walk('2026-11-13', 300)];
    const snap = await refresh(db, sourceOf(acts), { ...settings, startDate: '2026-11-09' }, {
      now: new Date(2026, 10, 13, 20, 0),
    });
    expect(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) => snap.days.get(d)?.status)).toEqual([
      'done',
      'rest',
      'rest',
      'missed',
      'done',
    ]);
    expect(snap.streak.current).toBe(1);
    expect(snap.streak.restLeftThisWeek).toBe(0);
    // Every day got a real goal, with reasons attached.
    const goals = await loadGoals(db, '2026-11-09', '2026-11-13');
    expect(goals.every((g) => g.goal !== null && g.meta && g.meta.notes.length > 0)).toBe(true);
  });

  it('redoes today\'s goal once last night\'s sleep arrives, using readiness', async () => {
    const db = fakeDb();
    await migrate(db);
    const date = '2026-11-19';
    const acts = Array.from({ length: 10 }, (_, i) => walk(addDays(date, -(i + 2)), 60));
    const usual = Array.from({ length: 10 }, (_, i) => ({ date: addDays(date, -(i + 1)), sleepS: 7 * 3600, lowHr: 55 }));
    let nights = usual;
    const source = { ...sourceOf(acts), getNights: async () => nights };
    const s = { ...settings, startDate: date };

    // 1 am: last night isn't over yet.
    const early = await refresh(db, source, s, { now: new Date(2026, 10, 19, 1, 0) });
    expect(early.todayReadiness).toBe('unknown');
    const before = early.todayGoal!;

    // 9 am: a 4-hour night has synced → today's goal is redone, lighter, and says why.
    nights = [...usual, { date, sleepS: 4 * 3600, lowHr: 55 }];
    const later = await refresh(db, source, s, { now: new Date(2026, 10, 19, 9, 0) });
    expect(later.todayReadiness).toBe('low');
    const t = (g: typeof before) => (g!.kind === 'distance' ? g!.meters : (g as { seconds: number }).seconds);
    expect(t(later.todayGoal!)).toBeLessThan(t(before));
    expect(later.todayNotes.join(' ')).toContain('Short night');
  });

  it('switching today to a time goal lets a kayak session complete it', async () => {
    const db = fakeDb();
    await migrate(db);
    const start = startOfDay('2026-11-19').getTime() + 10 * 3_600_000;
    const kayak = {
      id: 'kayak', sport: 'other' as const, label: 'paddling', start, end: start + 90 * 60_000,
      durationS: 90 * 60, distanceM: 8000, hr: [], origin: 'test',
    };
    const s = { ...settings, startDate: '2026-11-19' };
    const now = new Date(2026, 10, 19, 18, 0);
    await refresh(db, sourceOf([kayak]), s, { now });
    const snap = await refresh(db, sourceOf([kayak]), s, { now, regenerateToday: true, todayKind: 'duration' });
    expect(snap.todayGoal?.kind).toBe('duration');
    expect(snap.todayProgress?.done).toBe(true);
    expect(snap.days.get('2026-11-19')?.status).toBe('done');
  });
});

