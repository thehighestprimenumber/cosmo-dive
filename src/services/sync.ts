import type { SQLiteDatabase } from 'expo-sqlite';
import { deleteGoal, insertGoal, lastGoalDate, loadGoals, loadResults, saveResults } from '../data/db';
import { addDays, dateRange, endOfDay, startOfDay, toDateKey } from '../domain/dates';
import { generateGoal, LOOKBACK_DAYS, PLAN_VERSION } from '../domain/generator';
import { activitiesOn, progressOf } from '../domain/progress';
import { computeStreak, type StreakState } from '../domain/streak';
import type { Activity, DateKey, DayResult, DayStatus, GoalSpec, Progress, Settings } from '../domain/types';
import type { ActivitySource } from '../sources/ActivitySource';

/** Days that are always re-checked against Health Connect (late syncs, edits, deletions). */
const RECHECK_DAYS = 35;
/** Never back-fill more than this many days of goals after a long break. */
const BACKFILL_MAX_DAYS = 90;

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
  /** Why today's goal is what it is. */
  todayNotes: string[];
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
 * `regenerateToday` replaces today's goal (e.g. after settings change), and
 * so does a goal made by older rules — but never one you already completed.
 */
export async function refresh(
  db: SQLiteDatabase,
  source: ActivitySource,
  settings: Settings,
  opts: { now?: Date; fullRebuild?: boolean; regenerateToday?: boolean } = {},
): Promise<Snapshot> {
  const today = toDateKey(opts.now ?? new Date());
  const start = settings.startDate;

  const maxKey = (a: DateKey, b: DateKey) => (a > b ? a : b);
  const minKey = (a: DateKey, b: DateKey) => (a < b ? a : b);

  const recheckFrom = opts.fullRebuild ? start : maxKey(start, addDays(today, -RECHECK_DAYS));
  const last = await lastGoalDate(db);
  let generateFrom = maxKey(last ? addDays(last, 1) : start, maxKey(start, addDays(today, -BACKFILL_MAX_DAYS)));

  const goals = new Map((await loadGoals(db, start, today)).map((g) => [g.date, g]));
  const todays = goals.get(today);
  const mayReplaceToday = !!todays && (opts.regenerateToday || todays.planVersion < PLAN_VERSION);

  // Generating a goal needs LOOKBACK_DAYS of history; otherwise only the re-checked days.
  const firstToGenerate = mayReplaceToday ? minKey(generateFrom, today) : generateFrom;
  const fetchFrom =
    firstToGenerate <= today ? addDays(minKey(recheckFrom, firstToGenerate), -LOOKBACK_DAYS) : recheckFrom;
  const activities = await source.getActivities(startOfDay(fetchFrom), endOfDay(today));

  if (todays && mayReplaceToday) {
    const doneAlready = todays.goal
      ? progressOf(todays.goal, activitiesOn(today, activities), settings).done
      : false;
    if (!doneAlready) {
      await deleteGoal(db, today);
      goals.delete(today);
      generateFrom = minKey(generateFrom, today);
    }
  }
  const cached = await loadResults(db, start, addDays(recheckFrom, -1));

  const history: DayResult[] = [];
  const recomputed: DayResult[] = [];

  for (const date of start <= today ? dateRange(start, today) : []) {
    let daily = goals.get(date);
    if (!daily && date >= generateFrom) {
      const statuses = computeStreak(history, date, settings.restDaysPerWeek).statuses;
      daily = generateGoal({ date, settings, activities, history, statuses });
      await insertGoal(db, daily);
      goals.set(date, daily);
    }
    if (!daily) continue;

    if (date < recheckFrom) {
      const c = cached.get(date);
      if (c) history.push({ date, goal: daily.goal, planVersion: daily.planVersion, meta: daily.meta, ...c });
      continue;
    }

    const p = daily.goal ? progressOf(daily.goal, activitiesOn(date, activities), settings) : null;
    const result: DayResult = {
      date,
      goal: daily.goal,
      value: p?.value ?? 0,
      done: p?.done ?? false,
      planVersion: daily.planVersion,
      meta: daily.meta,
    };
    history.push(result);
    recomputed.push(result);
  }

  await saveResults(db, recomputed);

  const streak = computeStreak(history, today, settings.restDaysPerWeek);
  const days = new Map<DateKey, DayView>(
    history.map((h) => [h.date, { ...h, status: streak.statuses.get(h.date) ?? 'none' }]),
  );

  const todayGoal = goals.get(today)?.goal;
  const todayActivities = activitiesOn(today, activities);
  return {
    today,
    todayGoal,
    todayNotes: goals.get(today)?.meta?.notes ?? [],
    todayProgress: todayGoal ? progressOf(todayGoal, todayActivities, settings) : null,
    todayActivities,
    streak,
    days,
    syncedAt: Date.now(),
  };
}
