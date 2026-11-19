import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, mondayOf, startOfDay, weekday } from './dates';
import { goalTitle } from './format';
import { generateGoal, isRecoveryWeek, kindForDay } from './generator';
import { dedupeActivities, measure, progressOf } from './progress';
import { computeStreak } from './streak';
import { DEFAULT_SETTINGS, type Activity, type DayResult, type Settings } from './types';
import { secondsInZone, zoneOf } from './zones';

// No distance floor here, so progression maths is visible; the floor has its own test.
const settings: Settings = { ...DEFAULT_SETTINGS, minDistanceKm: 0, startDate: '2026-11-02', onboarded: true };

function act(date: string, opts: Partial<Activity> & { hourStart?: number; minutes?: number } = {}): Activity {
  const start = startOfDay(date).getTime() + (opts.hourStart ?? 9) * 3_600_000;
  const minutes = opts.minutes ?? 30;
  return {
    id: `${date}-${opts.hourStart ?? 9}-${opts.sport ?? 'walk'}`,
    sport: 'walk',
    start,
    end: start + minutes * 60_000,
    durationS: minutes * 60,
    distanceM: 3000,
    hr: [],
    origin: 'test',
    ...opts,
  };
}

describe('dates', () => {
  it('handles weekdays and ranges', () => {
    expect(weekday('2026-11-19')).toBe(4); // Thursday
    expect(mondayOf('2026-11-19')).toBe('2026-11-16');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
    expect(mondayOf('2026-11-22')).toBe('2026-11-16'); // Sunday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });
});

describe('zones', () => {
  it('classifies bpm by % of max', () => {
    expect(zoneOf(100, 200)).toBe(1);
    expect(zoneOf(125, 200)).toBe(2);
    expect(zoneOf(99, 200)).toBe(0);
    expect(zoneOf(195, 200)).toBe(5);
  });

  it('counts time between samples and caps gaps', () => {
    const t0 = 0;
    const samples = [
      { t: t0, bpm: 125 },
      { t: t0 + 30_000, bpm: 125 },
      { t: t0 + 60_000, bpm: 165 }, // zone 4 from here
      { t: t0 + 90_000, bpm: 125 },
      { t: t0 + 600_000, bpm: 125 }, // 8.5 min gap, capped at 60 s
    ];
    expect(secondsInZone(samples, 2, 200)).toBe(30 + 30 + 60);
    expect(secondsInZone(samples, 4, 200)).toBe(30);
  });
});

describe('progress', () => {
  it('counts rides at 1/rideFactor for distance goals', () => {
    const goal = { kind: 'distance' as const, meters: 5000, suggestedSport: 'walk' as const };
    const acts = [act('2026-11-19', { distanceM: 2000 }), act('2026-11-19', { sport: 'ride', distanceM: 9000, hourStart: 17 })];
    expect(measure(goal, acts, settings)).toBe(5000);
    expect(progressOf(goal, acts, settings).done).toBe(true);
  });

  it('adds up durations of any sport', () => {
    const goal = { kind: 'duration' as const, seconds: 3600 };
    const acts = [act('2026-11-19', { minutes: 20 }), act('2026-11-19', { sport: 'ride', minutes: 30, hourStart: 17 })];
    const p = progressOf(goal, acts, settings);
    expect(p.value).toBe(3000);
    expect(p.done).toBe(false);
  });

  it('drops overlapping duplicates', () => {
    const a = act('2026-11-19', { id: 'samsung', minutes: 40 });
    const b = act('2026-11-19', { id: 'other', minutes: 38 });
    const c = act('2026-11-19', { id: 'evening', hourStart: 18 });
    expect(dedupeActivities([a, b, c]).map((x) => x.id)).toEqual(['samsung', 'evening']);
  });
});

describe('generator', () => {
  it('gives rest days no goal', () => {
    const g = generateGoal({ date: '2026-11-17', settings, activities: [], history: [] }); // Tuesday
    expect(g.goal).toBeNull();
  });

  it('is deterministic and mixes goal types across the week', () => {
    const kinds = ['2026-11-16', '2026-11-18', '2026-11-19', '2026-11-21', '2026-11-22'].map((d) =>
      kindForDay(d, settings, true),
    );
    expect(new Set(kinds).size).toBe(3);
    for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1]);
    expect(kindForDay('2026-11-19', settings, true)).toBe(kinds[2]);
  });

  it('never picks heart rate goals without heart rate data', () => {
    for (let i = 0; i < 60; i++) {
      const d = addDays('2026-11-02', i);
      if (settings.restDays.includes(weekday(d))) continue;
      expect(kindForDay(d, settings, false)).not.toBe('hr_zone');
    }
  });

  it('starts from your real baseline', () => {
    const acts = Array.from({ length: 10 }, (_, i) => act(addDays('2026-11-18', -(i + 1)), { minutes: 50, distanceM: 6000 }));
    // find a non-rest day whose kind is duration or distance
    let date = '2026-11-18';
    while (true) {
      const k = kindForDay(date, settings, false);
      if (!settings.restDays.includes(weekday(date)) && k !== 'hr_zone') break;
      date = addDays(date, 1);
    }
    const g = generateGoal({ date, settings, activities: acts, history: [] }).goal!;
    if (g.kind === 'duration') expect(g.seconds).toBe(50 * 60);
    if (g.kind === 'distance') expect(g.meters).toBe(6000);
  });

  it('progresses after successes and eases off after two misses', () => {
    const date = '2026-11-19';
    const kind = kindForDay(date, settings, false);
    const prev = (d: string, done: boolean): DayResult => ({
      date: d,
      goal: kind === 'distance' ? { kind, meters: 4000, suggestedSport: 'walk' } : { kind: 'duration', seconds: 1800 },
      value: 0,
      done,
    });
    const target = (h: DayResult[]) => {
      const g = generateGoal({ date, settings, activities: [], history: h }).goal!;
      return g.kind === 'distance' ? g.meters : (g as { seconds: number }).seconds;
    };
    const base = kind === 'distance' ? 4000 : 1800;
    const up = target([prev('2026-11-10', true), prev('2026-11-12', true), prev('2026-11-13', true)]);
    const down = target([prev('2026-11-16', false), prev('2026-11-18', false)]);
    expect(up).toBeGreaterThan(base);
    expect(down).toBeLessThan(base);
  });

  it('makes every 4th week a recovery week', () => {
    expect(isRecoveryWeek('2026-11-19', settings.startDate)).toBe(false);
    expect(isRecoveryWeek('2026-11-23', settings.startDate)).toBe(true); // week 4
    expect(isRecoveryWeek('2026-11-30', settings.startDate)).toBe(false);
  });
});

describe('streak', () => {
  const goal = { kind: 'duration' as const, seconds: 1800 };
  const day = (date: string, done: boolean | 'rest'): DayResult =>
    done === 'rest' ? { date, goal: null, value: 0, done: false } : { date, goal, value: 0, done };

  it('rest days do not break the streak and today stays pending', () => {
    const s = computeStreak(
      [day('2026-11-16', true), day('2026-11-17', 'rest'), day('2026-11-18', true), day('2026-11-19', false)],
      '2026-11-19',
    );
    expect(s.current).toBe(2);
    expect(s.statuses.get('2026-11-19')).toBe('pending');
  });

  it('earns a freeze every 7 done days and spends it on a miss', () => {
    const days: DayResult[] = [];
    for (let i = 0; i < 7; i++) days.push(day(addDays('2026-11-01', i), true));
    days.push(day('2026-11-08', false));
    days.push(day('2026-11-09', true));
    days.push(day('2026-11-10', false));
    const s = computeStreak(days, '2026-11-11');
    expect(s.statuses.get('2026-11-08')).toBe('frozen');
    expect(s.statuses.get('2026-11-10')).toBe('missed');
    expect(s.current).toBe(0);
    expect(s.longest).toBe(8);
  });
});

describe('format', () => {
  it('describes goals', () => {
    expect(goalTitle({ kind: 'distance', meters: 5000, suggestedSport: 'walk' }, settings)).toBe('Walk 5 km (or ride 15 km)');
    expect(goalTitle({ kind: 'duration', seconds: 2400 }, settings)).toBe('Move for 40 min');
    expect(goalTitle({ kind: 'hr_zone', zone: 2, seconds: 1200 }, settings)).toBe('20 min in Zone 2');
  });
});

describe('weekSummary', () => {
  it('counts done and planned training days this week', async () => {
    const { weekSummary } = await import('./summary');
    const statuses = new Map([
      ['2026-11-16', 'done'],
      ['2026-11-17', 'rest'],
      ['2026-11-18', 'missed'],
      ['2026-11-19', 'pending'],
    ] as const);
    const s = weekSummary(new Map(statuses), '2026-11-19', [2, 5], '2026-11-02');
    expect(s.days.map((d) => d.status)).toEqual(['done', 'rest', 'missed', 'pending', 'rest', 'future', 'future']);
    expect(s.done).toBe(1);
    expect(s.planned).toBe(5); // Mon, Wed, Thu, Sat, Sun
  });

  it('ignores days before the plan started', async () => {
    const { weekSummary } = await import('./summary');
    const s = weekSummary(new Map([['2026-11-19', 'pending']]), '2026-11-19', [], '2026-11-19');
    expect(s.planned).toBe(4); // Thu–Sun
  });
});

describe('smarter goals (v2)', () => {
  const distanceDay = () => {
    let d = '2026-11-18';
    while (settings.restDays.includes(weekday(d)) || kindForDay(d, settings, false) !== 'distance') d = addDays(d, 1);
    return d;
  };

  it('never sets a distance goal below the minimum', () => {
    const date = distanceDay();
    const acts = Array.from({ length: 10 }, (_, i) => act(addDays(date, -(i + 1)), { minutes: 30, distanceM: 2300 }));
    const g = generateGoal({ date, settings: { ...settings, minDistanceKm: 5 }, activities: acts, history: [] }).goal!;
    expect(g.kind).toBe('distance');
    expect((g as { meters: number }).meters).toBe(5000);
  });

  it('ignores short auto-detected walks when finding your baseline', () => {
    const date = distanceDay();
    const acts: Activity[] = [];
    for (let i = 1; i <= 10; i++) {
      const d = addDays(date, -i);
      acts.push(act(d, { minutes: 60, distanceM: 6000 }));
      acts.push(act(d, { id: `${d}-errand`, hourStart: 14, minutes: 6, distanceM: 400 }));
      acts.push(act(addDays(date, -i - 10), { id: `${d}-only-errand`, hourStart: 15, minutes: 5, distanceM: 300 }));
    }
    const g = generateGoal({ date, settings, activities: acts, history: [] }).goal!;
    // Short errands neither add to the long walks' days nor create low days of their own.
    expect((g as { meters: number }).meters).toBe(6000);
  });

  it('counts moving on a rest day as a bonus day', () => {
    const goal = { kind: 'duration' as const, seconds: 1800 };
    const s = computeStreak(
      [
        { date: '2026-11-16', goal, value: 0, done: true },
        { date: '2026-11-17', goal: null, value: 1500, done: true },
        { date: '2026-11-18', goal, value: 0, done: true },
      ],
      '2026-11-18',
    );
    expect(s.statuses.get('2026-11-17')).toBe('bonus');
    expect(s.current).toBe(3);
  });

  it('needs 20 minutes on a rest day for the bonus', async () => {
    const { restDayResult } = await import('./progress');
    expect(restDayResult([act('2026-11-17', { minutes: 12 })]).done).toBe(false);
    expect(restDayResult([act('2026-11-17', { minutes: 12 }), act('2026-11-17', { hourStart: 18, minutes: 9 })]).done).toBe(true);
  });
});
