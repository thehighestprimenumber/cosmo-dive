import { addDays, daysBetween, mondayOf, toDateKey } from './dates';
import { formatKm, formatMinutes, formatPace } from './format';
import { AEROBIC_ZONE_SHARE } from './aerobic';
import { AIM_START, AIM_STEP, aimPerTrainingDay, walkingPace } from './aim';
import { BOSS_FACTOR, isBossDay, XP } from './game';
import { measure } from './progress';
import type { Readiness } from './readiness';
import type {
  Activity,
  DailyGoal,
  DateKey,
  DayResult,
  DayStatus,
  RegularGoalSpec,
  RegularKind,
  GoalSpec,
  HrZone,
  DistanceSport,
  Settings,
} from './types';

/**
 * Bump this whenever the rules below change. Stored goals keep the version
 * that created them, so old history never gets silently reinterpreted, and
 * goals from older versions are never used as a starting point.
 */
export const PLAN_VERSION = 7;

/** How far back "your typical day" looks. */
export const LOOKBACK_DAYS = 90;
/** A day counts as an exercise day with at least this much exercise in total. */
export const MIN_ACTIVE_DAY_S = 15 * 60;
/** Bin widths for finding the most common daily total. */
const MODE_BIN = { distance: 500, duration: 5 * 60, hr_zone: 5 * 60 } as const;

const PROGRESS_UP = 1.07; // hitting this goal type lately (max once a week per type)
const EASE_OFF = 0.85; // missed two training days in a row (beyond your rest days)
const RECOVERY = 0.8; // every 4th week is lighter
const AFTER_BIG_DAY = 0.9; // yesterday you did 150%+ of your goal
const BIG_DAY = 1.5;
/** Goals stay between these fractions of your typical day. */
const FLOOR = 0.8;
const CEILING = 1.5;

const DEFAULTS = {
  distance: 3000, // walk-equivalent metres
  duration: 30 * 60,
  hr_zone: 15 * 60,
} as const;

const LIMITS = {
  distance: [1000, 40_000],
  duration: [10 * 60, 180 * 60],
  hr_zone: [5 * 60, 90 * 60],
} as const;

/** Distances round to 0.1 km; times to 1 minute. */
const STEP = { distance: 100, duration: 60, hr_zone: 60 } as const;

export type GeneratorInput = {
  date: DateKey;
  settings: Settings;
  /** Activities covering at least the LOOKBACK_DAYS before `date`. Later ones are ignored. */
  activities: Activity[];
  /** Results of earlier days. Days on/after `date` are ignored. */
  history: DayResult[];
  /** Streak statuses of earlier days, so rest days aren't mistaken for misses. */
  statuses?: Map<DateKey, DayStatus>;
  /** Last night's sleep and resting heart rate, if available. */
  readiness?: Readiness;
  /** You picked the goal type yourself (e.g. a time goal on a kayak day). */
  kind?: RegularKind;
  /**
   * Weekly-volume plan: this day's km (already rebalanced for the week so far).
   * When set, the target comes from it instead of the day-by-day rules.
   */
  dayKm?: number;
  /** Why the week and the day have the km they have. */
  planNotes?: string[];
  /** Light week: heart-rate goals stay in Zone 2. */
  light?: boolean;
  /** Aerobic-base phase (event at altitude): more Zone 2 days, longer in zone. */
  aerobic?: boolean;
};

/** Heart-rate goals ask for this share of the day's time in the zone. */
const ZONE_SHARE = 0.5;
const DEFAULT_PACE_S_PER_M = 0.72; // 12:00 min/km

export function generateGoal({
  date,
  settings,
  activities,
  history,
  statuses,
  readiness,
  kind: chosenKind,
  dayKm,
  planNotes = [],
  light,
  aerobic,
}: GeneratorInput): DailyGoal {
  const windowStart = addDays(date, -LOOKBACK_DAYS);
  const recent = activities.filter((a) => {
    const d = toDateKey(a.start);
    return d >= windowStart && d < date;
  });
  const past = history.filter((h) => h.date < date).sort((a, b) => (a.date < b.date ? 1 : -1));

  const hasHr = recent.some((a) => a.hr.length >= 2);
  const kind = chosenKind ?? kindForDay(date, hasHr, aerobic);
  const week = weekIndex(date, settings.startDate);
  const recovery = isRecoveryWeek(date, settings.startDate);

  let spec: RegularGoalSpec;
  if (kind === 'hr_zone') {
    const zone: HrZone = !aerobic && !light && week % 2 === 1 && !recovery ? 3 : 2;
    spec = { kind, zone, seconds: 0 };
  } else if (kind === 'distance') {
    spec = { kind, meters: 0, suggestedSport: favouriteSport(recent) };
  } else {
    spec = { kind, seconds: 0 };
  }
  const notes: string[] = [];
  if (dayKm != null) {
    return fromWeeklyPlan({ date, spec, dayKm, recent, readiness, chosen: !!chosenKind, planNotes, light, aerobic });
  }
  if (chosenKind) notes.push('You picked this goal type for today.');
  const fmt = (v: number) => (kind === 'distance' ? formatKm(v) : formatMinutes(v));

  // 1. Your typical day for this goal type, from your own history.
  const typical = baselineFor(spec, recent, settings);
  const last = past.find(
    (h) => h.goal && sameType(h.goal, spec) && h.planVersion === PLAN_VERSION && h.meta?.base != null,
  );
  let base: number;
  if (last?.meta) {
    base = last.meta.base;
  } else if (typical) {
    base = typical.value;
  } else {
    base = DEFAULTS[kind];
    notes.push('Starter goal: not enough history for this goal type yet.');
  }
  if (typical) notes.push(`Your most common ${typical.label}: ${fmt(typical.value)} (from ${typical.days} exercise days).`);
  else if (last?.meta) notes.push(`Continues from your last goal of this type (${fmt(last.meta.base)}).`);

  // Your aim (Settings): average km per day. Start no lower than 60% of what a
  // training day needs, then step up 10% per completed goal until there.
  const aim = aimPerTrainingDay(kind, settings, recent);
  if (aim) {
    notes.push(
      `Aim: ${settings.dailyTargetKm} km a day on average → ${fmt(aim)} on training days (${settings.restDaysPerWeek} rest days a week).`,
    );
    base = Math.max(base, aim * AIM_START);
  }

  // 2. How it has been going. Rest days aren't misses.
  const isTraining = (h: DayResult) => {
    const st = statuses?.get(h.date);
    return st ? st === 'done' || st === 'missed' || st === 'frozen' : h.goal != null;
  };
  const training = past.filter(isTraining);
  const missedTwo = training.length >= 2 && !training[0].done && !training[1].done;
  const sameKind = training.filter((h) => sameType(h.goal!, spec)).slice(0, 3);
  if (missedTwo) {
    base *= EASE_OFF;
    notes.push('Easing off a little after two missed days.');
  } else if (aim && base < aim) {
    if (last?.done) {
      base = Math.min(aim, base * AIM_STEP);
      notes.push(`Up 10% toward your aim: you completed your last goal of this type.`);
    } else if (last) {
      notes.push('Holding steady until you complete this goal type, then up 10% toward your aim.');
    }
  } else if (
    sameKind.length >= 2 &&
    sameKind.every((h) => h.done) &&
    // At most one step up per goal type per week.
    weekIndex(sameKind[0].date, settings.startDate) < week
  ) {
    base *= PROGRESS_UP;
    notes.push('Up 7%: you’ve been hitting this goal.');
  }

  // 3. Stay anchored to what you really do.
  if (typical) base = clamp(base, typical.value * FLOOR, Math.max(typical.value * CEILING, aim ?? 0));
  base = clamp(base, LIMITS[kind][0], LIMITS[kind][1]);

  // 4. Today-only tweaks (never carried into the next goal).
  let target = base;
  if (recovery) {
    target *= RECOVERY;
    notes.push('Recovery week: lighter on purpose.');
  }
  const yesterday = past[0];
  if (
    yesterday?.date === addDays(date, -1) &&
    yesterday.goal &&
    yesterday.value >= BIG_DAY * targetOf(yesterday.goal)
  ) {
    target *= AFTER_BIG_DAY;
    notes.push('A bit lighter after yesterday’s big effort.');
  }
  if (readiness && readiness.level !== 'unknown') {
    target *= readiness.factor;
    notes.push(...readiness.notes);
  }
  const boss = isBossDay(date);
  if (boss) {
    target *= BOSS_FACTOR;
    notes.push(`⚔️ Boss day: 25% harder, worth ${XP.boss} XP.`);
  }
  target = clamp(roundTo(target, STEP[kind]), LIMITS[kind][0], LIMITS[kind][1]);

  return {
    date,
    goal: withTarget(spec, target),
    planVersion: PLAN_VERSION,
    meta: { base: roundTo(base, STEP[kind]), notes, readiness: readiness?.level ?? 'unknown', ...(boss ? { boss } : {}) },
  };
}

/**
 * A regular day in a weekly-volume plan: its km, as distance, as time at your
 * walking pace, or as time in a heart-rate zone (half of that time).
 * Readiness and boss days still tweak today only.
 */
function fromWeeklyPlan(p: {
  date: DateKey;
  spec: RegularGoalSpec;
  dayKm: number;
  recent: Activity[];
  readiness?: Readiness;
  chosen: boolean;
  planNotes: string[];
  light?: boolean;
  aerobic?: boolean;
}): DailyGoal {
  const { date, dayKm, recent, readiness } = p;
  let spec = p.spec;
  if (p.light && spec.kind === 'hr_zone') spec = { ...spec, zone: 2 };
  const pace = walkingPace(recent) ?? DEFAULT_PACE_S_PER_M;
  const notes = [...(p.chosen ? ['You picked this goal type for today.'] : []), ...p.planNotes];
  const kind = spec.kind;
  let base: number;
  if (kind === 'distance') base = dayKm * 1000;
  else if (kind === 'duration') base = dayKm * 1000 * pace;
  else base = dayKm * 1000 * pace * (p.aerobic ? AEROBIC_ZONE_SHARE : ZONE_SHARE);
  if (p.aerobic && kind !== 'distance') {
    notes.push('Aerobic base for the altitude: easy pace, you should be able to chat. Zone 2 makes the same effort cheaper up high.');
  }
  if (kind !== 'distance') {
    notes.push(`${formatKm(dayKm * 1000)} at your walking pace (${formatPace(pace * 1000)}) is about ${formatMinutes(dayKm * 1000 * pace)}.`);
  }

  let target = base;
  if (readiness && readiness.level !== 'unknown') {
    target *= readiness.factor;
    notes.push(...readiness.notes);
  }
  const boss = isBossDay(date) && !p.light;
  if (boss) {
    target *= BOSS_FACTOR;
    notes.push(`⚔️ Boss day: 25% harder, worth ${XP.boss} XP.`);
  }
  target = clamp(roundTo(target, STEP[kind]), LIMITS[kind][0], LIMITS[kind][1]);
  return {
    date,
    goal: withTarget(spec, target) as RegularGoalSpec,
    planVersion: PLAN_VERSION,
    meta: {
      base: roundTo(base, STEP[kind]),
      notes,
      readiness: readiness?.level ?? 'unknown',
      ...(boss ? { boss } : {}),
    },
  };
}

/** The weekly mix: the 7 days get a shuffled, balanced spread of goal types. */
export function kindForDay(date: DateKey, hasHr: boolean, aerobic = false): RegularKind {
  const monday = mondayOf(date);
  // Aerobic-base phase: about half the days are Zone 2 (or easy time without heart rate data).
  const base: RegularKind[] = aerobic
    ? hasHr
      ? ['hr_zone', 'distance', 'hr_zone', 'duration']
      : ['duration', 'distance', 'duration']
    : hasHr
      ? ['duration', 'distance', 'hr_zone']
      : ['duration', 'distance'];
  const kinds = Array.from({ length: 7 }, (_, i) => base[i % base.length]);
  shuffle(kinds, seedFrom(monday));
  avoidRepeats(kinds);
  return kinds[daysBetween(monday, date)];
}

export function weekIndex(date: DateKey, startDate: DateKey): number {
  return Math.floor(daysBetween(mondayOf(startDate), date) / 7);
}

export function isRecoveryWeek(date: DateKey, startDate: DateKey): boolean {
  return weekIndex(date, startDate) % 4 === 3;
}

export type Typical = { value: number; days: number; label: string };

/**
 * Total exercise per day, in the goal's unit: everything you did that day
 * added up (several short walks count together; rides count at 1/rideFactor
 * for distance). Only days with 15+ minutes of exercise in total count.
 */
export function dailyTotals(spec: RegularGoalSpec, recent: Activity[], settings: Settings): number[] {
  const byDay = new Map<DateKey, Activity[]>();
  for (const a of recent) {
    const d = toDateKey(a.start);
    byDay.set(d, [...(byDay.get(d) ?? []), a]);
  }
  return [...byDay.values()]
    .filter((acts) => acts.reduce((t, a) => t + a.durationS, 0) >= MIN_ACTIVE_DAY_S)
    .map((acts) => measure(spec, acts, settings))
    .filter((v) => v > 0);
}

/**
 * Your typical day for a goal type: the mode (most common value) of your
 * daily exercise totals over the lookback window. Needs at least 3 days.
 */
export function baselineFor(spec: RegularGoalSpec, recent: Activity[], settings: Settings): Typical | null {
  const totals = dailyTotals(spec, recent, settings);
  if (totals.length < 3) return null;
  const label =
    spec.kind === 'distance' ? 'day (walking km)' : spec.kind === 'duration' ? 'active time' : `Zone ${spec.zone} time`;
  return { value: mostCommon(totals, MODE_BIN[spec.kind]), days: totals.length, label };
}

/**
 * Mode of continuous values: group into bins of `bin`, take the fullest bin
 * (ties: the one nearest the median) and return the median inside it. If no
 * bin has more than one value, falls back to the median.
 */
export function mostCommon(xs: number[], bin: number): number {
  const bins = new Map<number, number[]>();
  for (const x of xs) {
    const k = Math.floor(x / bin);
    bins.set(k, [...(bins.get(k) ?? []), x]);
  }
  const m = median(xs);
  let best: number[] | null = null;
  let bestDist = Infinity;
  for (const [k, vals] of bins) {
    const dist = Math.abs((k + 0.5) * bin - m);
    if (!best || vals.length > best.length || (vals.length === best.length && dist < bestDist)) {
      best = vals;
      bestDist = dist;
    }
  }
  return best && best.length > 1 ? median(best) : m;
}

export function sameType(a: GoalSpec, b: GoalSpec): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'hr_zone' && b.kind === 'hr_zone') return a.zone === b.zone;
  if (a.kind === 'distance' && b.kind === 'distance') return a.suggestedSport === b.suggestedSport;
  return true;
}

function targetOf(g: GoalSpec): number {
  return 'meters' in g ? g.meters : g.seconds;
}

function withTarget(g: GoalSpec, target: number): GoalSpec {
  return 'meters' in g ? { ...g, meters: target } : { ...g, seconds: target };
}

function favouriteSport(recent: Activity[]): DistanceSport {
  const rides = recent.filter((a) => a.sport === 'ride').length;
  const walks = recent.filter((a) => a.sport === 'walk').length;
  return rides > walks ? 'ride' : 'walk';
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step;
}

function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic Fisher–Yates (mulberry32), so a given week always gets the same mix. */
function shuffle<T>(arr: T[], seed: number): void {
  let a = seed;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Swap items so the same goal type doesn't land on back-to-back days, where possible. */
function avoidRepeats<T>(arr: T[]): void {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] !== arr[i - 1]) continue;
    const j = arr.findIndex((x, k) => k > i && x !== arr[i]);
    if (j !== -1) [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
