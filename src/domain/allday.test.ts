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
    expect(measure({ kind: 'duration', seconds: 3600 }, acts, settings)).toBe(3600);
    expect(dailyAverageKm(acts, '2026-11-21', 3, 1)).toBeCloseTo(13.97);
  });
});
