import { toDateKey } from './dates';
import type { Activity, DateKey, GoalSpec, Progress, Settings } from './types';
import { secondsInZone } from './zones';

/** Moving at least this long on a rest day turns it into a bonus day. */
export const REST_BONUS_SECONDS = 20 * 60;

/** A rest day's result: total minutes moved, and whether that earns a bonus day. */
export function restDayResult(activities: Activity[]): { value: number; done: boolean } {
  const value = activities.reduce((s, a) => s + a.durationS, 0);
  return { value, done: value >= REST_BONUS_SECONDS };
}

/** Distance in walk-equivalent metres: rides count 1/rideFactor. */
export function walkEquivalentMeters(a: Activity, rideFactor: number): number {
  if (a.distanceM == null) return 0;
  return a.sport === 'walk' ? a.distanceM : a.distanceM / rideFactor;
}

export function goalTarget(goal: GoalSpec): number {
  switch (goal.kind) {
    case 'distance':
      return goal.meters;
    case 'duration':
    case 'hr_zone':
      return goal.seconds;
  }
}

/** How much of the goal's unit the given activities add up to. Any walk or ride counts. */
export function measure(
  goal: GoalSpec,
  activities: Activity[],
  settings: Pick<Settings, 'rideFactor' | 'maxHr'>,
): number {
  switch (goal.kind) {
    case 'distance':
      return activities.reduce((s, a) => s + walkEquivalentMeters(a, settings.rideFactor), 0);
    case 'duration':
      return activities.reduce((s, a) => s + a.durationS, 0);
    case 'hr_zone':
      return activities.reduce((s, a) => s + secondsInZone(a.hr, goal.zone, settings.maxHr), 0);
  }
}

export function progressOf(
  goal: GoalSpec,
  activities: Activity[],
  settings: Pick<Settings, 'rideFactor' | 'maxHr'>,
): Progress {
  const value = measure(goal, activities, settings);
  const target = goalTarget(goal);
  return { value, target, fraction: Math.min(1, value / target), done: value >= target };
}

export function activitiesOn(date: DateKey, activities: Activity[]): Activity[] {
  return activities.filter((a) => toDateKey(a.start) === date);
}

/**
 * Health Connect can hold the same workout twice (e.g. Samsung Health and
 * another app both wrote it). Drop any activity that mostly overlaps a
 * longer one.
 */
export function dedupeActivities(activities: Activity[]): Activity[] {
  const sorted = [...activities].sort((a, b) => b.end - b.start - (a.end - a.start));
  const kept: Activity[] = [];
  for (const a of sorted) {
    const len = a.end - a.start;
    const dup = kept.some((k) => {
      const overlap = Math.min(a.end, k.end) - Math.max(a.start, k.start);
      return overlap > 0.5 * len;
    });
    if (!dup) kept.push(a);
  }
  return kept.sort((a, b) => a.start - b.start);
}
