import { formatKm } from './format';

/**
 * Recovery day: the day after a very big day is for resting (or an easy
 * stroll). Resting on it doesn't use one of the week's rest days.
 */

/** Yesterday counts as big at 1.75× a regular day's share of the week… */
export const BIG_DAY_SHARE = 1.75;
/** …and at least this many km (so a small plan doesn't make every walk "big"). */
export const BIG_DAY_MIN_KM = 6;
/** The optional easy goal on a recovery day. */
export const RECOVERY_MINUTES = 20;

/** Notes explaining the recovery day, or null when yesterday wasn't a big day. */
export function recoveryAfter(yesterdayKm: number, regularDayKm: number): string[] | null {
  if (!(regularDayKm > 0)) return null;
  if (yesterdayKm < Math.max(BIG_DAY_MIN_KM, BIG_DAY_SHARE * regularDayKm)) return null;
  const times = Math.round((yesterdayKm / regularDayKm) * 10) / 10;
  return [
    `🛌 Recovery day: yesterday you walked ${formatKm(yesterdayKm * 1000)}, ${times}× a usual day.`,
    `Rest today, or take an easy ${RECOVERY_MINUTES}-minute stroll if you feel like moving. Resting doesn't use one of your rest days or touch your streak.`,
  ];
}

/** Notes for a rest day you agreed with the AI coach in the chat. */
export function coachRestNotes(reason: string): string[] {
  return [
    `🛌 Rest day, agreed with the coach: ${reason}`,
    `An easy ${RECOVERY_MINUTES}-minute stroll is fine if you feel like moving. Resting doesn't use one of your rest days or touch your streak.`,
  ];
}
