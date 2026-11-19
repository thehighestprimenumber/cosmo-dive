import { addDays, mondayOf } from './dates';
import type { DateKey, DayStatus } from './types';

export type WeekSummary = {
  /** Monday … Sunday of the week containing `today`. */
  days: { date: DateKey; status: DayStatus | 'future' }[];
  done: number;
  /** Training days this week (rest days excluded), including ones still to come. */
  planned: number;
};

/**
 * This week at a glance. Days without a stored goal yet are "future" (or
 * "none" before the plan started); `planned` counts them unless they fall
 * on a rest day.
 */
export function weekSummary(
  statuses: Map<DateKey, DayStatus>,
  today: DateKey,
  restDays: number[],
  startDate: DateKey,
): WeekSummary {
  const monday = mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const status: DayStatus | 'future' =
      statuses.get(date) ?? (date > today ? (restDays.includes((i + 1) % 7) ? 'rest' : 'future') : 'none');
    return { date, status };
  });
  const done = days.filter((d) => d.status === 'done').length;
  const planned = days.filter(
    (d) => d.date >= startDate && d.status !== 'rest' && d.status !== 'none',
  ).length;
  return { days, done, planned };
}
