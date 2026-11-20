import { aimPerTrainingDay, walkingPace } from './aim';
import { addDays, daysBetween, toDateKey } from './dates';
import { formatKm, formatPace } from './format';
import { baselineFor, isRecoveryWeek, LOOKBACK_DAYS, PLAN_VERSION } from './generator';
import type { Readiness } from './readiness';
import type { Activity, DailyGoal, DateKey, DayResult, GoalSpec, KeySessionKind, Settings } from './types';

const LONG_VS_DAY = 1.3; // a long walk is ~30% more than a training day
const LONG_STEP = 1.1; // +10% after a completed long walk
const LONG_EASE = 0.9; // after two missed long walks in a row
const LONG_LIMITS = [3000, 42_000] as const;
const TAPER = 0.6; // the week before a dated goal
const RECOVERY = 0.8;

const BRISK_SHARE = 0.6; // a brisk walk is ~60% of a training day's distance
const BRISK_LIMITS = [2000, 10_000] as const;
const BRISK_DIST_STEP = 1.05;
const BRISK_PACE_START = 0.92; // 8% faster than your usual pace
const BRISK_PACE_STEP = 0.98; // 2% faster after a completed brisk walk
const BRISK_PACE_FLOOR = 0.8; // never more than 20% faster than usual
const DEFAULT_PACE = 660; // 11:00 min/km when we don't know your pace yet

export type KeySessionInput = {
  date: DateKey;
  kind: KeySessionKind;
  settings: Settings;
  activities: Activity[];
  history: DayResult[];
  readiness?: Readiness;
};

/** The target for a weekly key session, from your latest data and how the last ones went. */
export function generateKeySession(input: KeySessionInput): DailyGoal {
  const { date, kind, settings, activities, history, readiness } = input;
  const from = addDays(date, -LOOKBACK_DAYS);
  const recent = activities.filter((a) => {
    const d = toDateKey(a.start);
    return d >= from && d < date;
  });
  const past = history
    .filter((h) => h.date < date && h.goal?.kind === kind && h.planVersion === PLAN_VERSION && h.meta?.base != null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const [last, before] = past;

  // A training day's distance: your most common day, or what your aim needs.
  const typical = baselineFor({ kind: 'distance', meters: 0, suggestedSport: 'walk' }, recent, settings)?.value ?? 0;
  const aimDay = aimPerTrainingDay('distance', settings, recent) ?? 0;
  const dayRef = Math.max(typical, aimDay) || 4000;

  const notes: string[] = [];
  let spec: GoalSpec;
  let base: number;
  let pace: number | undefined;
  let factor = 1;

  if (kind === 'long_walk') {
    if (last?.meta) {
      base = last.meta.base;
      if (last.done) {
        base *= LONG_STEP;
        notes.push('Up 10%: you did your last long walk.');
      } else if (before && !before.done) {
        base *= LONG_EASE;
        notes.push('A bit shorter after two missed long walks.');
      } else {
        notes.push('Same as last time: do this one and the next goes up 10%.');
      }
    } else {
      const singles = recent.filter((a) => a.sport === 'walk' && (a.distanceM ?? 0) >= 1000).map((a) => a.distanceM!);
      const p75 = singles.length >= 3 ? percentile(singles, 0.75) : 0;
      base = Math.max(p75, dayRef * LONG_VS_DAY);
      notes.push(
        p75 >= dayRef * LONG_VS_DAY
          ? `Starts from your longer walks (a quarter of them are ${formatKm(p75)} or more).`
          : `Starts at 30% more than a training day (${formatKm(dayRef)}).`,
      );
    }

    const ev = settings.event;
    const toEvent = ev ? daysBetween(date, ev.date) : -1;
    if (ev && toEvent >= 7) {
      // Build toward the event, reaching it by the taper week.
      const weeksLeft = Math.max(1, Math.ceil(toEvent / 7) - 1);
      const eventM = ev.km * 1000;
      if (base < eventM) {
        const prev = last?.meta?.base ?? base;
        base = Math.min(eventM, Math.max(base, prev + (eventM - prev) / weeksLeft));
      }
      notes.push(`Building toward ${ev.name} (${ev.km} km on ${ev.date}): ${weeksLeft} week${weeksLeft === 1 ? '' : 's'} to go.`);
    }
    // Before the event, never train longer than the event itself.
    if (ev && toEvent >= 0) base = Math.min(base, ev.km * 1000);
    base = clamp(base, LONG_LIMITS[0], LONG_LIMITS[1]);

    if (ev && toEvent === 0) {
      factor = (ev.km * 1000) / base;
      notes.push(`🎯 ${ev.name} today: ${ev.km} km. You’ve trained for this!`);
    } else if (ev && toEvent > 0 && toEvent < 7) {
      factor = TAPER;
      notes.push(`Taper week before ${ev.name}: an easy long walk to arrive fresh.`);
    } else if (isRecoveryWeek(date, settings.startDate) && !(ev && toEvent >= 0 && toEvent < 21)) {
      factor = RECOVERY;
      notes.push('Recovery week: a shorter long walk on purpose.');
    }
    spec = { kind: 'long_walk', meters: 0 };
  } else {
    const usual = (walkingPace(recent) ?? DEFAULT_PACE / 1000) * 1000;
    if (last?.meta) {
      base = last.meta.base;
      pace = last.meta.pace ?? usual * BRISK_PACE_START;
      if (last.done) {
        base *= BRISK_DIST_STEP;
        pace *= BRISK_PACE_STEP;
        notes.push('A little longer and 2% faster: you did your last brisk walk.');
      } else {
        notes.push('Same as last time: do this one and the next gets a bit faster.');
      }
    } else {
      base = dayRef * BRISK_SHARE;
      pace = usual * BRISK_PACE_START;
      notes.push(
        walkingPace(recent)
          ? `Your usual walking pace is ${formatPace(usual)}; this one is 8% faster.`
          : `Starter pace ${formatPace(pace)}: we’ll learn your real pace from your walks.`,
      );
    }
    pace = Math.max(pace, usual * BRISK_PACE_FLOOR);
    base = clamp(base, BRISK_LIMITS[0], BRISK_LIMITS[1]);
    if (isRecoveryWeek(date, settings.startDate)) {
      factor = RECOVERY;
      notes.push('Recovery week: a shorter brisk walk on purpose.');
    }
    spec = { kind: 'brisk_walk', meters: 0, paceSPerKm: roundTo(pace, 5) };
  }

  if (readiness && readiness.level !== 'unknown') {
    factor *= readiness.factor;
    notes.push(...readiness.notes);
  }
  const meters = clamp(roundTo(base * factor, 100), 1000, LONG_LIMITS[1]);
  const goal: GoalSpec = { ...spec, meters } as GoalSpec;

  return {
    date,
    goal,
    planVersion: PLAN_VERSION,
    meta: {
      base: roundTo(base, 100),
      notes,
      readiness: readiness?.level ?? 'unknown',
      ...(pace != null ? { pace: roundTo(pace, 5) } : {}),
    },
  };
}

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step;
}
