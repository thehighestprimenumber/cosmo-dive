import type { SQLiteDatabase } from 'expo-sqlite';
import {
  deleteGoal,
  insertGoal,
  lastGoalDate,
  loadGoals,
  loadResults,
  loadWeekPlan,
  saveResults,
  saveSettings,
  saveWeekPlan,
} from '../data/db';
import {
  forwardMissed,
  freeDays,
  moveSession,
  nextWeekVisible,
  planWeek,
  sessionOn,
  type KeySession,
  type WeekPlan,
} from '../domain/plan';
import { generateKeySession } from '../domain/sessions';
import { aimSuggestion, dailyAverageKm } from '../domain/aim';
import {
  aimMonthTarget,
  earnedAchievements,
  levelFor,
  monthKm,
  monthOf,
  monthTarget,
  totalXp,
  type AchievementId,
} from '../domain/game';
import { addDays, dateRange, endOfDay, mondayOf, startOfDay, toDateKey } from '../domain/dates';
import { generateGoal, LOOKBACK_DAYS, PLAN_VERSION } from '../domain/generator';
import { activitiesOn, progressOf } from '../domain/progress';
import { usualStartTime, type TimeOfDay } from '../domain/habits';
import { readinessFor, type Night, type ReadinessLevel } from '../domain/readiness';
import { computeStreak, type StreakState } from '../domain/streak';
import type { Activity, DateKey, DayResult, DayStatus, GoalMeta, GoalSpec, Progress, RegularKind, Settings } from '../domain/types';
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
  meta?: GoalMeta;
};

export type Snapshot = {
  today: DateKey;
  todayGoal: GoalSpec | null | undefined;
  /** Why today's goal is what it is. */
  todayNotes: string[];
  todayReadiness: ReadinessLevel;
  /** When you usually start moving, learned from the last 4 weeks. */
  usualTime: TimeOfDay | null;
  todayBoss: boolean;
  /** This week's key sessions, and next week's from Sunday evening. */
  plan: WeekPlan;
  nextPlan: WeekPlan | null;
  /** Key sessions this sync moved forward because their day passed. */
  forwarded: KeySession[];
  /** Estimated targets for upcoming key sessions (final targets are set on the day). */
  previews: Record<DateKey, GoalSpec | null>;
  /** Your aim (km/day on average) and your actual average over the last 14 days. */
  aim: { km: number; averageKm: number; suggestion: number | null } | null;
  game: {
    xp: number;
    level: number;
    /** XP into the current level, and XP the level spans. */
    into: number;
    needed: number;
    month: string;
    monthKm: number;
    monthTarget: number;
    achievements: Record<string, DateKey>;
    /** Achievements unlocked by this sync. */
    newlyUnlocked: AchievementId[];
  };
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
  opts: { now?: Date; fullRebuild?: boolean; regenerateToday?: boolean; todayKind?: RegularKind } = {},
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

  // Sleep for readiness: needed when making goals, or to redo today's goal once
  // last night's sleep has synced (it was made before you woke up).
  const waitingForSleep = todays?.meta?.readiness === 'unknown';
  const nightsFrom = addDays(minKey(generateFrom, today), -16);
  const nights =
    source.getNights && (generateFrom <= today || waitingForSleep)
      ? await source.getNights(startOfDay(nightsFrom), endOfDay(today)).catch(() => [] as Night[])
      : [];
  const sleepArrived = waitingForSleep && nights.some((n) => n.date === today);

  const mayReplaceToday =
    !!todays && (opts.regenerateToday || todays.planVersion < PLAN_VERSION || sleepArrived);

  // Weekly plan (key sessions). Making one needs the same history as making goals.
  const now = opts.now ?? new Date();
  const thisMonday = mondayOf(today);
  let plan = await loadWeekPlan(db, thisMonday);

  // Generating a goal needs LOOKBACK_DAYS of history; otherwise only the re-checked days.
  const firstToGenerate = mayReplaceToday || !plan ? minKey(generateFrom, today) : generateFrom;
  const fetchFrom =
    firstToGenerate <= today ? addDays(minKey(recheckFrom, firstToGenerate), -LOOKBACK_DAYS) : recheckFrom;
  const activities = await source.getActivities(startOfDay(fetchFrom), endOfDay(today));

  const doneOn = (d: DateKey) => {
    const g = goals.get(d)?.goal;
    return !!g && progressOf(g, activitiesOn(d, activities), settings).done;
  };
  if (!plan) {
    plan = planWeek(thisMonday, maxKey(today, start), activities, settings);
    await saveWeekPlan(db, plan);
  }
  // Missed key sessions slide to the next free day this week.
  const forwarded = forwardMissed(plan, today, doneOn);
  if (forwarded.moved.length || forwarded.plan !== plan) {
    plan = forwarded.plan;
    await saveWeekPlan(db, plan);
  }
  // You picked another goal type for today: today's key session moves on.
  const todaysSession = sessionOn(plan, today);
  if (opts.todayKind && todaysSession) {
    const to = freeDays(plan, today, true, todaysSession.kind)[0];
    plan = to
      ? moveSession(plan, todaysSession.kind, to, today, true)
      : {
          ...plan,
          sessions: plan.sessions.map((x) => (x.kind === todaysSession.kind ? { ...x, dropped: true } : x)),
        };
    await saveWeekPlan(db, plan);
  }
  // Next week's plan from Sunday evening, so you can arrange it before Monday.
  const nextMonday = addDays(thisMonday, 7);
  let nextPlan = await loadWeekPlan(db, nextMonday);
  if (!nextPlan && nextWeekVisible(now)) {
    nextPlan = planWeek(nextMonday, nextMonday, activities, settings);
    await saveWeekPlan(db, nextPlan);
  }

  // Today's goal must match the plan: a key session if one is on today, a regular goal otherwise.
  const wantKey = sessionOn(plan, today)?.kind;
  const haveKind = todays?.goal?.kind;
  const isKey = (k?: string) => k === 'long_walk' || k === 'brisk_walk';
  const planMismatch = !!todays && (wantKey ? haveKind !== wantKey : isKey(haveKind));

  if (todays && (mayReplaceToday || planMismatch)) {
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
      const readiness = source.getNights ? readinessFor(date, nights) : undefined;
      const kind = date === today ? opts.todayKind : undefined;
      const dayPlan = date >= thisMonday ? plan : await loadWeekPlan(db, mondayOf(date));
      const key = sessionOn(dayPlan, date)?.kind;
      daily = key
        ? generateKeySession({ date, kind: key, settings, activities, history, readiness })
        : generateGoal({ date, settings, activities, history, statuses, readiness, kind });
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

  // Game: XP and level, this month's challenge, achievements (unlocks are stored).
  const xp = totalXp(history, streak.statuses, settings.restDaysPerWeek);
  const lvl = levelFor(xp);
  const month = monthOf(today);
  const kmThisMonth = monthKm(activities, month, settings.rideFactor);
  let target = settings.monthTargets[month];
  const settingsPatch: Partial<Settings> = {};
  if (target == null) target = monthTarget(month, activities, fetchFrom, settings.rideFactor);
  // An aim of N km a day means at least N × days this month.
  if (settings.dailyTargetKm) target = Math.max(target, aimMonthTarget(month, settings.dailyTargetKm));
  if (target !== settings.monthTargets[month]) {
    settingsPatch.monthTargets = { ...settings.monthTargets, [month]: target };
  }
  const avg14 = dailyAverageKm(activities, today, settings.rideFactor);
  const earned = earnedAchievements({
    aimReached: !!settings.dailyTargetKm && avg14 >= settings.dailyTargetKm,
    days: history,
    statuses: streak.statuses,
    longestStreak: streak.longest,
    restDaysPerWeek: settings.restDaysPerWeek,
    level: lvl.level,
    monthKm: kmThisMonth,
    monthTarget: target,
  });
  const newlyUnlocked = earned.filter((id) => !settings.achievements[id]);
  if (newlyUnlocked.length) {
    settingsPatch.achievements = {
      ...settings.achievements,
      ...Object.fromEntries(newlyUnlocked.map((id) => [id, today])),
    };
  }
  if (Object.keys(settingsPatch).length) {
    await saveSettings(db, settingsPatch);
    Object.assign(settings, settingsPatch);
  }

  const todayGoal = goals.get(today)?.goal;
  const todayActivities = activitiesOn(today, activities);
  return {
    game: {
      xp,
      ...lvl,
      month,
      monthKm: kmThisMonth,
      monthTarget: target,
      achievements: settings.achievements,
      newlyUnlocked,
    },
    todayBoss: !!goals.get(today)?.meta?.boss,
    plan,
    nextPlan,
    forwarded: forwarded.moved,
    previews: Object.fromEntries(
      [...plan.sessions, ...(nextPlan?.sessions ?? [])]
        .filter((x) => x.day > today && !x.dropped)
        .map((x) => [
          x.day,
          generateKeySession({ date: x.day, kind: x.kind, settings, activities, history }).goal,
        ]),
    ),
    aim: settings.dailyTargetKm
      ? {
          km: settings.dailyTargetKm,
          averageKm: avg14,
          suggestion: aimSuggestion(settings.dailyTargetKm, avg14, today, settings.aimSnoozedUntil),
        }
      : null,
    today,
    todayGoal,
    todayNotes: goals.get(today)?.meta?.notes ?? [],
    todayReadiness: goals.get(today)?.meta?.readiness ?? 'unknown',
    usualTime: usualStartTime(activities, today),
    todayProgress: todayGoal ? progressOf(todayGoal, todayActivities, settings) : null,
    todayActivities,
    streak,
    days,
    syncedAt: Date.now(),
  };
}
