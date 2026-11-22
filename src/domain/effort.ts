import { addDays } from './dates';
import type { SessionKind, WeekPlan } from './plan';
import type { DateKey } from './types';

/**
 * How hard a key session felt, 1–10 (rate of perceived effort). The watch
 * knows how far you walked; this is how much it cost you.
 */

/** 9–10: very hard. The next step waits. */
export const HARD_RPE = 9;

export const RPE_LABELS: Record<number, string> = {
  1: 'Very easy',
  2: 'Easy',
  3: 'Easy',
  4: 'Comfortable',
  5: 'Moderate',
  6: 'Moderate',
  7: 'Hard',
  8: 'Hard',
  9: 'Very hard',
  10: 'All out',
};

/** The hardest rating in a Monday–Sunday week, if any. */
export function hardestIn(feelings: Map<DateKey, number>, monday: DateKey): number | null {
  let max: number | null = null;
  for (let i = 0; i < 7; i++) {
    const r = feelings.get(addDays(monday, i));
    if (r != null && (max == null || r > max)) max = r;
  }
  return max;
}

/** A key session done today or yesterday that hasn't been rated yet. */
export function sessionToRate(
  plans: (WeekPlan | null)[],
  today: DateKey,
  doneOn: (d: DateKey) => boolean,
  feelings: Map<DateKey, number>,
): { date: DateKey; kind: SessionKind } | null {
  for (const date of [today, addDays(today, -1)]) {
    if (feelings.has(date) || !doneOn(date)) continue;
    for (const p of plans) {
      const s = p?.sessions.find((x) => x.day === date && !x.dropped);
      if (s) return { date, kind: s.kind };
    }
  }
  return null;
}
