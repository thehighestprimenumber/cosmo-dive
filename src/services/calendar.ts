import * as Calendar from 'expo-calendar';
import { busyDaysFrom } from '../domain/shifts';
import type { DateKey, Settings } from '../domain/types';

/** Reads work days from the calendars you picked in Settings. */
export type WorkCalendar = { busyDays(from: DateKey, to: DateKey): Promise<DateKey[]> };

export async function hasCalendarAccess(): Promise<boolean> {
  return (await Calendar.getCalendarPermissions().catch(() => null))?.granted ?? false;
}

export async function requestCalendarAccess(): Promise<boolean> {
  return (await Calendar.requestCalendarPermissions().catch(() => null))?.granted ?? false;
}

export async function listCalendars(): Promise<{ id: string; title: string; color?: string }[]> {
  const all = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  return all.map((c) => ({ id: c.id, title: c.title, color: c.color }));
}

/** Null when no calendars are picked or access is off: then nothing changes. */
export function workCalendarFor(settings: Settings): WorkCalendar | null {
  if (!settings.workCalendars.length) return null;
  return {
    async busyDays(from, to) {
      if (!(await hasCalendarAccess())) return [];
      const start = new Date(from + 'T00:00:00');
      const end = new Date(to + 'T23:59:59');
      const events = await Calendar.listEvents(settings.workCalendars, start, end);
      return busyDaysFrom(
        events.map((e) => ({ start: new Date(e.startDate), end: new Date(e.endDate), allDay: !!e.allDay })),
        from,
        to,
      );
    },
  };
}
