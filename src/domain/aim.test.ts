import { describe, expect, it } from 'vitest';
import { walkingPace } from './aim';
import { startOfDay } from './dates';
import type { Activity } from './types';

const walk = (i: number, km: number, minutes: number): Activity => {
  const start = startOfDay('2026-11-01').getTime() + i * 86_400_000;
  return { id: String(i), sport: 'walk', start, end: start + minutes * 60_000, durationS: minutes * 60, distanceM: km * 1000, hr: [], origin: 't' };
};

describe('walking pace', () => {
  it('walks recorded with their stops (19 min/km) count as 14 min/km at most', () => {
    const slow = [walk(0, 7.7, 150), walk(1, 5, 95), walk(2, 3, 57)];
    expect(walkingPace(slow)).toBe(0.84);
    const normal = [walk(0, 5, 60), walk(1, 4, 48), walk(2, 3, 36)];
    expect(walkingPace(normal)).toBeCloseTo(0.72);
  });
});
