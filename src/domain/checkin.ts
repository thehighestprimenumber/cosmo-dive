import { addDays, daysBetween, mondayOf, parseTime } from './dates';
import type { DateKey, DayStatus, GoalMeta, GoalSpec } from './types';

/**
 * The coach's morning check-in: only on days when something stands out, so
 * ordinary days cost nothing and the coach doesn't become noise.
 */

/** The check-in runs from your morning reminder until noon. */
export const CHECKIN_UNTIL_HOUR = 12;
/** A conversation this recent gets a follow-up. */
export const FOLLOW_UP_HOURS = 36;
/** Behind on the week: from Thursday, under 60% of where the week "should" be. */
const BEHIND_SHARE = 0.6;

type DayLike = { date: DateKey; goal: GoalSpec | null; value: number; done: boolean; status: DayStatus; meta?: GoalMeta };

/** Beating the goal by this much (120%) is worth a word in the morning. */
export const BEAT_BY = 1.2;

/** The goal's target in its own unit (metres or seconds). */
export function goalTarget(goal: GoalSpec): number {
  return 'meters' in goal ? goal.meters : goal.seconds;
}

export type CheckinInput = {
  today: DateKey;
  todayRecovery: boolean;
  todayReadiness: 'low' | 'normal' | 'high' | 'unknown';
  days: Map<DateKey, DayLike>;
  weekPlannedKm: number;
  weekDoneKm: number;
  restLeftThisWeek: number;
  streak: number;
  /** When you last wrote to the coach (epoch ms), if ever. */
  lastUserMessageAt: number | null;
  /** How hard yesterday's key session felt, if rated. */
  yesterdayFelt?: number | null;
  now: Date;
};

/** Why today deserves a check-in (empty: an ordinary day, no check-in). */
export function checkinReasons(i: CheckinInput): string[] {
  const reasons: string[] = [];
  if (i.todayRecovery) reasons.push('Yesterday was a very big day: today is a recovery day.');
  if (i.yesterdayFelt != null && i.yesterdayFelt >= 9) reasons.push(`Yesterday's key walk felt ${i.yesterdayFelt}/10.`);
  const y = i.days.get(addDays(i.today, -1));
  if (y?.goal && y.done && y.value >= goalTarget(y.goal) * BEAT_BY) {
    reasons.push(`Yesterday's goal beaten by far: ${Math.round((y.value / goalTarget(y.goal)) * 100)}% of it. Congratulate them.`);
  }
  if (i.todayReadiness === 'low') reasons.push('Readiness is low today (short night or raised resting heart rate).');

  const missed = (d: DateKey) => {
    const day = i.days.get(d);
    return !!day?.goal && !day.done && !day.meta?.recovery;
  };
  if (missed(addDays(i.today, -1)) && missed(addDays(i.today, -2))) {
    reasons.push('The last 2 days went without the goal.');
  }

  const elapsed = daysBetween(mondayOf(i.today), i.today); // full days before today this week
  if (elapsed >= 3 && i.weekPlannedKm > 0 && i.weekDoneKm < i.weekPlannedKm * (elapsed / 7) * BEHIND_SHARE) {
    reasons.push(`Behind on the week: ${i.weekDoneKm} of ${i.weekPlannedKm} km with ${7 - elapsed} days left.`);
  }

  if (i.restLeftThisWeek === 0 && i.streak >= 3) {
    reasons.push(`No rest days left this week: skipping today costs a freeze or the ${i.streak}-day streak.`);
  }

  if (i.lastUserMessageAt && i.now.getTime() - i.lastUserMessageAt < FOLLOW_UP_HOURS * 3_600_000) {
    reasons.push('You talked recently: follow up if what they said matters for today.');
  }
  return reasons;
}

/** Time for today's check-in? Once a day, from the morning reminder until noon. */
export function checkinDue(now: Date, today: DateKey, lastCheckin: DateKey | null, morningReminder: string): boolean {
  if (lastCheckin === today) return false;
  const from = parseTime(morningReminder) ?? { hour: 8, minute: 0 };
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= from.hour * 60 + from.minute && now.getHours() < CHECKIN_UNTIL_HOUR;
}
