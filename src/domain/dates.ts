import type { DateKey } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date of a JS Date or epoch ms. */
export function toDateKey(d: Date | number): DateKey {
  const date = typeof d === 'number' ? new Date(d) : d;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight at the start of the given day. */
export function startOfDay(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Local midnight at the start of the following day (exclusive end). */
export function endOfDay(key: DateKey): Date {
  return startOfDay(addDays(key, 1));
}

export function addDays(key: DateKey, n: number): DateKey {
  const d = startOfDay(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(key: DateKey): number {
  return startOfDay(key).getDay();
}

/** Whole days from a to b (b - a). DST-safe because it rounds. */
export function daysBetween(a: DateKey, b: DateKey): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

/** Monday of the week containing `key`. */
export function mondayOf(key: DateKey): DateKey {
  return addDays(key, -((weekday(key) + 6) % 7));
}

/** Inclusive list of dates from a to b. */
export function dateRange(a: DateKey, b: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Parses "HH:MM" into minutes after midnight, or null if invalid. */
export function parseTime(hhmm: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}
