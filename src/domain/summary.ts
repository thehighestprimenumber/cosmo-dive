import { addDays, mondayOf } from './dates';
import type { DateKey, DayStatus } from './types';

export type WeekSummary = {
  /** Monday … Sunday of the week containing `today`. */
  days: { date: DateKey; status: DayStatus | 'future' }[];
  done: number;
  /** Days you're aiming to train this week: 7 minus your rest days. */
  planned: number;
  restUsed: number;
};

/** This week at a glance. Days before the plan started show as "none". */
export function weekSummary(
  statuses: Map<DateKey, DayStatus>,
  today: DateKey,
  restDaysPerWeek: number,
  startDate: DateKey,
): WeekSummary {
  const monday = mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const status: DayStatus | 'future' =
      date < startDate ? 'none' : (statuses.get(date) ?? (date > today ? 'future' : 'none'));
    return { date, status };
  });
  const inPlan = days.filter((d) => d.date >= startDate).length;
  return {
    days,
    done: days.filter((d) => d.status === 'done').length,
    planned: Math.max(0, Math.min(inPlan, 7 - restDaysPerWeek)),
    restUsed: days.filter((d) => d.status === 'rest').length,
  };
}
