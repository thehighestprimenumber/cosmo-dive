import type { SQLiteDatabase } from 'expo-sqlite';
import { insertGoal, lastGoalDate, loadGoals, loadResults, saveResults } from '../data/db';
import { addDays, dateRange, endOfDay, startOfDay, toDateKey } from '../domain/dates';
import { generateGoal } from '../domain/generator';
import { activitiesOn, progressOf } from '../domain/progress';
import { computeStreak, type StreakState } from '../domain/streak';
import type { Activity, DateKey, DayResult, DayStatus, GoalSpec, Progress, Settings } from '../domain/types';
import type { ActivitySource } from '../sources/ActivitySource';

/** Days that are always re-checked against Health Connect (late syncs, edits, deletions). */
const RECHECK_DAYS = 35;
/** Never back-fill more than this many days of goals after a long break. */
const BACKFILL_MAX_DAYS = 90;
/** The generator looks back this far. */
const LOOKBACK_DAYS = 28;

export type DayView = {
  date: DateKey;
  goal: GoalSpec | null;
  value: number;
  done: boolean;
  status: DayStatus;
};

export type Snapshot = {
  today: DateKey;
  todayGoal: GoalSpec | null | undefined;
  todayProgress: Progress | null;
  todayActivities: Activity[];
  streak: StreakState;
  days: Map<DateKey, DayView>;
  syncedAt: number;
};

/**
 * The one place that talks to both the database and the activity source:
 * 1. creates goals for any days that don't have one yet (oldest first, so each
 *    one only sees the days before it),
 * 2. re-measures recent days against the activities,
 * 3. replays the streak.
 *
 * `fullRebuild` re-measures every day since the plan started.
 */
export async function refresh(
  db: SQLiteDatabase,
  source: ActivitySource,
  settings: Settings,
  opts: { now?: Date; fullRebuild?: boolean } = {},
): Promise<Snapshot> {
  const today = toDateKey(opts.now ?? new Date());
  const start = settings.startDate;

  const maxKey = (a: DateKey, b: DateKey) => (a > b ? a : b);
  const minKey = (a: DateKey, b: DateKey) => (a < b ? a : b);

  const recheckFrom = opts.fullRebuild ? start : maxKey(start, addDays(today, -RECHECK_DAYS));
  const last = await lastGoalDate(db);
  const generateFrom = maxKey(last ? addDays(last, 1) : start, maxKey(start, addDays(today, -BACKFILL_MAX_DAYS)));

  const fetchFrom = addDays(minKey(recheckFrom, generateFrom), -LOOKBACK_DAYS);
  const activities = await source.getActivities(startOfDay(fetchFrom), endOfDay(today));

  const goals = new Map((await loadGoals(db, start, today)).map((g) => [g.date, g]));
  const cached = await loadResults(db, start, addDays(recheckFrom, -1));

  const history: DayResult[] = [];
  const recomputed: DayResult[] = [];

  for (const date of start <= today ? dateRange(start, today) : []) {
    let daily = goals.get(date);
    if (!daily && date >= generateFrom) {
      daily = generateGoal({ date, settings, activities, history });
      await insertGoal(db, daily);
      goals.set(date, daily);
    }
    if (!daily) continue;

    if (date < recheckFrom) {
      const c = cached.get(date);
      if (c) history.push({ date, goal: daily.goal, ...c });
      continue;
    }

    const result: DayResult = daily.goal
      ? (() => {
          const p = progressOf(daily.goal, activitiesOn(date, activities), settings);
          return { date, goal: daily.goal, value: p.value, done: p.done };
        })()
      : { date, goal: null, value: 0, done: false };
    history.push(result);
    recomputed.push(result);
  }

  await saveResults(db, recomputed);

  const streak = computeStreak(history, today);
  const days = new Map<DateKey, DayView>(
    history.map((h) => [h.date, { ...h, status: streak.statuses.get(h.date) ?? 'none' }]),
  );

  const todayGoal = goals.get(today)?.goal;
  const todayActivities = activitiesOn(today, activities);
  return {
    today,
    todayGoal,
    todayProgress: todayGoal ? progressOf(todayGoal, todayActivities, settings) : null,
    todayActivities,
    streak,
    days,
    syncedAt: Date.now(),
  };
}
