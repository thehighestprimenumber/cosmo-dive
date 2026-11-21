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
    const t = (g: typeof before) => ('meters' in g! ? g!.meters : g!.seconds);
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

  it('an aim raises this month\'s challenge even if a lower one was already set', async () => {
    const db = fakeDb();
    await migrate(db);
    const now = new Date(2026, 10, 20, 9, 0);
    const s = { ...settings, startDate: '2026-11-20', monthTargets: { '2026-11': 40 } };
    expect((await refresh(db, sourceOf([]), s, { now })).game.monthTarget).toBe(40);
    const withAim = { ...s, dailyTargetKm: 5 };
    const snap = await refresh(db, sourceOf([]), withAim, { now });
    expect(snap.game.monthTarget).toBe(150);
    expect(snap.aim).toEqual({ km: 5, averageKm: 0, suggestion: null });
  });

  it('offers to raise the aim once your 14-day average reaches it', async () => {
    const db = fakeDb();
    await migrate(db);
    const now = new Date(2026, 10, 20, 20, 0);
    // 14 days × 6 km = 6 km/day on average, aim 5.
    const acts = Array.from({ length: 14 }, (_, i) => ({ ...walk(addDays('2026-11-20', -i), 70), distanceM: 6000 }));
    const s = { ...settings, startDate: '2026-11-07', dailyTargetKm: 5 };
    const snap = await refresh(db, sourceOf(acts), s, { now });
    expect(snap.aim).toMatchObject({ km: 5, suggestion: 5.5 });
    expect(snap.aim!.averageKm).toBeCloseTo(6);
    expect(snap.game.newlyUnlocked).toContain('aim_reached');
    const snoozed = await refresh(db, sourceOf(acts), { ...s, aimSnoozedUntil: '2026-11-27' }, { now });
    expect(snoozed.aim?.suggestion).toBeNull();
  });

  describe('weekly plan', () => {
    const MON = '2026-11-23';
    const s = { ...settings, startDate: '2026-11-16' };
    const plan = (longDay: string, briskDay: string) => ({
      week: MON,
      sessions: [
        { id: 'long', kind: 'long_walk' as const, day: longDay, plannedDay: longDay },
        { id: 'brisk', kind: 'brisk_walk' as const, day: briskDay, plannedDay: briskDay },
      ],
    });
    const at = (day: string, hour: number) => {
      const d = startOfDay(day);
      d.setHours(hour);
      return d;
    };

    it('makes the key session the goal on its day', async () => {
      const { saveWeekPlan } = await import('../data/db');
      const db = fakeDb();
      await migrate(db);
      await saveWeekPlan(db, plan(addDays(MON, 5), addDays(MON, 2)));
      const snap = await refresh(db, sourceOf([]), s, { now: at(addDays(MON, 2), 9) });
      expect(snap.todayGoal?.kind).toBe('brisk_walk');
      expect(snap.previews[addDays(MON, 5)]?.kind).toBe('long_walk');
    });

    it('a missed brisk walk moves to today; picking another goal type moves it on again', async () => {
      const { saveWeekPlan } = await import('../data/db');
      const db = fakeDb();
      await migrate(db);
      await saveWeekPlan(db, plan(addDays(MON, 5), addDays(MON, 2)));
      await refresh(db, sourceOf([]), s, { now: at(addDays(MON, 2), 9) }); // Wednesday: brisk, not done
      const thu = await refresh(db, sourceOf([]), s, { now: at(addDays(MON, 3), 9) });
      expect(thu.todayGoal?.kind).toBe('brisk_walk');
      expect(thu.forwarded.map((x) => x.kind)).toEqual(['brisk_walk']);

      const switched = await refresh(db, sourceOf([]), s, {
        now: at(addDays(MON, 3), 10),
        regenerateToday: true,
        todayKind: 'duration',
      });
      expect(switched.todayGoal?.kind).toBe('duration');
      expect(switched.plan.sessions.find((x) => x.id === 'brisk')?.day).toBe(addDays(MON, 4));
    });

    it('moving a key session onto today replaces today\'s goal', async () => {
      const { saveWeekPlan } = await import('../data/db');
      const db = fakeDb();
      await migrate(db);
      await saveWeekPlan(db, plan(addDays(MON, 5), addDays(MON, 2)));
      const mon = await refresh(db, sourceOf([]), s, { now: at(MON, 9) });
      expect(mon.todayGoal?.kind).not.toBe('long_walk');
      await saveWeekPlan(db, plan(MON, addDays(MON, 2)));
      const after = await refresh(db, sourceOf([]), s, { now: at(MON, 10), regenerateToday: true });
      expect(after.todayGoal?.kind).toBe('long_walk');
    });

    it('next week\'s plan appears on Sunday evening', async () => {
      const db = fakeDb();
      await migrate(db);
      const sun = addDays(MON, 6);
      expect((await refresh(db, sourceOf([]), s, { now: at(sun, 12) })).nextPlan).toBeNull();
      const evening = await refresh(db, sourceOf([]), s, { now: at(sun, 19) });
      expect(evening.nextPlan?.week).toBe(addDays(MON, 7));
      expect(evening.nextPlan?.sessions.map((x) => x.kind)).toEqual(['long_walk', 'brisk_walk']);
    });
  });

  describe('weekly volume', () => {
    const MON = '2026-11-23';
    const at = (day: string, hour: number) => {
      const d = startOfDay(day);
      d.setHours(hour);
      return d;
    };
    // 4 past weeks of ~24 km (6 walks of 4 km).
    const history = Array.from({ length: 28 }, (_, i) => addDays(MON, -28 + i))
      .filter((_, i) => i % 7 < 6)
      .map((d) => ({ ...walk(d, 48), distanceM: 4000 }));
    const s = { ...settings, startDate: '2026-11-16', restDaysPerWeek: 1 };

    it('plans the week from your typical week and gives each day its share', async () => {
      const db = fakeDb();
      await migrate(db);
      const snap = await refresh(db, sourceOf(history), s, { now: at(MON, 9) });
      expect(snap.week.volume.km).toBe(24);
      expect(snap.week).toMatchObject({ doneKm: 0, leftKm: 24, lastWeekKm: 24 });
      expect(snap.todayNotes.join(' ')).toContain('This week: 24 km');
    });

    it('a big day early in the week makes the next days lighter', async () => {
      const db = fakeDb();
      await migrate(db);
      const db0 = fakeDb();
      await migrate(db0);
      const tueBase = await refresh(db0, sourceOf(history), s, { now: at(addDays(MON, 1), 9) });
      const plannedNote = tueBase.todayNotes[0];
      const withKayakishMonday = [...history, { ...walk(MON, 150), distanceM: 15000 }];
      await refresh(db, sourceOf(withKayakishMonday), s, { now: at(MON, 20) });
      const tue = await refresh(db, sourceOf(withKayakishMonday), s, { now: at(addDays(MON, 1), 9) });
      expect(tue.week.doneKm).toBe(15);
      expect(tue.todayNotes[0]).not.toBe(plannedNote);
      expect(tue.todayNotes[0]).toContain('15 done so far');
    });

    it('your period week is the light week', async () => {
      const db = fakeDb();
      await migrate(db);
      // Last period started 27 Oct → next expected around 24 Nov, in the week of the 23rd.
      const snap = await refresh(db, sourceOf(history), { ...s, periodStarts: ['2026-10-27'] }, { now: at(MON, 9) });
      expect(snap.week.volume.light).toBe('period');
      expect(snap.week.volume.km).toBe(18);
      expect(snap.cycle?.next?.start).toBe('2026-11-24');
    });

    it('a multi-day trek this week: each trek day is a long walk of its distance', async () => {
      const db = fakeDb();
      await migrate(db);
      const event = { name: 'Sierra Norte', km: 15, date: addDays(MON, 2), days: 3 };
      const snap = await refresh(db, sourceOf(history), { ...s, event }, { now: at(addDays(MON, 2), 7) });
      expect(snap.plan.sessions.map((x) => x.kind)).toEqual(['trek_day', 'trek_day', 'trek_day']);
      expect(snap.todayGoal).toEqual({ kind: 'long_walk', meters: 15000 });
      expect(snap.week.volume.eventWeek).toBe(true);
    });
  });

  describe('climb', () => {
    const MON = '2026-11-23';
    const at = (day: string, hour: number) => {
      const d = startOfDay(day);
      d.setHours(hour);
      return d;
    };
    const event = { name: 'Sierra Norte', km: 15, date: '2027-07-10', days: 3, ascentM: 900 };
    const s = { ...settings, startDate: '2026-11-16', event };
    const plan = {
      week: MON,
      sessions: [{ id: 'long', kind: 'long_walk' as const, day: MON, plannedDay: MON }],
    };
    const weeks = (up: number | null) =>
      Array.from({ length: 21 }, (_, i) => ({ ...walk(addDays(MON, -21 + i), 60), distanceM: 5000, ascentM: up }));

    it('long walks get a climb target when your walks have elevation', async () => {
      const { saveWeekPlan } = await import('../data/db');
      const db = fakeDb();
      await migrate(db);
      await saveWeekPlan(db, plan);
      const snap = await refresh(db, sourceOf(weeks(50)), s, { now: at(MON, 9) });
      const goal = snap.todayGoal as { kind: string; ascentM?: number };
      expect(goal.kind).toBe('long_walk');
      expect(goal.ascentM).toBeGreaterThan(0);
      expect(snap.week.elevationKnown).toBe(true);
    });

    it('…and none without elevation data, so the goal can still be met', async () => {
      const { saveWeekPlan } = await import('../data/db');
      const db = fakeDb();
      await migrate(db);
      await saveWeekPlan(db, plan);
      const snap = await refresh(db, sourceOf(weeks(null)), s, { now: at(MON, 9) });
      expect((snap.todayGoal as { ascentM?: number }).ascentM).toBeUndefined();
      expect(snap.week.elevationKnown).toBe(false);
    });
  });
});

