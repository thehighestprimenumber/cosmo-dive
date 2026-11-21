import type { GoalSpec, Settings } from './types';
import { zoneRange } from './zones';

export function formatKm(m: number): string {
  const km = m / 1000;
  return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)} km`;
}

export function formatMinutes(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** e.g. "Walk 5 km (or ride 15 km)", "Move for 40 min", "20 min in Zone 2". */
export function goalTitle(goal: GoalSpec, settings: Pick<Settings, 'rideFactor'>): string {
  switch (goal.kind) {
    case 'distance': {
      const walk = formatKm(goal.meters);
      const ride = formatKm(goal.meters * settings.rideFactor);
      return goal.suggestedSport === 'ride'
        ? `Ride ${ride} (or walk ${walk})`
        : `Walk ${walk} (or ride ${ride})`;
    }
    case 'duration':
      return `Move for ${formatMinutes(goal.seconds)}`;
    case 'hr_zone':
      return `${formatMinutes(goal.seconds)} in Zone ${goal.zone}`;
    case 'long_walk':
      return goal.ascentM
        ? `Long walk: ${formatKm(goal.meters)} with ${goal.ascentM} m of climb`
        : `Long walk: ${formatKm(goal.meters)} in one go`;
    case 'brisk_walk':
      return `Brisk walk: ${formatKm(goal.meters)} at ${formatPace(goal.paceSPerKm)} or faster`;
  }
}

/** Seconds per km → "10:30 min/km". */
export function formatPace(sPerKm: number): string {
  const total = Math.round(sPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} min/km`;
}

export function goalSubtitle(goal: GoalSpec, settings: Pick<Settings, 'maxHr'>): string {
  switch (goal.kind) {
    case 'distance':
      return 'Walks, runs and rides today add up (other sports count for time goals).';
    case 'duration':
      return 'Any exercise your watch records counts: walks, rides, kayak, swimming, gym…';
    case 'hr_zone': {
      const [lo, hi] = zoneRange(goal.zone, settings.maxHr);
      return `Keep your heart rate at ${lo}–${hi} bpm during any exercise.`;
    }
    case 'long_walk':
      return 'This week’s key session: one walk, hike or run, not several added up.';
    case 'brisk_walk':
      return 'This week’s key session: walks at this average pace or faster add up.';
  }
}

/** Progress value in the goal's own unit, e.g. "2.3 km" or "14 min". */
export function formatValue(goal: GoalSpec, value: number): string {
  return goal.kind === 'distance' || goal.kind === 'long_walk' || goal.kind === 'brisk_walk'
    ? formatKm(value)
    : formatMinutes(value);
}

export function goalEmoji(goal: GoalSpec | null): string {
  if (!goal) return '😴';
  return { distance: '📏', duration: '⏱️', hr_zone: '❤️', long_walk: '🥾', brisk_walk: '⚡' }[goal.kind];
}
