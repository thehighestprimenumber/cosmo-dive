import { addDays } from './dates';
import type { DateKey } from './types';

/**
 * Strength & mobility for trekking: 10 minutes, twice a week, any days you
 * like. You tick it off (the watch can't tell). Worth XP, never your streak.
 */
export const STRENGTH_PER_WEEK = 2;
export const STRENGTH_XP = 5;

export const STRENGTH_ROUTINE: { name: string; how: string }[] = [
  { name: 'Squats', how: '2 × 12, slow on the way down' },
  { name: 'Step-ups', how: '2 × 10 per leg on a stair or sturdy chair (uphill legs)' },
  { name: 'Reverse lunges', how: '2 × 8 per leg' },
  { name: 'Calf raises', how: '2 × 15 on a step, lowering the heels below the step (downhill and ankles)' },
  { name: 'Single-leg balance', how: '30 s per leg, then eyes closed (uneven trails)' },
  { name: 'Side plank', how: '20–30 s per side (carrying a backpack)' },
  { name: 'Hip flexor + calf stretch', how: '30 s each side' },
];

/** Days this week with the session ticked off. */
export function strengthDaysIn(days: DateKey[], monday: DateKey): DateKey[] {
  const end = addDays(monday, 6);
  return days.filter((d) => d >= monday && d <= end);
}
