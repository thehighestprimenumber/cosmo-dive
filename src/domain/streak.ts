import { mondayOf } from './dates';
import type { DateKey, DayResult, DayStatus } from './types';

export const FREEZE_EVERY = 7; // completed days per freeze earned
export const MAX_FREEZES = 2;

export type StreakState = {
  current: number;
  longest: number;
  freezes: number;
  /** Completed days until the next freeze is earned. */
  nextFreezeIn: number;
  /** Flexible rest days still unused in the current Monday–Sunday week. */
  restLeftThisWeek: number;
  statuses: Map<DateKey, DayStatus>;
};

/**
 * Replays every day from the start of the plan. Nothing here is stored:
 * streaks are always derived from goals + activities.
 *
 * - Every day has a goal. Hitting it adds to the streak.
 * - Rest days are flexible: the first `restDaysPerWeek` days of each
 *   Monday–Sunday week without the goal met become rest days. They neither
 *   add to nor break the streak, so training on a day you meant to rest
 *   simply saves that rest day for later in the week.
 * - Beyond those, a day without the goal uses a freeze if you have one;
 *   otherwise the streak resets.
 * - Every 7 completed days earns a freeze (max 2).
 * - Today is never rest or missed while it is still in progress.
 * - Old fixed rest days (goal: null, plans v1–v2) are always rest days.
 */
export function computeStreak(days: DayResult[], today: DateKey, restDaysPerWeek: number): StreakState {
  const sorted = [...days].filter((d) => d.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const statuses = new Map<DateKey, DayStatus>();
  const restUsed = new Map<DateKey, number>();
  let current = 0;
  let longest = 0;
  let freezes = 0;
  let sinceEarn = 0;

  for (const day of sorted) {
    const week = mondayOf(day.date);
    const used = restUsed.get(week) ?? 0;
    if (day.done) {
      statuses.set(day.date, 'done');
      current++;
      longest = Math.max(longest, current);
      sinceEarn++;
      if (sinceEarn === FREEZE_EVERY) {
        sinceEarn = 0;
        freezes = Math.min(MAX_FREEZES, freezes + 1);
      }
    } else if (day.date === today && day.goal) {
      statuses.set(day.date, 'pending');
    } else if (!day.goal || used < restDaysPerWeek) {
      statuses.set(day.date, 'rest');
      restUsed.set(week, used + 1);
    } else if (freezes > 0) {
      freezes--;
      statuses.set(day.date, 'frozen');
    } else {
      statuses.set(day.date, 'missed');
      current = 0;
      sinceEarn = 0;
    }
  }

  return {
    current,
    longest,
    freezes,
    nextFreezeIn: FREEZE_EVERY - sinceEarn,
    restLeftThisWeek: Math.max(0, restDaysPerWeek - (restUsed.get(mondayOf(today)) ?? 0)),
    statuses,
  };
}
