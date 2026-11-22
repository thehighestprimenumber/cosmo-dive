import { describe, expect, it } from 'vitest';
import { raisedBpm, raisedSeconds } from './activeTime';
import { withAllDayWalking } from './allday';
import { startOfDay } from './dates';
import { measure } from './progress';
import { DEFAULT_SETTINGS, type Activity, type HrSample } from './types';

const DAY = '2026-11-22';
const at = (h: number, m: number, s = 0) => startOfDay(DAY).getTime() + ((h * 60 + m) * 60 + s) * 1000;
/** A reading every `every` seconds from h:m for `minutes`, at `bpm`. */
const stretch = (h: number, m: number, minutes: number, bpm: number, every = 60): HrSample[] =>
  Array.from({ length: Math.floor((minutes * 60) / every) + 1 }, (_, i) => ({ t: at(h, m, i * every), bpm }));

describe('active minutes from all-day heart rate', () => {
  const max = 185; // zone 2 from 111 bpm
  it('counts raised stretches, not resting readings or long gaps', () => {
    expect(raisedBpm(max)).toBe(111);
    const samples = [
      ...stretch(8, 0, 60, 70, 600), // resting, every 10 min
      ...stretch(13, 39, 20, 118), // a 20-minute walk, not recorded as a workout
      { t: at(16, 0), bpm: 120 },
      { t: at(16, 20), bpm: 121 }, // two raised readings 20 min apart: not joined
    ];
    expect(raisedSeconds(samples, raisedBpm(max), [])).toEqual({ [DAY]: 1200 });
  });

  it('leaves out time inside recorded workouts (they count with their own duration)', () => {
    const workout: Activity = { id: 'w', sport: 'walk', start: at(13, 39), end: at(13, 49), durationS: 600, distanceM: 700, hr: [], origin: 't' };
    expect(raisedSeconds(stretch(13, 39, 20, 118), 111, [workout])[DAY]).toBe(600);
  });

  it('a day with readings but nothing raised is 0; a day without readings is missing', () => {
    expect(raisedSeconds(stretch(8, 0, 30, 70), 111, [])).toEqual({ [DAY]: 0 });
    expect(raisedSeconds([], 111, [])).toEqual({});
  });

  it('time goals use the heart-rate minutes instead of the distance estimate', () => {
    const settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-01' };
    const acts = withAllDayWalking([], { [DAY]: 2040 }, 0.72, { [DAY]: 1241 });
    expect(measure({ kind: 'duration', seconds: 1200 }, acts, settings)).toBe(1241);
    // Distance still counts as before.
    expect(measure({ kind: 'distance', meters: 2000, suggestedSport: 'walk' }, acts, settings)).toBeCloseTo(2040);
    // Without heart rate for the day: the estimate.
    expect(measure({ kind: 'duration', seconds: 1200 }, withAllDayWalking([], { [DAY]: 2040 }, 0.72), settings)).toBe(1469);
  });
});
