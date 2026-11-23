import { addDays, daysBetween, mondayOf, toDateKey } from './dates';
import { HARD_RPE } from './effort';
import { walkEquivalentMeters } from './progress';
import type { Activity, DateKey, GoalEvent, Settings } from './types';

/**
 * One engine for the whole plan: how many (walk-equivalent) km this week.
 * Your recent weeks are the starting point, your goal (aim and/or a dated
 * event) is the destination, and every session is a share of the week.
 */

export const LONG_SHARE = 0.3;
export const BRISK_SHARE = 0.15;
/** A long walk of X km fits a week of about X / 0.33 km. */
export const EVENT_LONG_SHARE = 0.33;
export const MAX_GROWTH = 1.1; // +10% a week at most
export const LIGHT = 0.75; // light week (period, or every 4th)
export const PRE_EVENT = 0.75; // the week before the event week
export const EVENT_WEEK_REST = 0.3; // event week: the event + 30% of a normal week
export const NO_GOAL_HEADROOM = 1.25; // no goal: grow gently to +25% of where you started
export const MULTI_DAY_EXTRA = 1.15; // a multi-day trek needs ~15% more weekly volume
export const B2B_SHARE = 0.2; // the second day of a back-to-back pair
export const B2B_WEEKS = 8; // back-to-back pairs in the last 8 weeks before the pre-event week
const KEEP_GROWING = 0.8; // did ≥80% of last week → grow
const EASE_BELOW = 0.6; // did <60% → ease off 10%
const DAY_MIN = 0.7; // mid-week rebalancing stays within 70–130% of the plan
const DAY_MAX = 1.3;

export type LightReason = 'period' | 'every4' | null;

export type WeekVolume = {
  /** Progression level (before light-week / taper tweaks). */
  baseKm: number;
  /** Planned km this week. */
  km: number;
  light: LightReason;
  preEvent: boolean;
  eventWeek: boolean;
  /** Multi-day trek coming: the long walk is a back-to-back pair this week. */
  backToBack: boolean;
  /** Where the plan is heading, in km a week. */
  destinationKm: number;
  /** With a dated event that can't be reached safely: the long walk you can reach by then. */
  reachableEventKm?: number;
  notes: string[];
  /** Made early (next week, on Sunday): redone on the week's first sync. */
  provisional?: boolean;
  /** Rules version it was computed with; older ones are recomputed. */
  v?: number;
};

/** Walk-equivalent km per Monday–Sunday week. */
export function weekKm(activities: Activity[], monday: DateKey, rideFactor: number, upTo?: DateKey): number {
  const end = upTo ?? addDays(monday, 6);
  return (
    activities
      .filter((a) => {
        const d = toDateKey(a.start);
        return d >= monday && d <= end;
      })
      .reduce((s, a) => s + walkEquivalentMeters(a, rideFactor), 0) / 1000
  );
}

/** Average km of the last `n` complete weeks with any watch data before `monday` (null without any). */
export function recentWeeksKm(activities: Activity[], monday: DateKey, rideFactor: number, n = 2): number | null {
  const weeks: number[] = [];
  for (let w = 1; w <= 6 && weeks.length < n; w++) {
    const m = addDays(monday, -7 * w);
    if (activities.some((a) => mondayOf(toDateKey(a.start)) === m)) weeks.push(weekKm(activities, m, rideFactor));
  }
  return weeks.length ? weeks.reduce((t, k) => t + k, 0) / weeks.length : null;
}

/**
 * Your typical week: median km of the last 4 complete weeks that have any
 * watch data (weeks without the watch don't drag it down). Needs 2 such weeks.
 */
export function typicalWeekKm(activities: Activity[], today: DateKey, rideFactor: number): number | null {
  const thisMonday = mondayOf(today);
  const weeks: number[] = [];
  for (let w = 1; w <= 8 && weeks.length < 4; w++) {
    const monday = addDays(thisMonday, -7 * w);
    const has = activities.some((a) => mondayOf(toDateKey(a.start)) === monday);
    if (has) weeks.push(weekKm(activities, monday, rideFactor));
  }
  if (weeks.length < 2) return null;
  const s = [...weeks].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Where the plan heads: an aim of N km/day is 7N km a week; an event of X km needs ~X/0.33 a week; the higher wins. */
export function destinationKm(settings: Pick<Settings, 'dailyTargetKm' | 'event'>, startKm: number): number {
  const aim = settings.dailyTargetKm ? settings.dailyTargetKm * 7 : 0;
  const ev = settings.event
    ? (settings.event.km / EVENT_LONG_SHARE) * ((settings.event.days ?? 1) >= 2 ? MULTI_DAY_EXTRA : 1)
    : 0;
  return Math.max(aim, ev) || startKm * NO_GOAL_HEADROOM;
}

export type VolumeInput = {
  monday: DateKey;
  settings: Pick<Settings, 'dailyTargetKm' | 'event' | 'startDate'>;
  /** Your typical week now (first plan only). */
  startKm: number;
  /** Last week's plan and what you actually did. */
  prev?: { volume: WeekVolume; actualKm: number } | null;
  /** true/false from your cycle; null when there's no cycle data (→ every 4th week). */
  periodWeek: boolean | null;
  /** The hardest key session last week, as you rated it (1–10). */
  lastWeekHardest?: number | null;
  /** What you actually walked lately: the average of your last 2 weeks with data. */
  recentKm?: number | null;
};

export function planVolume({ monday, settings, startKm, prev, periodWeek, lastWeekHardest, recentKm }: VolumeInput): WeekVolume {
  const notes: string[] = [];
  const destination = destinationKm(settings, startKm);
  const ev = settings.event && settings.event.date >= monday ? settings.event : null;
  const eventMonday = ev ? mondayOf(ev.date) : null;
  const eventWeek = !!eventMonday && eventMonday === monday;
  const preEvent = !!eventMonday && addDays(eventMonday, -7) === monday;
  const days = ev?.days ?? 1;
  const backToBack =
    !!eventMonday &&
    days >= 2 &&
    monday < addDays(eventMonday, -7) &&
    monday >= addDays(eventMonday, -7 - 7 * B2B_WEEKS);

  // Light week: your period week if we know your cycle, else every 4th week.
  let light: LightReason = null;
  if (!ev || (!eventWeek && !preEvent)) {
    if (periodWeek === true) light = 'period';
    else if (periodWeek === null && weekNumber(monday, settings.startDate) % 4 === 3) light = 'every4';
  }

  // Progression level.
  let base = prev ? prev.volume.baseKm : startKm;
  if (!prev) notes.push(`Starts from your typical week: ${round1(startKm)} km.`);
  // The plan never stays below what you actually walk: catch up with your last 2 weeks.
  if (recentKm != null && recentKm > base && base < destination) {
    base = Math.min(destination, recentKm);
    notes.push(`Catching up with what you actually walk: ${round1(recentKm)} km a week lately.`);
  }
  const prevWasEasy = !!prev && (prev.volume.light || prev.volume.preEvent || prev.volume.eventWeek);
  if (prev && !light && !eventWeek && !preEvent && base < destination) {
    const done = prev && prev.volume.km > 0 ? prev.actualKm / prev.volume.km : 1;
    if (prev && !prevWasEasy && done < EASE_BELOW) {
      base *= 0.9;
      notes.push(`Last week you did ${round1(prev.actualKm)} of ${round1(prev.volume.km)} km: easing off 10%.`);
    } else if (prev && !prevWasEasy && done < KEEP_GROWING) {
      notes.push(`Last week you did ${round1(prev.actualKm)} of ${round1(prev.volume.km)} km: holding steady.`);
    } else if (lastWeekHardest != null && lastWeekHardest >= HARD_RPE) {
      notes.push(`A key walk last week felt ${lastWeekHardest}/10: holding steady before the next step.`);
    } else {
      let rate = MAX_GROWTH;
      if (ev && eventMonday) {
        // Grow just enough to peak the week before the pre-event week.
        const growthWeeks = Math.max(1, daysBetween(monday, addDays(eventMonday, -14)) / 7 + 1);
        rate = Math.min(MAX_GROWTH, Math.max(1, Math.pow(destination / base, 1 / growthWeeks)));
      }
      base = Math.min(destination, base * rate);
      if (prev) notes.push(`Up ${Math.round((rate - 1) * 100)}% from last week’s plan, toward ${round1(destination)} km a week.`);
    }
  }

  let km = base;
  if (eventWeek && ev) {
    km = ev.km * days + base * EVENT_WEEK_REST;
    notes.push(
      days >= 2
        ? `Trek week: ${ev.name}, ${days} days of ${ev.km} km. Easy days around it.`
        : `Event week: ${ev.name} (${ev.km} km) plus a few easy days.`,
    );
  } else if (preEvent && ev) {
    km = base * PRE_EVENT;
    notes.push(`Lighter week before ${ev.name}, to arrive fresh.`);
  } else if (light === 'period') {
    km = base * LIGHT;
    notes.push('Light week: your period is due. 25% less, and no pace push.');
  } else if (light === 'every4') {
    km = base * LIGHT;
    notes.push('Light week (every 4th): 25% less, to recover.');
  }

  // Can the event be reached safely (≤10% a week)?
  let reachableEventKm: number | undefined;
  if (ev && eventMonday && !eventWeek && !preEvent) {
    const growthWeeks = Math.max(0, daysBetween(monday, addDays(eventMonday, -14)) / 7);
    const peak = Math.min(destination, base * Math.pow(MAX_GROWTH, growthWeeks));
    const reachable = peak * EVENT_LONG_SHARE;
    if (reachable < ev.km * 0.95) {
      reachableEventKm = Math.round(reachable * 2) / 2;
      notes.push(
        `Heads-up: growing at most 10% a week, by ${ev.date} you can safely reach a long walk of about ${reachableEventKm} km, not ${ev.km}. Consider a later date or a shorter goal.`,
      );
    }
  }

  if (backToBack && ev) notes.push(`Back-to-back long walks this week: practice for ${days} trek days in a row.`);

  return {
    baseKm: round1(base),
    km: round1(km),
    light,
    preEvent,
    eventWeek,
    backToBack,
    destinationKm: round1(destination),
    ...(reachableEventKm != null ? { reachableEventKm } : {}),
    notes,
  };
}

/**
 * How the week's km is shared: long walk 30%, brisk walk 15%, the second
 * day of a back-to-back pair 20%, trek days their own distance, and the rest
 * across your other training days.
 */
export function weekSplit(
  volume: WeekVolume,
  restDaysPerWeek: number,
  sessions: { long: boolean; brisk: boolean; backToBack: boolean; trekDays: number },
  event?: GoalEvent | null,
): { longKm: number; briskKm: number; b2bKm: number; trekKm: number; regularDayKm: number; regularDays: number } {
  const trekKm = sessions.trekDays && event ? event.km : 0;
  const longKm = sessions.long ? (volume.eventWeek && event ? event.km : volume.km * LONG_SHARE) : 0;
  const briskKm = sessions.brisk ? volume.km * BRISK_SHARE : 0;
  const b2bKm = sessions.backToBack ? volume.km * B2B_SHARE : 0;
  const keyDays = (sessions.long ? 1 : 0) + (sessions.brisk ? 1 : 0) + (sessions.backToBack ? 1 : 0) + sessions.trekDays;
  const trainingDays = Math.max(1, 7 - restDaysPerWeek);
  const regularDays = Math.max(1, trainingDays - keyDays);
  const regularDayKm = Math.max(0, volume.km - longKm - briskKm - b2bKm - trekKm * sessions.trekDays) / regularDays;
  return {
    longKm: round1(longKm),
    briskKm: round1(briskKm),
    b2bKm: round1(b2bKm),
    trekKm,
    regularDayKm: round1(regularDayKm),
    regularDays,
  };
}

/**
 * Mid-week rebalancing for a regular day: what's left of the week (minus
 * the key sessions still to come) over the training days left, within
 * 70–130% of the planned share.
 */
export function rebalancedDayKm(input: {
  plannedDayKm: number;
  weekKm: number;
  doneKm: number;
  keyKmLeft: number;
  daysLeft: number;
  keyDaysLeft: number;
  restLeft: number;
}): number {
  const slots = Math.max(1, input.daysLeft - input.keyDaysLeft - input.restLeft);
  const left = input.weekKm - input.doneKm - input.keyKmLeft;
  const raw = left / slots;
  return round1(Math.min(input.plannedDayKm * DAY_MAX, Math.max(input.plannedDayKm * DAY_MIN, raw)));
}

function weekNumber(monday: DateKey, startDate: DateKey): number {
  return Math.floor(daysBetween(mondayOf(startDate), monday) / 7);
}

const round1 = (x: number) => Math.round(x * 10) / 10;
