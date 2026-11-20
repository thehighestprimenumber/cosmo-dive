import { describe, expect, it } from 'vitest';
import { addDays, startOfDay } from './dates';
import {
  earnedAchievements,
  isBossDay,
  levelFor,
  monthKm,
  monthTarget,
  totalXp,
  xpForLevel,
  XP,
} from './game';
import { generateGoal, PLAN_VERSION } from './generator';
import type { Activity, DayResult, DayStatus } from './types';
import { DEFAULT_SETTINGS } from './types';

const goal = { kind: 'duration' as const, seconds: 1800 };
const day = (date: string, boss = false): DayResult => ({
  date,
  goal,
  value: 0,
  done: true,
  planVersion: PLAN_VERSION,
  meta: { base: 1800, notes: [], ...(boss ? { boss } : {}) },
});

function walk(date: string, km: number): Activity {
  const start = startOfDay(date).getTime() + 9 * 3_600_000;
  return { id: date, sport: 'walk', start, end: start + 3_600_000, durationS: 3600, distanceM: km * 1000, hr: [], origin: 't' };
}

describe('boss days', () => {
  it('happen exactly once a week, on varying weekdays', () => {
    const weekdays = new Set<number>();
    for (let w = 0; w < 10; w++) {
      const monday = addDays('2026-11-02', w * 7);
      const bosses = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter(isBossDay);
      expect(bosses).toHaveLength(1);
      weekdays.add(startOfDay(bosses[0]).getDay());
    }
    expect(weekdays.size).toBeGreaterThan(2);
  });

  it('make the goal 25% harder without raising the plan', () => {
    let boss = '2026-11-16';
    while (!isBossDay(boss)) boss = addDays(boss, 1);
    const settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-02' };
    const g = generateGoal({ date: boss, settings, activities: [], history: [] });
    expect(g.meta?.boss).toBe(true);
    const t = g.goal!.kind === 'distance' ? g.goal!.meters : (g.goal as { seconds: number }).seconds;
    expect(t).toBeGreaterThan(g.meta!.base);
    expect(g.meta?.notes.join(' ')).toContain('Boss day');
  });
});

describe('XP and levels', () => {
  it('rewards goals, streaks, bosses and perfect weeks', () => {
    const days = ['2026-11-16', '2026-11-17', '2026-11-18'].map((d, i) => day(d, i === 2));
    const statuses = new Map<string, DayStatus>(days.map((d) => [d.date, 'done']));
    // 10 + (10+1) + (30+2), no perfect week (3 < 5)
    expect(totalXp(days, statuses, 2)).toBe(53);
    const week = Array.from({ length: 5 }, (_, i) => day(addDays('2026-11-16', i)));
    const st2 = new Map<string, DayStatus>(week.map((d) => [d.date, 'done']));
    expect(totalXp(week, st2, 2)).toBe(10 + 11 + 12 + 13 + 14 + XP.perfectWeek);
  });

  it('levels up at 100, 300, 600 XP', () => {
    expect([1, 2, 3, 4].map(xpForLevel)).toEqual([0, 100, 300, 600]);
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100)).toEqual({ level: 2, into: 0, needed: 200 });
    expect(levelFor(450)).toEqual({ level: 3, into: 150, needed: 300 });
  });
});

describe('monthly challenge', () => {
  it('targets last month + 10%, scaled if only part of it is known', () => {
    const october = Array.from({ length: 31 }, (_, i) => walk(addDays('2026-10-01', i), 3)); // 93 km
    expect(monthTarget('2026-11', october, '2026-10-01', 3)).toBe(100); // 102.3 → 100
    // Only 15 days of October known → projected to the whole month.
    expect(monthTarget('2026-11', october, '2026-10-17', 3)).toBe(100);
    expect(monthTarget('2026-11', [], '2026-10-01', 3)).toBe(20);
  });

  it('an aim of 5 km a day means at least 150 km in November', async () => {
    const { aimMonthTarget } = await import('./game');
    expect(aimMonthTarget('2026-11', 5)).toBe(150);
    expect(aimMonthTarget('2026-12', 4.3)).toBe(135); // 133.3 → 135
  });

  it('counts walking-equivalent km this month', () => {
    const acts = [walk('2026-11-02', 6), { ...walk('2026-11-03', 15), sport: 'ride' as const }, walk('2026-10-31', 9)];
    expect(monthKm(acts, '2026-11', 3)).toBe(11);
  });
});

describe('achievements', () => {
  const base = { longestStreak: 0, restDaysPerWeek: 2, level: 1, monthKm: 0, monthTarget: 100 };

  it('unlocks from history', () => {
    const days = [day('2026-11-16'), day('2026-11-18', true)];
    const statuses = new Map<string, DayStatus>([
      ['2026-11-16', 'done'],
      ['2026-11-17', 'missed'],
      ['2026-11-18', 'done'],
    ]);
    const got = earnedAchievements({ ...base, days, statuses, longestStreak: 7, monthKm: 120 });
    expect(got).toEqual(expect.arrayContaining(['first_goal', 'streak_7', 'boss_1', 'comeback', 'month_champion', 'century']));
    expect(got).not.toContain('streak_30');
  });

  it('on target when your average reaches your aim', () => {
    const statuses = new Map<string, DayStatus>();
    expect(earnedAchievements({ ...base, days: [], statuses, aimReached: true })).toContain('aim_reached');
    expect(earnedAchievements({ ...base, days: [], statuses })).not.toContain('aim_reached');
  });

  it('all-rounder needs three goal types in one week', () => {
    const kinds = [
      { kind: 'distance' as const, meters: 5000, suggestedSport: 'walk' as const },
      { kind: 'duration' as const, seconds: 1800 },
      { kind: 'hr_zone' as const, zone: 2 as const, seconds: 900 },
    ];
    const days = kinds.map((g, i) => ({ ...day(addDays('2026-11-16', i)), goal: g }));
    const statuses = new Map<string, DayStatus>(days.map((d) => [d.date, 'done']));
    expect(earnedAchievements({ ...base, days, statuses })).toContain('all_rounder');
  });
});
