import { describe, expect, it } from 'vitest';
import { startOfDay } from './dates';
import { hasElevationData, longWalkClimb, typicalClimbPerKm } from './elevation';
import { progressOf } from './progress';
import { DEFAULT_SETTINGS, type Activity } from './types';

const settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-02' };
function walk(id: string, km: number, up: number | null): Activity {
  const start = startOfDay('2026-11-21').getTime() + 9 * 3_600_000;
  return { id, sport: 'walk', start, end: start + 3_600_000, durationS: 3600, distanceM: km * 1000, ascentM: up, hr: [], origin: 't' };
}

describe('elevation', () => {
  it('knows how hilly your walks usually are', () => {
    expect(typicalClimbPerKm([walk('a', 5, 50), walk('b', 4, 80), walk('c', 6, 0)])).toBe(10);
    expect(typicalClimbPerKm([walk('a', 5, 50)])).toBeNull();
    expect(hasElevationData([walk('a', 5, null)])).toBe(false);
    expect(hasElevationData([walk('a', 5, 0)])).toBe(true); // a flat walk is still data
  });

  it('the long walk’s climb moves from your usual toward the trek’s as the distance grows', () => {
    const trek = { name: 'Sierra Norte', km: 15, date: '2027-07-10', days: 3, ascentM: 900 }; // 60 m/km
    expect(longWalkClimb(7.5, trek, 10)).toBe(260); // halfway: 35 m/km × 7.5 km
    expect(longWalkClimb(15, trek, 10)).toBe(900);
    expect(longWalkClimb(6, trek, null)).toBe(250); // unknown usual → starts at half the trek's: 42 m/km × 6 km
    expect(longWalkClimb(10, { ...trek, ascentM: undefined }, 10)).toBeNull();
  });

  it('a long walk with a climb needs both, in the same walk', () => {
    const goal = { kind: 'long_walk' as const, meters: 10000, ascentM: 500 };
    const flatLong = walk('flat', 12, 100);
    const shortHilly = walk('hilly', 6, 600);
    const p = progressOf(goal, [flatLong, shortHilly], settings);
    expect(p.done).toBe(false);
    expect(p.value).toBe(6000); // the hilly walk gets 60% there (its distance), the flat one 20% (its climb)
    expect(p.ascent).toEqual({ value: 600, target: 500 });
    expect(progressOf(goal, [walk('both', 10.5, 520)], settings).done).toBe(true);
    expect(progressOf({ kind: 'long_walk', meters: 10000 }, [flatLong], settings).done).toBe(true);
  });
});
