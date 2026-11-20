import { addDays, daysBetween, mondayOf, toDateKey } from './dates';
import { walkEquivalentMeters } from './progress';
import type { Activity, DateKey, KeySessionKind, Settings } from './types';

/** A key session in the weekly plan. Its target is set on the day, from your latest data. */
export type KeySession = {
  kind: KeySessionKind;
  /** The day it's on now. */
  day: DateKey;
  /** The day it was first planned for (differs once moved). */
  plannedDay: DateKey;
  /** The week ran out of free days before you could do it. */
  dropped?: boolean;
};

export type WeekPlan = {
  /** Monday of the week. */
  week: DateKey;
  sessions: KeySession[];
};

/** Next week's plan appears on Sunday from this hour, so you can arrange it before Monday. */
export const NEXT_WEEK_FROM_HOUR = 18;

/** Long walk and brisk walk at least this many days apart, when the week allows. */
const MIN_GAP = 2;

/**
 * Place this week's key sessions:
 * - the long walk on the weekday you usually move the most (by total
 *   distance over the last 90 days; Saturday if there's no history),
 * - the brisk walk on your next-best weekday at least 2 days away.
 * Only days from `firstDay` on are used (a plan made mid-week). The brisk
 * walk is left out if there's no room for it.
 */
export function planWeek(
  monday: DateKey,
  firstDay: DateKey,
  activities: Activity[],
  settings: Pick<Settings, 'rideFactor'>,
): WeekPlan {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => d >= firstDay);
  const score = weekdayScores(activities, monday, settings.rideFactor);
  // Ties (or no history): prefer Saturday, then Sunday, then Wednesday…
  const preference = [5, 6, 2, 3, 4, 1, 0];
  const rank = (d: DateKey) => {
    const i = daysBetween(monday, d);
    return score[i] * 10 - preference.indexOf(i) * 0.001;
  };
  const sessions: KeySession[] = [];
  const byRank = [...days].sort((a, b) => rank(b) - rank(a));
  const long = byRank[0];
  if (!long) return { week: monday, sessions };
  sessions.push({ kind: 'long_walk', day: long, plannedDay: long });
  const brisk = byRank.find((d) => Math.abs(daysBetween(long, d)) >= MIN_GAP);
  if (brisk) sessions.push({ kind: 'brisk_walk', day: brisk, plannedDay: brisk });
  return { week: monday, sessions };
}

/** Total walk-equivalent km per weekday (Mon = 0) over the 90 days before `monday`. */
function weekdayScores(activities: Activity[], monday: DateKey, rideFactor: number): number[] {
  const from = addDays(monday, -90);
  const score = [0, 0, 0, 0, 0, 0, 0];
  for (const a of activities) {
    const d = toDateKey(a.start);
    if (d < from || d >= monday) continue;
    score[daysBetween(mondayOf(d), d)] += walkEquivalentMeters(a, rideFactor) / 1000;
  }
  return score;
}

export const sessionOn = (plan: WeekPlan | null | undefined, day: DateKey): KeySession | undefined =>
  plan?.sessions.find((s) => s.day === day && !s.dropped);

/**
 * Days a session can move to: this week, from today on (today only if it
 * isn't already done), not hosting the other key session.
 */
export function freeDays(plan: WeekPlan, today: DateKey, todayDone: boolean, kind: KeySessionKind): DateKey[] {
  const taken = new Set(plan.sessions.filter((s) => s.kind !== kind && !s.dropped).map((s) => s.day));
  return Array.from({ length: 7 }, (_, i) => addDays(plan.week, i)).filter(
    (d) => (d > today || (d === today && !todayDone)) && !taken.has(d),
  );
}

/** Move a key session to another free day this week. Returns the plan unchanged if that isn't allowed. */
export function moveSession(
  plan: WeekPlan,
  kind: KeySessionKind,
  to: DateKey,
  today: DateKey,
  todayDone: boolean,
): WeekPlan {
  if (!freeDays(plan, today, todayDone, kind).includes(to)) return plan;
  return {
    ...plan,
    sessions: plan.sessions.map((s) => (s.kind === kind ? { ...s, day: to, dropped: false } : s)),
  };
}

/**
 * Key sessions whose day has passed without being done slide to the next
 * free day this week (today if today isn't done yet). With no free day left
 * they're dropped. `doneOn(day)` tells whether that day's goal was met.
 */
export function forwardMissed(
  plan: WeekPlan,
  today: DateKey,
  doneOn: (day: DateKey) => boolean,
): { plan: WeekPlan; moved: KeySession[] } {
  let next = plan;
  const moved: KeySession[] = [];
  for (const s of plan.sessions) {
    if (s.dropped || s.day >= today || doneOn(s.day)) continue;
    const to = freeDays(next, today, doneOn(today), s.kind)[0];
    next = {
      ...next,
      sessions: next.sessions.map((x) =>
        x.kind === s.kind ? (to ? { ...x, day: to } : { ...x, dropped: true }) : x,
      ),
    };
    if (to) moved.push({ ...s, day: to });
  }
  return { plan: next, moved };
}

/** Whether next week's plan should already exist (Sunday evening onward). */
export function nextWeekVisible(now: Date): boolean {
  return now.getDay() === 0 && now.getHours() >= NEXT_WEEK_FROM_HOUR;
}
