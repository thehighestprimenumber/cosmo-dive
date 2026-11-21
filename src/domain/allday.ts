import { startOfDay, toDateKey } from './dates';
import type { Activity, DateKey } from './types';

/** Below this, a day's extra distance is noise. */
const MIN_GAP_M = 200;

/**
 * Samsung Health counts all the distance you cover in a day ("distance while
 * active"), not only recorded workouts. Health Connect's daily Distance total
 * includes the recorded sessions, so whatever is left over becomes one
 * "other walking" activity for that day (no duration, no heart rate).
 *
 * It counts toward km goals, the weekly km, your typical day, the aim and the
 * monthly challenge, but never as a long walk or brisk walk (those need a real
 * recorded outing).
 */
export function withAllDayWalking(activities: Activity[], dailyMeters: Record<DateKey, number>): Activity[] {
  const sessions = new Map<DateKey, number>();
  for (const a of activities) {
    if (a.synthetic) continue;
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
      durationS: 0,
      distanceM: gap,
      hr: [],
      origin: 'all-day',
      label: 'other walking',
      synthetic: true,
    });
  }
  return [...activities.filter((a) => !a.synthetic), ...extra].sort((a, b) => a.start - b.start);
}
