import { startOfDay, toDateKey } from './dates';
import type { Activity, DateKey } from './types';

/** Below this, a day's extra distance is noise. */
const MIN_GAP_M = 200;

/**
 * Samsung Health counts all the distance you cover in a day ("distance while
 * active"), not only recorded workouts. Health Connect's daily Distance total
 * includes the recorded sessions, so whatever is left over becomes one
 * "other walking" activity for that day (its time at your walking pace, no
 * heart rate).
 *
 * It counts toward km goals, the weekly km, your typical day, the aim and the
 * monthly challenge, but never as a long walk or brisk walk (those need a real
 * recorded outing).
 */
export function withAllDayWalking(
  activities: Activity[],
  dailyMeters: Record<DateKey, number>,
  /** Your walking pace (s per m), to turn the extra distance into minutes for time goals. */
  paceSPerM = DEFAULT_PACE_S_PER_M,
  /**
   * Seconds of raised heart rate outside workouts, per day (see activeTime.ts).
   * Days listed here use these instead of the distance-based estimate.
   */
  activeSeconds: Record<DateKey, number> = {},
): Activity[] {
  // A walking pace outside 9–17 min/km is a measuring glitch: keep the estimate sensible.
  const pace = Math.min(MAX_PACE_S_PER_M, Math.max(MIN_PACE_S_PER_M, paceSPerM));
  const real = withoutOverlaps(activities.filter((a) => !a.synthetic));
  const sessions = new Map<DateKey, number>();
  for (const a of real) {
    const d = toDateKey(a.start);
    sessions.set(d, (sessions.get(d) ?? 0) + (a.distanceM ?? 0));
  }
  const extra: Activity[] = [];
  for (const [date, meters] of Object.entries(dailyMeters)) {
    const gap = meters - (sessions.get(date) ?? 0);
    if (gap < MIN_GAP_M) continue;
    const noon = startOfDay(date).getTime() + 12 * 3_600_000;
    extra.push({
      id: `allday-${date}`,
      sport: 'walk',
      start: noon,
      end: noon,
      // Time: from heart rate when known (added below), else at your walking pace.
      durationS: date in activeSeconds ? 0 : Math.round(gap * pace),
      distanceM: gap,
      hr: [],
      origin: 'all-day',
      label: 'other walking',
      synthetic: true,
    });
  }
  // Active time outside workouts, from heart rate: counts for time goals (any sport).
  for (const [date, seconds] of Object.entries(activeSeconds)) {
    if (seconds < 60) continue;
    const noon = startOfDay(date).getTime() + 12 * 3_600_000;
    extra.push({
      id: `active-${date}`,
      sport: 'other',
      start: noon,
      end: noon,
      durationS: seconds,
      distanceM: null,
      hr: [],
      origin: 'all-day',
      label: 'active (raised heart rate)',
      synthetic: true,
    });
  }
  return [...real, ...extra].sort((a, b) => a.start - b.start);
}

/** About 12 min/km, until your own pace is known. */
export const DEFAULT_PACE_S_PER_M = 0.72;
const MIN_PACE_S_PER_M = 0.54; // 9 min/km
const MAX_PACE_S_PER_M = 1.02; // 17 min/km

/**
 * The same outing recorded twice (e.g. Samsung's parts of a walk and the
 * merged walk, both present for a while): sessions of the same sport that
 * overlap for more than half of the shorter one count once, keeping the one
 * with more distance (then the longer one).
 */
export function withoutOverlaps(activities: Activity[]): Activity[] {
  const sorted = [...activities].sort(
    (a, b) => (b.distanceM ?? 0) - (a.distanceM ?? 0) || b.end - b.start - (a.end - a.start),
  );
  const kept: Activity[] = [];
  for (const a of sorted) {
    const dup = kept.some((k) => {
      if (k.sport !== a.sport) return false;
      const overlap = Math.min(k.end, a.end) - Math.max(k.start, a.start);
      const shorter = Math.min(k.end - k.start, a.end - a.start);
      return shorter > 0 && overlap > shorter / 2;
    });
    if (!dup) kept.push(a);
  }
  return kept.sort((a, b) => a.start - b.start);
}
