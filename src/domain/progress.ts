import { toDateKey } from './dates';
import type { Activity, DateKey, GoalSpec, Progress, Settings } from './types';
import { secondsInZone } from './zones';

/** Distance in walk-equivalent metres: rides count 1/rideFactor. */
export function walkEquivalentMeters(a: Activity, rideFactor: number): number {
  if (a.distanceM == null || a.sport === 'other') return 0;
  return a.sport === 'walk' ? a.distanceM : a.distanceM / rideFactor;
}

export function goalTarget(goal: GoalSpec): number {
  switch (goal.kind) {
    case 'distance':
    case 'long_walk':
    case 'brisk_walk':
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
    case 'long_walk':
      // One outing, not several added up (with a climb target, that same outing's climb).
      return bestLongWalk(goal, activities).value;
    case 'brisk_walk':
      return activities
        .filter((a) => a.sport === 'walk' && !a.synthetic && (a.distanceM ?? 0) >= 1000)
        .filter((a) => a.durationS / (a.distanceM! / 1000) <= goal.paceSPerKm)
        .reduce((s, a) => s + a.distanceM!, 0);
  }
}

export function progressOf(
  goal: GoalSpec,
  activities: Activity[],
  settings: Pick<Settings, 'rideFactor' | 'maxHr'>,
): Progress {
  const value = measure(goal, activities, settings);
  const target = goalTarget(goal);
  const p: Progress = { value, target, fraction: Math.min(1, value / target), done: value >= target };
  if (goal.kind === 'long_walk' && goal.ascentM) {
    p.ascent = { value: bestLongWalk(goal, activities).ascent, target: goal.ascentM };
  }
  return p;
}

/** Sessions this close together are one outing (a break, or a recording split in two). */
export const OUTING_GAP_MS = 20 * 60_000;

/** Recorded walks grouped into outings: consecutive walks with breaks under 20 minutes. */
export function outings(activities: Activity[]): { distanceM: number; ascentM: number; start: number; end: number }[] {
  const walks = activities.filter((a) => a.sport === 'walk' && !a.synthetic).sort((a, b) => a.start - b.start);
  const out: { distanceM: number; ascentM: number; start: number; end: number }[] = [];
  for (const w of walks) {
    const last = out[out.length - 1];
    if (last && w.start - last.end <= OUTING_GAP_MS) {
      last.distanceM += w.distanceM ?? 0;
      last.ascentM += w.ascentM ?? 0;
      last.end = Math.max(last.end, w.end);
    } else {
      out.push({ distanceM: w.distanceM ?? 0, ascentM: w.ascentM ?? 0, start: w.start, end: w.end });
    }
  }
  return out;
}

/**
 * The walk that gets furthest toward a long walk goal. With a climb target,
 * an outing counts as far as its weaker side: 12 km with half the climb is
 * half done. `value` is in metres of the goal's distance.
 */
function bestLongWalk(
  goal: Extract<GoalSpec, { kind: 'long_walk' }>,
  activities: Activity[],
): { value: number; ascent: number } {
  let best = { value: 0, ascent: 0 };
  for (const o of outings(activities)) {
    const d = o.distanceM;
    const up = o.ascentM;
    const value = goal.ascentM ? Math.min(d, (up / goal.ascentM) * goal.meters) : d;
    if (value > best.value) best = { value, ascent: up };
  }
  return best;
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
