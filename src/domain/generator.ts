import { addDays, daysBetween, mondayOf, toDateKey, weekday } from './dates';
import { measure } from './progress';
import type {
  Activity,
  DailyGoal,
  DateKey,
  DayResult,
  GoalKind,
  GoalSpec,
  HrZone,
  Settings,
  Sport,
} from './types';

/**
 * Bump this whenever the rules below change. Stored goals keep the version
 * that created them, so old history never gets silently reinterpreted.
 */
export const PLAN_VERSION = 2;

const LOOKBACK_DAYS = 28;
/** Shorter activities (e.g. auto-detected errands) don't shape your baseline. */
const MIN_BASELINE_ACTIVITY_S = 10 * 60;
const PROGRESS_UP = 1.07; // doing well on this goal type (max once a week per type)
const EASE_OFF = 0.85; // missed the last two training days
const RECOVERY = 0.75; // every 4th week is easier

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

/** Distances round to 0.1 km; times to 1 minute (coarser steps would swallow a 7% bump). */
const STEP = { distance: 100, duration: 60, hr_zone: 60 } as const;

export type GeneratorInput = {
  date: DateKey;
  settings: Settings;
  /** Activities covering at least the 28 days before `date`. Later ones are ignored. */
  activities: Activity[];
  /** Results of earlier days. Days on/after `date` are ignored. */
  history: DayResult[];
};

export function generateGoal({ date, settings, activities, history }: GeneratorInput): DailyGoal {
  const make = (goal: GoalSpec | null): DailyGoal => ({ date, goal, planVersion: PLAN_VERSION });

  if (settings.restDays.includes(weekday(date))) return make(null);

  const windowStart = addDays(date, -LOOKBACK_DAYS);
  const recent = activities.filter((a) => {
    const d = toDateKey(a.start);
    return d >= windowStart && d < date;
  });
  const past = history.filter((h) => h.date < date).sort((a, b) => (a.date < b.date ? 1 : -1));

  const hasHr = recent.some((a) => a.hr.length >= 2);
  const kind = kindForDay(date, settings, hasHr);
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

  // 1. Where we are: the last target of this exact goal type, or what you actually do.
  const baseline = dailyBaseline(spec, recent, settings);
  const last = past.find((h) => h.goal && sameType(h.goal, spec));
  let target: number;
  if (last?.goal) {
    target = targetOf(last.goal);
    if (isRecoveryWeek(last.date, settings.startDate)) target /= RECOVERY;
  } else {
    target = baseline ?? DEFAULTS[kind];
  }

  // 2. Adjust for how it has been going.
  const training = past.filter((h) => h.goal);
  const missedTwo = training.length >= 2 && !training[0].done && !training[1].done;
  const sameKind = training.filter((h) => sameType(h.goal!, spec)).slice(0, 3);
  if (missedTwo) target *= EASE_OFF;
  else if (
    sameKind.length >= 2 &&
    sameKind.every((h) => h.done) &&
    // At most one step up per goal type per week.
    weekIndex(sameKind[0].date, settings.startDate) < week
  ) {
    target *= PROGRESS_UP;
  }

  // 3. Stay realistic relative to what you really do.
  if (baseline != null) target = clamp(target, baseline * 0.5, baseline * 1.6);
  if (recovery) target *= RECOVERY;
  target = clamp(roundTo(target, STEP[kind]), LIMITS[kind][0], LIMITS[kind][1]);

  // 4. Your own floor always wins, even in a recovery week.
  if (kind === 'distance') target = Math.max(target, settings.minDistanceKm * 1000);

  return make(withTarget(spec, target));
}

/** The weekly mix: training days get a shuffled spread of goal types. */
export function kindForDay(date: DateKey, settings: Settings, hasHr: boolean): GoalKind {
  const monday = mondayOf(date);
  const trainingDays: DateKey[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (!settings.restDays.includes(weekday(d))) trainingDays.push(d);
  }
  const base: GoalKind[] = hasHr ? ['duration', 'distance', 'hr_zone'] : ['duration', 'distance'];
  const kinds = Array.from({ length: trainingDays.length }, (_, i) => base[i % base.length]);
  shuffle(kinds, seedFrom(monday));
  avoidRepeats(kinds);
  return kinds[trainingDays.indexOf(date)];
}

export function weekIndex(date: DateKey, startDate: DateKey): number {
  return Math.floor(daysBetween(mondayOf(startDate), date) / 7);
}

export function isRecoveryWeek(date: DateKey, startDate: DateKey): boolean {
  return weekIndex(date, startDate) % 4 === 3;
}

function sameType(a: GoalSpec, b: GoalSpec): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'hr_zone' && b.kind === 'hr_zone') return a.zone === b.zone;
  return true;
}

function targetOf(g: GoalSpec): number {
  return g.kind === 'distance' ? g.meters : g.seconds;
}

function withTarget(g: GoalSpec, target: number): GoalSpec {
  return g.kind === 'distance' ? { ...g, meters: target } : { ...g, seconds: target };
}

/** Median daily total for this goal type over active days, or null if too little data. */
function dailyBaseline(spec: GoalSpec, recent: Activity[], settings: Settings): number | null {
  const byDay = new Map<DateKey, Activity[]>();
  for (const a of recent) {
    if (a.durationS < MIN_BASELINE_ACTIVITY_S) continue;
    if (spec.kind === 'hr_zone' && a.hr.length < 2) continue;
    const d = toDateKey(a.start);
    byDay.set(d, [...(byDay.get(d) ?? []), a]);
  }
  const totals = [...byDay.values()].map((acts) => measure(spec, acts, settings)).filter((v) => v > 0);
  if (totals.length < 3) return null;
  return median(totals);
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

/** Swap items so the same goal type doesn't land on back-to-back training days, where possible. */
function avoidRepeats<T>(arr: T[]): void {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] !== arr[i - 1]) continue;
    const j = arr.findIndex((x, k) => k > i && x !== arr[i]);
    if (j !== -1) [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
