import { addDays, toDateKey } from './dates';
import type { Activity, DateKey } from './types';

const WINDOW_DAYS = 28;
const MIN_ACTIVITY_S = 15 * 60;
const MIN_SAMPLES = 5;
/** Remind this long before your usual time. */
export const NUDGE_LEAD_MIN = 30;

export type TimeOfDay = { hour: number; minute: number };

/**
 * When you usually start moving: the median start time of your walks and
 * rides (15+ minutes) over the last 4 weeks, using the first one of each day.
 * Null with fewer than 5 such days.
 */
export function usualStartTime(activities: Activity[], today: DateKey): TimeOfDay | null {
  const from = addDays(today, -WINDOW_DAYS);
  const firstByDay = new Map<DateKey, number>();
  for (const a of activities) {
    const d = toDateKey(a.start);
    if (a.synthetic || d < from || d >= today || a.durationS < MIN_ACTIVITY_S) continue;
    const start = new Date(a.start);
    const minutes = start.getHours() * 60 + start.getMinutes();
    firstByDay.set(d, Math.min(firstByDay.get(d) ?? Infinity, minutes));
  }
  const mins = [...firstByDay.values()].sort((a, b) => a - b);
  if (mins.length < MIN_SAMPLES) return null;
  const mid = Math.floor(mins.length / 2);
  const m = Math.round(mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2);
  return { hour: Math.floor(m / 60), minute: m % 60 };
}

/** Your usual time minus the lead, never before 06:00. */
export function nudgeTime(usual: TimeOfDay): TimeOfDay {
  const m = Math.max(6 * 60, usual.hour * 60 + usual.minute - NUDGE_LEAD_MIN);
  return { hour: Math.floor(m / 60), minute: m % 60 };
}

export const formatTime = (t: TimeOfDay) => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
