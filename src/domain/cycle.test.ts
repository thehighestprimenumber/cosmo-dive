import { describe, expect, it } from 'vitest';
import { cycleInfo, nextPeriod, periodsFromDays } from './cycle';

describe('your cycle, as the Week tab shows it', () => {
  const records = [
    { start: '2026-08-03', end: '2026-08-07' },
    { start: '2026-08-31', end: '2026-09-04' }, // 28
    { start: '2026-09-30', end: '2026-10-05' }, // 30
    { start: '2026-10-27', end: '2026-10-31' }, // 27
  ];

  it('learns cycle and period length from the records, and predicts the next one', () => {
    const c = cycleInfo(records, [], 30)!;
    expect(c).toMatchObject({ cycleDays: 28, source: 'history', periodDays: 5, periodSource: 'history', knownCount: 4 });
    expect(c.gaps).toEqual([28, 30, 27]);
    expect(c.lastKnown.start).toBe('2026-10-27');
    expect(nextPeriod(c, '2026-11-21')).toEqual({ start: '2026-11-24', end: '2026-11-28' });
  });

  it('uses your setting until 2 cycles are known, and 5 days without end dates', () => {
    const c = cycleInfo([], ['2026-10-01', '2026-10-29'], 30)!;
    expect(c).toMatchObject({ cycleDays: 30, source: 'settings', periodSource: 'default', gaps: [28] });
  });

  it('day-by-day flow logs become periods', () => {
    const days = ['2026-10-27', '2026-10-28', '2026-10-30', '2026-11-24', '2026-11-25', '2026-10-28'];
    expect(periodsFromDays(days)).toEqual([
      { start: '2026-10-27', end: '2026-10-30' },
      { start: '2026-11-24', end: '2026-11-25' },
    ]);
  });
});
