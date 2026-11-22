import { addDays, startOfDay, toDateKey } from './dates';
import type { DateKey } from './types';

/**
 * Work days from your calendar: a day with 6+ hours of events in the
 * calendars you chose (an overnight shift counts for each day it covers),
 * or an all-day event in them.
 */
export const BUSY_HOURS = 6;

export type CalendarEvent = { start: Date; end: Date; allDay: boolean };

export function busyDaysFrom(events: CalendarEvent[], from: DateKey, to: DateKey): DateKey[] {
  const hours = new Map<DateKey, number>();
  const busy = new Set<DateKey>();
  for (const e of events) {
    if (!(e.end > e.start)) continue;
    if (e.allDay) {
      // All-day events end at midnight after their last day (in the calendar's day terms).
      for (let d = toDateKey(e.start.getTime()); d < toDateKey(e.end.getTime()) || d === toDateKey(e.start.getTime()); d = addDays(d, 1)) {
        busy.add(d);
      }
      continue;
    }
    for (let d = toDateKey(e.start.getTime()); d <= toDateKey(e.end.getTime() - 1); d = addDays(d, 1)) {
      const dayStart = startOfDay(d).getTime();
      const dayEnd = startOfDay(addDays(d, 1)).getTime();
      const overlap = Math.min(e.end.getTime(), dayEnd) - Math.max(e.start.getTime(), dayStart);
      if (overlap > 0) hours.set(d, (hours.get(d) ?? 0) + overlap / 3_600_000);
    }
  }
  for (const [d, h] of hours) if (h >= BUSY_HOURS) busy.add(d);
  return [...busy].filter((d) => d >= from && d <= to).sort();
}
