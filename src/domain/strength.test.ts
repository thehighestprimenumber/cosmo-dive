import { describe, expect, it } from 'vitest';
import { addDays, startOfDay } from './dates';
import { strengthDone, strengthDoneDays, strengthFor } from './strength';
import type { Activity } from './types';

const MON = '2026-11-23';
const day = (n: number) => addDays(MON, n);
const plain = { doneDays: [] as string[], recovery: false, light: false };
const workout = (date: string, minutes: number, label = 'strength training'): Activity => {
  const start = startOfDay(date).getTime() + 18 * 3_600_000;
  return { id: date + label, sport: 'other', label, start, end: start + minutes * 60_000, durationS: minutes * 60, distanceM: null, hr: [], origin: 'gym' };
};

describe('strength in the goal', () => {
  it('twice a week: from Tuesday, then from Friday, 48 h apart', () => {
    expect(strengthFor({ ...plain, date: day(0) })).toBeNull(); // Monday: not yet
    expect(strengthFor({ ...plain, date: day(1) })).toMatchObject({ minutes: 30 });
    // Not done Tuesday: Wednesday asks again.
    expect(strengthFor({ ...plain, date: day(2) })).not.toBeNull();
    // Done Tuesday: not Wednesday (48 h), not Thursday (the second from Friday), Friday yes.
    const doneTue = { ...plain, doneDays: [day(1)] };
    expect(strengthFor({ ...doneTue, date: day(2) })).toBeNull();
    expect(strengthFor({ ...doneTue, date: day(3) })).toBeNull();
    expect(strengthFor({ ...doneTue, date: day(4) })).not.toBeNull();
    // Both done: nothing more this week; next week starts over.
    const both = { ...plain, doneDays: [day(1), day(4)] };
    expect(strengthFor({ ...both, date: day(6) })).toBeNull();
    expect(strengthFor({ ...both, date: day(8) })).not.toBeNull();
  });

  it('not on long walk or trek days, nor recovery days; shorter on light days', () => {
    expect(strengthFor({ ...plain, date: day(1), keyKind: 'long_walk' })).toBeNull();
    expect(strengthFor({ ...plain, date: day(1), keyKind: 'trek_day' })).toBeNull();
    expect(strengthFor({ ...plain, date: day(1), keyKind: 'brisk_walk' })).not.toBeNull();
    expect(strengthFor({ ...plain, date: day(1), recovery: true })).toBeNull();
    expect(strengthFor({ ...plain, date: day(1), light: true })).toMatchObject({ minutes: 20 });
  });

  it('the focus rotates lower → upper → full', () => {
    const foci = [0, 1, 2].flatMap((w) => [
      strengthFor({ ...plain, date: day(7 * w + 1) })!.focus,
      strengthFor({ ...plain, doneDays: [day(7 * w + 1)], date: day(7 * w + 4) })!.focus,
    ]);
    expect(new Set(foci.slice(0, 3))).toEqual(new Set(['lower', 'upper', 'full']));
    expect(foci[3]).toBe(foci[0]);
  });

  it('done by a tick, or a strength workout of about that length in Health Connect', () => {
    const t = { focus: 'lower' as const, minutes: 30 };
    expect(strengthDone(t, day(1), [day(1)], [])).toBe(true);
    expect(strengthDone(t, day(1), [], [workout(day(1), 25)])).toBe(true); // 80%+
    expect(strengthDone(t, day(1), [], [workout(day(1), 20)])).toBe(false);
    expect(strengthDone(t, day(1), [], [workout(day(1), 40, 'yoga')])).toBe(false);
    expect(strengthDoneDays([day(0)], [workout(day(2), 15), workout(day(3), 10)])).toEqual([day(0), day(2)]);
  });
});
