import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { hardestIn, sessionToRate } from './effort';
import { PLAN_VERSION } from './generator';
import type { WeekPlan } from './plan';
import { generateKeySession } from './sessions';
import { DEFAULT_SETTINGS, type DayResult, type Settings } from './types';
import { planVolume, type WeekVolume } from './volume';

const MON = '2026-11-23';
const settings: Settings = { ...DEFAULT_SETTINGS, startDate: '2026-10-05', onboarded: true };

describe('how it felt', () => {
  it('asks about a key session done today or yesterday, once', () => {
    const plan: WeekPlan = {
      week: MON,
      sessions: [{ id: 'long', kind: 'long_walk', day: addDays(MON, 1), plannedDay: addDays(MON, 1) }],
    };
    const tue = addDays(MON, 1);
    const done = (d: string) => d === tue;
    expect(sessionToRate([plan], tue, done, new Map())).toEqual({ date: tue, kind: 'long_walk' });
    expect(sessionToRate([plan], addDays(MON, 2), done, new Map())).toEqual({ date: tue, kind: 'long_walk' });
    expect(sessionToRate([plan], addDays(MON, 3), done, new Map())).toBeNull(); // too long ago
    expect(sessionToRate([plan], tue, done, new Map([[tue, 7]]))).toBeNull();
    expect(sessionToRate([plan], tue, () => false, new Map())).toBeNull(); // not done
    expect(hardestIn(new Map([[tue, 7], [addDays(MON, 5), 9]]), MON)).toBe(9);
  });

  it('a key walk at 9–10 last week: the week holds instead of growing', () => {
    const prevVolume: WeekVolume = {
      baseKm: 20, km: 20, light: null, preEvent: false, eventWeek: false, backToBack: false, destinationKm: 30, notes: [],
    };
    const input = { monday: MON, settings: { ...settings, dailyTargetKm: 5 }, startKm: 20, prev: { volume: prevVolume, actualKm: 21 }, periodWeek: false };
    expect(planVolume(input).baseKm).toBe(22);
    const held = planVolume({ ...input, lastWeekHardest: 9 });
    expect(held.baseKm).toBe(20);
    expect(held.notes[0]).toContain('felt 9/10');
    expect(planVolume({ ...input, lastWeekHardest: 8 }).baseKm).toBe(22);
  });

  it('a brisk walk that felt 9–10 keeps the same pace next time', () => {
    const date = '2026-12-05';
    const last: DayResult = {
      date: '2026-11-28',
      goal: { kind: 'brisk_walk', meters: 3000, paceSPerKm: 660 },
      value: 3000,
      done: true,
      planVersion: PLAN_VERSION,
      meta: { base: 3000, notes: [], pace: 660 },
    };
    const make = (felt?: number) =>
      generateKeySession({
        date, kind: 'brisk_walk', settings, activities: [], history: [last], targetKm: 3,
        feelings: felt ? new Map([['2026-11-28', felt]]) : undefined,
      }).goal as { paceSPerKm: number };
    expect(make().paceSPerKm).toBe(645);
    expect(make(9).paceSPerKm).toBe(660);
    expect(make(6).paceSPerKm).toBe(645);
  });
});
