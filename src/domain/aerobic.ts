import { addDays, mondayOf, toDateKey } from './dates';
import type { Activity, DateKey, GoalEvent } from './types';
import { secondsInZone } from './zones';

/** From this altitude a trek gets an aerobic-base phase. */
export const ALTITUDE_M = 1500;
/** The aerobic-base phase lasts this many weeks before the pre-event week. */
export const AEROBIC_WEEKS = 16;
/** In that phase, heart-rate goals ask for this share of the day's time in Zone 2 (50% otherwise). */
export const AEROBIC_ZONE_SHARE = 0.7;
/** Weekly Zone 2 target: this share of the week's walking time. */
export const WEEKLY_ZONE2_SHARE = 0.35;

/**
 * A better aerobic base makes the same effort cheaper, which offsets part of
 * the oxygen you lack at altitude. For an event at altitude, the 16 weeks
 * before the pre-event week favour easy Zone 2 work on regular days.
 */
export function isAerobicPhase(date: DateKey, event: GoalEvent | null | undefined): boolean {
  if (!event?.altitudeM || event.altitudeM < ALTITUDE_M) return false;
  const preEventMonday = addDays(mondayOf(event.date), -7);
  return date < preEventMonday && date >= addDays(preEventMonday, -7 * AEROBIC_WEEKS);
}

/** Minutes in Zone 2 from `monday` to `upTo` (any sport). */
export function zone2Minutes(activities: Activity[], monday: DateKey, upTo: DateKey, maxHr: number): number {
  const s = activities
    .filter((a) => {
      const d = toDateKey(a.start);
      return d >= monday && d <= upTo;
    })
    .reduce((t, a) => t + secondsInZone(a.hr, 2, maxHr), 0);
  return Math.round(s / 60);
}
