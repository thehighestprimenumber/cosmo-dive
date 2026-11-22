import { describe, expect, it } from 'vitest';
import { withAllDayWalking } from './allday';
import { dailyAverageKm } from './aim';
import { startOfDay } from './dates';
import { measure } from './progress';
import { DEFAULT_SETTINGS, type Activity } from './types';

const settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-02' };
function walk(date: string, km: number): Activity {
  const start = startOfDay(date).getTime() + 9 * 3_600_000;
  return { id: date, sport: 'walk', start, end: start + 3_600_000, durationS: 3600, distanceM: km * 1000, hr: [], origin: 't' };
}

describe('all-day walking (Samsung "distance while active")', () => {
  it('adds the day’s distance outside recorded workouts', () => {
    const acts = withAllDayWalking([walk('2026-11-21', 7.7)], { '2026-11-21': 13970, '2026-11-20': 6000 });
    const extra = acts.filter((a) => a.synthetic);
    expect(extra.map((a) => [a.id, Math.round(a.distanceM!)])).toEqual([
      ['allday-2026-11-20', 6000],
      ['allday-2026-11-21', 6270],
    ]);
    // Re-running doesn't stack.
    expect(withAllDayWalking(acts, { '2026-11-21': 13970 }).filter((a) => a.synthetic)).toHaveLength(1);
  });

  it('counts for distance goals and averages, never as a long or brisk walk', () => {
    const acts = withAllDayWalking([walk('2026-11-21', 7.7)], { '2026-11-21': 13970 });
    expect(measure({ kind: 'distance', meters: 10000, suggestedSport: 'walk' }, acts, settings)).toBeCloseTo(13970);
    expect(measure({ kind: 'long_walk', meters: 10000 }, acts, settings)).toBe(7700);
    expect(measure({ kind: 'brisk_walk', meters: 3000, paceSPerKm: 900 }, acts, settings)).toBe(7700);
    // Time goals: the recorded hour plus the extra 6.27 km at ~12 min/km.
    expect(measure({ kind: 'duration', seconds: 3600 }, acts, settings)).toBe(3600 + Math.round(6270 * 0.72));
    expect(dailyAverageKm(acts, '2026-11-21', 3, 1)).toBeCloseTo(13.97);
  });

  it('an unrecorded stroll counts for a time goal at your walking pace', () => {
    const acts = withAllDayWalking([], { '2026-11-22': 2040 }, 0.75);
    expect(measure({ kind: 'duration', seconds: 1200 }, acts, settings)).toBe(1530); // 2.04 km ≈ 25.5 min
  });

  it('the same walk recorded twice counts once (parts and the merged walk)', () => {
    const at = (h: number, m: number) => startOfDay('2026-11-21').getTime() + (h * 60 + m) * 60_000;
    const part = (id: string, h: number, m: number, min: number, km: number): Activity => ({
      id, sport: 'walk', start: at(h, m), end: at(h, m) + min * 60_000, durationS: min * 60, distanceM: km * 1000, hr: [], origin: 'samsung',
    });
    const parts = [part('a', 9, 27, 67, 3.4), part('b', 10, 55, 35, 1.7), part('d', 12, 24, 150, 7.7)];
    const merged = part('m', 9, 27, 297, 13.0);
    const acts = withAllDayWalking([...parts, merged], { '2026-11-21': 13970 });
    const real = acts.filter((a) => !a.synthetic);
    expect(real.map((a) => a.id)).toEqual(['m']);
    expect(measure({ kind: 'distance', meters: 10000, suggestedSport: 'walk' }, acts, settings)).toBeCloseTo(13970);
    // A kayak during a walk's time isn't a duplicate.
    const kayak: Activity = { ...part('k', 10, 0, 60, 0), sport: 'other' };
    expect(withAllDayWalking([merged, kayak], {}).map((a) => a.id)).toEqual(['m', 'k']);
  });
});
