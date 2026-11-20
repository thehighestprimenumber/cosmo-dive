import { addDays, toDateKey } from './dates';
import { walkEquivalentMeters } from './progress';
import type { Activity, DateKey, GoalKind, Settings } from './types';

/** New goals start at no less than this share of the aim… */
export const AIM_START = 0.6;
/** …and step up this much each time you complete one of the same type, until they reach it. */
export const AIM_STEP = 1.1;

/**
 * What a training day needs so that your average over *all* days (rest days
 * count as zero) reaches your aim: aim × 7 / training days per week.
 * Distance in walk-equivalent metres; time via your usual walking pace.
 * Null when no aim is set, for heart rate goals, or without a known pace.
 */
export function aimPerTrainingDay(
  kind: GoalKind,
  settings: Pick<Settings, 'dailyTargetKm' | 'restDaysPerWeek'>,
  recent: Activity[],
): number | null {
  if (!settings.dailyTargetKm) return null;
  const meters = (settings.dailyTargetKm * 1000 * 7) / Math.max(1, 7 - settings.restDaysPerWeek);
  if (kind === 'distance') return meters;
  if (kind === 'duration') {
    const pace = walkingPace(recent);
    return pace ? meters * pace : null;
  }
  return null;
}

/** Your usual walking pace in seconds per metre: median over walks of 15+ min with a distance. */
export function walkingPace(activities: Activity[]): number | null {
  const paces = activities
    .filter((a) => a.sport === 'walk' && a.durationS >= 15 * 60 && a.distanceM && a.distanceM > 500)
    .map((a) => a.durationS / a.distanceM!)
    .sort((a, b) => a - b);
  if (paces.length < 3) return null;
  const mid = Math.floor(paces.length / 2);
  return paces.length % 2 ? paces[mid] : (paces[mid - 1] + paces[mid]) / 2;
}

/** Average walk-equivalent km per day over the last `days` days (today included), counting every day. */
export function dailyAverageKm(activities: Activity[], today: DateKey, rideFactor: number, days = 14): number {
  const from = addDays(today, -(days - 1));
  const meters = activities
    .filter((a) => {
      const d = toDateKey(a.start);
      return d >= from && d <= today;
    })
    .reduce((s, a) => s + walkEquivalentMeters(a, rideFactor), 0);
  return meters / 1000 / days;
}
