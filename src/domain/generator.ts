import { addDays, daysBetween, mondayOf, toDateKey } from './dates';
import { formatKm, formatMinutes } from './format';
import { measure } from './progress';
import type { Readiness } from './readiness';
import type {
  Activity,
  DailyGoal,
  DateKey,
  DayResult,
  DayStatus,
  GoalKind,
  GoalSpec,
  HrZone,
  Settings,
  Sport,
} from './types';

/**
 * Bump this whenever the rules below change. Stored goals keep the version
 * that created them, so old history never gets silently reinterpreted, and
 * goals from older versions are never used as a starting point.
 */
export const PLAN_VERSION = 3;

/** How far back "your typical day" looks. */
export const LOOKBACK_DAYS = 90;
/** Shorter activities (e.g. auto-detected errands) don't shape your baseline. */
export const MIN_BASELINE_ACTIVITY_S = 15 * 60;

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
};

export function generateGoal({ date, settings, activities, history, statuses, readiness }: GeneratorInput): DailyGoal {
  const windowStart = addDays(date, -LOOKBACK_DAYS);
  const recent = activities.filter((a) => {
    const d = toDateKey(a.start);
    return d >= windowStart && d < date && a.durationS >= MIN_BASELINE_ACTIVITY_S;
  });
  const past = history.filter((h) => h.date < date).sort((a, b) => (a.date < b.date ? 1 : -1));

  const hasHr = recent.some((a) => a.hr.length >= 2);
  const kind = kindForDay(date, hasHr);
  const week = weekIndex(date, settings.startDate);
  const recovery = isRecoveryWeek(date, settings.startDate);

  let spec: GoalSpec;
  if (kind === 'hr_zone') {
    const zone: HrZone = week % 2 === 1 && !recovery ? 3 : 2;
    spec = { kind, zone, seconds: 0 };
  } else if (kind === 'distance') {
    spec = { kind, meters: 0, suggestedSport: favouriteSport(recent) };
  } else {
    spec = { kind, seconds: 0 };
  }
  const notes: string[] = [];
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
  if (typical) notes.push(`Your typical ${typical.label}: ${fmt(typical.value)} (median of ${typical.days} days).`);
  else if (last?.meta) notes.push(`Continues from your last goal of this type (${fmt(last.meta.base)}).`);

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
  if (typical) base = clamp(base, typical.value * FLOOR, typical.value * CEILING);
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
  target = clamp(roundTo(target, STEP[kind]), LIMITS[kind][0], LIMITS[kind][1]);

  return {
    date,
    goal: withTarget(spec, target),
    planVersion: PLAN_VERSION,
    meta: { base: roundTo(base, STEP[kind]), notes, readiness: readiness?.level ?? 'unknown' },
  };
}

/** The weekly mix: the 7 days get a shuffled, balanced spread of goal types. */
export function kindForDay(date: DateKey, hasHr: boolean): GoalKind {
  const monday = mondayOf(date);
  const base: GoalKind[] = hasHr ? ['duration', 'distance', 'hr_zone'] : ['duration', 'distance'];
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
 * Your typical day for a goal type: the median over days you actually did
 * that kind of thing (activities of 15+ minutes only).
 * - distance: walking days (walk km only), or riding days for ride goals
 * - duration: days with any walk or ride
 * - hr_zone: days with heart rate data
 * Needs at least 3 such days.
 */
export function baselineFor(spec: GoalSpec, recent: Activity[], settings: Settings): Typical | null {
  const relevant = recent.filter((a) => {
    if (a.durationS < MIN_BASELINE_ACTIVITY_S) return false;
    if (spec.kind === 'distance') return a.sport === spec.suggestedSport && a.distanceM != null;
    if (spec.kind === 'hr_zone') return a.hr.length >= 2;
    return true;
  });
  const byDay = new Map<DateKey, Activity[]>();
  for (const a of relevant) {
    const d = toDateKey(a.start);
    byDay.set(d, [...(byDay.get(d) ?? []), a]);
  }
  const totals = [...byDay.values()].map((acts) => measure(spec, acts, settings)).filter((v) => v > 0);
  if (totals.length < 3) return null;
  const label =
    spec.kind === 'distance'
      ? spec.suggestedSport === 'walk'
        ? 'walking day'
        : 'riding day (as walking km)'
      : spec.kind === 'duration'
        ? 'active day'
        : `day in Zone ${spec.zone}`;
  return { value: median(totals), days: totals.length, label };
}

function sameType(a: GoalSpec, b: GoalSpec): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'hr_zone' && b.kind === 'hr_zone') return a.zone === b.zone;
  if (a.kind === 'distance' && b.kind === 'distance') return a.suggestedSport === b.suggestedSport;
  return true;
}

function targetOf(g: GoalSpec): number {
  return g.kind === 'distance' ? g.meters : g.seconds;
}

function withTarget(g: GoalSpec, target: number): GoalSpec {
  return g.kind === 'distance' ? { ...g, meters: target } : { ...g, seconds: target };
}

function favouriteSport(recent: Activity[]): Sport {
  const rides = recent.filter((a) => a.sport === 'ride').length;
  return rides > recent.length - rides ? 'ride' : 'walk';
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
