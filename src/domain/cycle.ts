import { addDays, daysBetween, mondayOf } from './dates';
import type { DateKey } from './types';

/** A period, first to last day (inclusive). */
export type Period = { start: DateKey; end: DateKey };

export const DEFAULT_CYCLE_DAYS = 28;
export const DEFAULT_PERIOD_DAYS = 5;

export type CycleInfo = {
  /** Typical days from one period start to the next. */
  cycleDays: number;
  periodDays: number;
  /** Known and predicted periods, oldest first. */
  periods: Period[];
  /** Where the cycle length comes from. */
  source: 'history' | 'settings';
};

/**
 * Merge period records (Health Connect and/or "started today" taps), learn
 * your cycle and predict the next periods.
 * - Cycle length: median gap between period starts (needs 2+ gaps), else
 *   your setting.
 * - Period length: median of recorded periods, else 5 days.
 * Predicts `ahead` periods after the last known one. Null with no data.
 */
export function cycleInfo(
  records: Period[],
  manualStarts: DateKey[],
  settingCycleDays: number,
  ahead = 3,
): CycleInfo | null {
  const known = mergePeriods([
    ...records,
    ...manualStarts.map((s) => ({ start: s, end: addDays(s, DEFAULT_PERIOD_DAYS - 1) })),
  ]);
  if (!known.length) return null;

  const gaps: number[] = [];
  for (let i = 1; i < known.length; i++) {
    const g = daysBetween(known[i - 1].start, known[i].start);
    if (g >= 18 && g <= 45) gaps.push(g); // ignore gaps that look like missing data
  }
  const cycleDays = gaps.length >= 2 ? Math.round(median(gaps)) : settingCycleDays;
  const lengths = records.map((p) => daysBetween(p.start, p.end) + 1).filter((n) => n >= 2 && n <= 10);
  const periodDays = lengths.length ? Math.round(median(lengths)) : DEFAULT_PERIOD_DAYS;

  const periods = [...known];
  let last = known[known.length - 1].start;
  for (let i = 0; i < ahead; i++) {
    last = addDays(last, cycleDays);
    periods.push({ start: last, end: addDays(last, periodDays - 1) });
  }
  return { cycleDays, periodDays, periods, source: gaps.length >= 2 ? 'history' : 'settings' };
}

/** Overlapping or adjacent records become one period (e.g. a Health Connect record and a tap). */
function mergePeriods(ps: Period[]): Period[] {
  const sorted = [...ps].sort((a, b) => (a.start < b.start ? -1 : 1));
  const out: Period[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (prev && daysBetween(prev.end, p.start) <= 3) {
      if (p.end > prev.end) prev.end = p.end;
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

/**
 * The Monday–Sunday week that holds most of a period's days (ties → the
 * earlier week). That's the light week for that cycle.
 */
export function lightWeekOf(p: Period): DateKey {
  const counts = new Map<DateKey, number>();
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) {
    const w = mondayOf(d);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}

/** Whether the week starting `monday` is a period (light) week. */
export function isPeriodWeek(monday: DateKey, info: CycleInfo | null): boolean {
  return !!info?.periods.some((p) => lightWeekOf(p) === monday);
}

/** The next period starting after `today` (or ongoing), if known. */
export function nextPeriod(info: CycleInfo | null, today: DateKey): Period | null {
  return info?.periods.find((p) => p.end >= today) ?? null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
