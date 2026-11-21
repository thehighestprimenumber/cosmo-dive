import { walkingPace } from './aim';
import { addDays, toDateKey } from './dates';
import { formatKm, formatPace } from './format';
import { LOOKBACK_DAYS, PLAN_VERSION } from './generator';
import type { SessionKind } from './plan';
import type { Readiness } from './readiness';
import type { Activity, DailyGoal, DateKey, DayResult, GoalSpec, Settings } from './types';

const BRISK_PACE_START = 0.92; // 8% faster than your usual pace
const BRISK_PACE_STEP = 0.98; // 2% faster after a completed brisk walk
const BRISK_PACE_FLOOR = 0.8; // never more than 20% faster than usual
const DEFAULT_PACE = 660; // 11:00 min/km when we don't know your pace yet
const MIN_M = 1000;
const MAX_M = 42_000;

export type KeySessionInput = {
  date: DateKey;
  kind: SessionKind;
  settings: Settings;
  activities: Activity[];
  history: DayResult[];
  /** This session's share of the week, in km (from the weekly-volume plan). */
  targetKm: number;
  /** Long walks / trek days: metres to climb in that same outing (event with a climb). */
  ascentM?: number | null;
  /** Light week: no pace push on the brisk walk. */
  light?: boolean;
  /** Why this week has the km it has (shown with the goal). */
  weekNotes?: string[];
  readiness?: Readiness;
};

const LABEL: Record<SessionKind, string> = {
  long_walk: 'This week’s long walk',
  back_to_back: 'Second long walk in a row (back-to-back)',
  trek_day: 'Trek day',
  brisk_walk: 'This week’s brisk walk',
};

/** A key session's target: its share of the week's km; the brisk walk also gets a pace. */
export function generateKeySession(input: KeySessionInput): DailyGoal {
  const { date, kind, settings, activities, history, targetKm, ascentM, light, weekNotes = [], readiness } = input;
  const notes: string[] = [`${LABEL[kind]}: ${formatKm(targetKm * 1000)} of the week’s plan.`, ...weekNotes];
  let factor = 1;
  let pace: number | undefined;
  let spec: GoalSpec;

  if (kind === 'brisk_walk') {
    const from = addDays(date, -LOOKBACK_DAYS);
    const recent = activities.filter((a) => {
      const d = toDateKey(a.start);
      return d >= from && d < date;
    });
    const known = walkingPace(recent);
    const usual = (known ?? DEFAULT_PACE / 1000) * 1000;
    const last = history
      .filter((h) => h.date < date && h.goal?.kind === 'brisk_walk' && h.planVersion === PLAN_VERSION)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (light) {
      pace = last?.meta?.pace ?? usual * BRISK_PACE_START;
      notes.push('Light week: same pace as last time, no push.');
    } else if (last?.meta?.pace) {
      pace = last.done ? last.meta.pace * BRISK_PACE_STEP : last.meta.pace;
      notes.push(last.done ? '2% faster: you did your last brisk walk.' : 'Same pace as last time until you make it.');
    } else {
      pace = usual * BRISK_PACE_START;
      notes.push(
        known
          ? `Your usual walking pace is ${formatPace(usual)}; this one is 8% faster.`
          : `Starter pace ${formatPace(pace)}: we’ll learn your real pace from your walks.`,
      );
    }
    pace = Math.max(pace, usual * BRISK_PACE_FLOOR);
    spec = { kind: 'brisk_walk', meters: 0, paceSPerKm: roundTo(pace, 5) };
  } else {
    spec = { kind: 'long_walk', meters: 0 };
    if (kind === 'trek_day') notes.unshift(`🏔️ ${settings.event?.name ?? 'Your trek'}: enjoy it, you trained for this!`);
    if (ascentM) {
      notes.push(
        kind === 'trek_day'
          ? `⛰️ ${ascentM} m of climbing today.`
          : `⛰️ Climb ${ascentM} m in the same walk: hills toward the trek’s ${settings.event?.ascentM} m a day.`,
      );
    }
  }

  // Trek days are the real thing: no readiness tweak.
  if (readiness && readiness.level !== 'unknown' && kind !== 'trek_day') {
    factor *= readiness.factor;
    notes.push(...readiness.notes);
  }
  const meters = Math.min(MAX_M, Math.max(MIN_M, roundTo(targetKm * 1000 * factor, 100)));
  const climb = ascentM && spec.kind === 'long_walk' ? roundTo(ascentM * factor, 10) : 0;
  const goal = { ...spec, meters, ...(climb ? { ascentM: climb } : {}) } as GoalSpec;

  return {
    date,
    goal,
    planVersion: PLAN_VERSION,
    meta: {
      base: roundTo(targetKm * 1000, 100),
      notes,
      readiness: readiness?.level ?? 'unknown',
      ...(pace != null ? { pace: roundTo(pace, 5) } : {}),
    },
  };
}

function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step;
}
