import { addDays, daysBetween, mondayOf, toDateKey } from './dates';
import { walkEquivalentMeters } from './progress';
import type { Activity, DateKey, KeySessionKind, Settings } from './types';
import type { WeekVolume } from './volume';

/**
 * long_walk: the week's long walk · brisk_walk: walk at a target pace ·
 * back_to_back: a second long walk the day after (multi-day trek training) ·
 * trek_day: a day of your trek (fixed, can't be moved).
 */
export type SessionKind = 'long_walk' | 'brisk_walk' | 'back_to_back' | 'trek_day';

/** A key session in the weekly plan. Its target is set on the day, from the week's km. */
export type KeySession = {
  id: string;
  kind: SessionKind;
  /** The day it's on now. */
  day: DateKey;
  /** The day it was first planned for (differs once moved). */
  plannedDay: DateKey;
  /** The week ran out of free days before you could do it. */
  dropped?: boolean;
  /** You (or the coach, with your OK) put it on this day: work days don't move it. */
  pinned?: boolean;
};

export type WeekPlan = {
  /** Monday of the week. */
  week: DateKey;
  sessions: KeySession[];
  /** How many km this week and why (weekly-volume plans, v7+). */
  volume?: WeekVolume;
  /** Changes you accepted from the AI coach's Sunday review (kept when the week's km is recomputed). */
  coach?: { factor: number };
};

/** The goal type a session is measured as. */
export const goalKindOf = (k: SessionKind): KeySessionKind => (k === 'brisk_walk' ? 'brisk_walk' : 'long_walk');

/** Next week's plan appears on Sunday from this hour, so you can arrange it before Monday. */
export const NEXT_WEEK_FROM_HOUR = 18;

/** Long walk and brisk walk at least this many days apart, when the week allows. */
const MIN_GAP = 2;

export type PlanOptions = {
  /** Make the long walk a pair of consecutive days (multi-day trek training). */
  backToBack?: boolean;
  /** Days of the trek that fall in this week. */
  trekDays?: DateKey[];
  /** Work days (from your calendar): key sessions go elsewhere when possible. */
  busy?: DateKey[];
};

/**
 * Place this week's key sessions:
 * - trek week: the trek days (nothing else),
 * - the long walk on the weekday you usually move the most (by total
 *   distance over the last 90 days; Saturday if there's no history); with
 *   back-to-back training, the best pair of consecutive days,
 * - the brisk walk on your next-best weekday at least 2 days from them.
 * Only days from `firstDay` on are used (a plan made mid-week). The brisk
 * walk is left out if there's no room for it.
 */
export function planWeek(
  monday: DateKey,
  firstDay: DateKey,
  activities: Activity[],
  settings: Pick<Settings, 'rideFactor'>,
  opts: PlanOptions = {},
): WeekPlan {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => d >= firstDay);
  const sessions: KeySession[] = [];

  if (opts.trekDays?.length) {
    opts.trekDays.forEach((d, i) => sessions.push({ id: `trek-${i + 1}`, kind: 'trek_day', day: d, plannedDay: d }));
    return { week: monday, sessions };
  }

  const score = weekdayScores(activities, monday, settings.rideFactor);
  // Ties (or no history): prefer Saturday, then Sunday, then Wednesday…
  const preference = [5, 6, 2, 3, 4, 1, 0];
  const rank = (d: DateKey) => {
    const i = daysBetween(monday, d);
    return score[i] * 10 - preference.indexOf(i) * 0.001 - (opts.busy?.includes(d) ? 1e6 : 0);
  };
  const byRank = [...days].sort((a, b) => rank(b) - rank(a));

  let long: DateKey | undefined;
  let second: DateKey | undefined;
  if (opts.backToBack) {
    const pairs = days.filter((d) => days.includes(addDays(d, 1)));
    const best = pairs.sort((a, b) => rank(b) + rank(addDays(b, 1)) - (rank(a) + rank(addDays(a, 1))))[0];
    if (best) {
      long = best;
      second = addDays(best, 1);
    }
  }
  long ??= byRank[0];
  if (!long) return { week: monday, sessions };
  sessions.push({ id: 'long', kind: 'long_walk', day: long, plannedDay: long });
  if (second) sessions.push({ id: 'b2b', kind: 'back_to_back', day: second, plannedDay: second });

  const taken = sessions.map((s) => s.day);
  const brisk = byRank.find((d) => taken.every((t) => Math.abs(daysBetween(t, d)) >= MIN_GAP));
  if (brisk) sessions.push({ id: 'brisk', kind: 'brisk_walk', day: brisk, plannedDay: brisk });
  return { week: monday, sessions };
}

/** Plans saved before sessions had ids (one per kind) get them. */
export function normalizePlan(plan: WeekPlan): WeekPlan {
  const ids: Record<string, string> = { long_walk: 'long', brisk_walk: 'brisk', back_to_back: 'b2b' };
  return { ...plan, sessions: plan.sessions.map((s) => (s.id ? s : { ...s, id: ids[s.kind] ?? s.kind })) };
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

export const sessionById = (plan: WeekPlan, id: string) => plan.sessions.find((s) => s.id === id);

/** Trek days are fixed; everything else can move. */
export const isMovable = (s: KeySession) => s.kind !== 'trek_day';

/**
 * Days a session can move to: this week, from today on (today only if it
 * isn't already done), not hosting another key session.
 */
export function freeDays(plan: WeekPlan, today: DateKey, todayDone: boolean, id: string): DateKey[] {
  const taken = new Set(plan.sessions.filter((s) => s.id !== id && !s.dropped).map((s) => s.day));
  return Array.from({ length: 7 }, (_, i) => addDays(plan.week, i)).filter(
    (d) => (d > today || (d === today && !todayDone)) && !taken.has(d),
  );
}

/** Move a key session to another free day this week. Returns the plan unchanged if that isn't allowed. */
export function moveSession(
  plan: WeekPlan,
  id: string,
  to: DateKey,
  today: DateKey,
  todayDone: boolean,
  /** You chose the day: work days won't move it again. */
  pin = false,
): WeekPlan {
  const s = sessionById(plan, id);
  if (!s || !isMovable(s) || !freeDays(plan, today, todayDone, id).includes(to)) return plan;
  return { ...plan, sessions: plan.sessions.map((x) => (x.id === id ? { ...x, day: to, dropped: false, ...(pin ? { pinned: true } : {}) } : x)) };
}

/** Drop a session for this week (no free day left). */
export function dropSession(plan: WeekPlan, id: string): WeekPlan {
  return { ...plan, sessions: plan.sessions.map((x) => (x.id === id ? { ...x, dropped: true } : x)) };
}

/**
 * Key sessions whose day has passed without being done slide to the next
 * free day this week (today if today isn't done yet). With no free day left
 * they're dropped. Trek days don't move. `doneOn(day)` tells whether that
 * day's goal was met.
 */
export function forwardMissed(
  plan: WeekPlan,
  today: DateKey,
  doneOn: (day: DateKey) => boolean,
): { plan: WeekPlan; moved: KeySession[] } {
  let next = plan;
  const moved: KeySession[] = [];
  for (const s of plan.sessions) {
    if (s.dropped || !isMovable(s) || s.day >= today || doneOn(s.day)) continue;
    const to = freeDays(next, today, doneOn(today), s.id)[0];
    next = to ? moveSession(next, s.id, to, addDays(today, -1), false) : dropSession(next, s.id);
    if (to) moved.push({ ...s, day: to });
  }
  return { plan: next, moved };
}

/** Whether next week's plan should already exist (Sunday evening onward). */
export function nextWeekVisible(now: Date): boolean {
  return now.getDay() === 0 && now.getHours() >= NEXT_WEEK_FROM_HOUR;
}

export type ShiftMove = { id: string; kind: SessionKind; from: DateKey; to: DateKey };

/**
 * Key sessions that landed on a work day (from your calendar) move to a free
 * day of the same week that isn't one: 2+ days from the other sessions if
 * possible, else the nearest. Sessions you placed yourself stay put, and a
 * session with nowhere better to go stays where it is.
 */
export function avoidBusyDays(
  plan: WeekPlan,
  busy: DateKey[],
  today: DateKey,
  todayDone: boolean,
): { plan: WeekPlan; moved: ShiftMove[] } {
  const moved: ShiftMove[] = [];
  let p = plan;
  for (const s of plan.sessions) {
    if (s.dropped || s.pinned || !isMovable(s) || !busy.includes(s.day)) continue;
    if (s.day < today || (s.day === today && todayDone)) continue;
    const current = sessionById(p, s.id)!;
    const options = freeDays(p, today, todayDone, s.id).filter((d) => !busy.includes(d));
    if (!options.length) continue;
    const others = p.sessions.filter((x) => x.id !== s.id && !x.dropped).map((x) => x.day);
    const gapOk = (d: DateKey) => others.every((o) => Math.abs(daysBetween(o, d)) >= MIN_GAP);
    const near = (d: DateKey) => Math.abs(daysBetween(current.day, d));
    const to = [...options].sort((a, b) => Number(gapOk(b)) - Number(gapOk(a)) || near(a) - near(b) || (a < b ? -1 : 1))[0];
    p = { ...p, sessions: p.sessions.map((x) => (x.id === s.id ? { ...x, day: to } : x)) };
    moved.push({ id: s.id, kind: s.kind, from: current.day, to });
  }
  return { plan: p, moved };
}
