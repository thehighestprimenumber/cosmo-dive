import type { DateKey, DayResult, DayStatus } from './types';

export const FREEZE_EVERY = 7; // completed days per freeze earned
export const MAX_FREEZES = 2;

export type StreakState = {
  current: number;
  longest: number;
  freezes: number;
  /** Completed days until the next freeze is earned. */
  nextFreezeIn: number;
  statuses: Map<DateKey, DayStatus>;
};

/**
 * Replays every day from the start of the plan. Nothing here is stored:
 * streaks are always derived from goals + activities.
 *
 * - Rest days neither add to nor break the streak.
 * - Every 7 completed days earns a freeze (max 2).
 * - A missed day uses a freeze if you have one; otherwise the streak resets.
 * - Today is never "missed" while it is still in progress.
 */
export function computeStreak(days: DayResult[], today: DateKey): StreakState {
  const sorted = [...days].filter((d) => d.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const statuses = new Map<DateKey, DayStatus>();
  let current = 0;
  let longest = 0;
  let freezes = 0;
  let sinceEarn = 0;

  for (const day of sorted) {
    if (!day.goal) {
      statuses.set(day.date, 'rest');
    } else if (day.done) {
      statuses.set(day.date, 'done');
      current++;
      longest = Math.max(longest, current);
      sinceEarn++;
      if (sinceEarn === FREEZE_EVERY) {
        sinceEarn = 0;
        freezes = Math.min(MAX_FREEZES, freezes + 1);
      }
    } else if (day.date === today) {
      statuses.set(day.date, 'pending');
    } else if (freezes > 0) {
      freezes--;
      statuses.set(day.date, 'frozen');
    } else {
      statuses.set(day.date, 'missed');
      current = 0;
      sinceEarn = 0;
    }
  }

  return { current, longest, freezes, nextFreezeIn: FREEZE_EVERY - sinceEarn, statuses };
}
