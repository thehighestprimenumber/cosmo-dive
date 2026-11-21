import type { Activity, GoalEvent } from './types';

/** Walks with elevation data (any climb, including flat walks recorded as 0 m). */
export const hasElevationData = (activities: Activity[]) =>
  activities.some((a) => a.sport === 'walk' && a.ascentM != null);

/**
 * How hilly your walks usually are: median metres climbed per km over walks
 * of 1+ km with elevation data. Needs 3 such walks.
 */
export function typicalClimbPerKm(activities: Activity[]): number | null {
  const xs = activities
    .filter((a) => a.sport === 'walk' && a.ascentM != null && (a.distanceM ?? 0) >= 1000)
    .map((a) => a.ascentM! / (a.distanceM! / 1000))
    .sort((a, b) => a - b);
  if (xs.length < 3) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * The climb for a long walk of `longKm` when training for an event with a
 * climb: it moves from your usual climb per km toward the event's, as the
 * long walk gets closer to the event's distance. Null without an event climb.
 */
export function longWalkClimb(longKm: number, event: GoalEvent | null, usualPerKm: number | null): number | null {
  if (!event?.ascentM) return null;
  const eventPerKm = event.ascentM / event.km;
  const start = Math.min(eventPerKm, usualPerKm ?? eventPerKm * 0.5);
  const progress = Math.min(1, longKm / event.km);
  const perKm = start + (eventPerKm - start) * progress;
  return Math.round((longKm * perKm) / 10) * 10;
}
