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
import { isAerobicPhase, WEEKLY_ZONE2_SHARE, zone2Minutes } from '../domain/aerobic';
import { withAllDayWalking } from '../domain/allday';
import { cycleInfo, isPeriodWeek, nextPeriod, type Period } from '../domain/cycle';
import { hasElevationData, longWalkClimb, typicalClimbPerKm } from '../domain/elevation';
import {
  dropSession,
  forwardMissed,
  freeDays,
  goalKindOf,
  isMovable,
  moveSession,
  nextWeekVisible,
  normalizePlan,
  planWeek,
  sessionOn,
  type KeySession,
  type WeekPlan,
} from '../domain/plan';
import { planVolume, rebalancedDayKm, typicalWeekKm, weekKm, weekSplit, type WeekVolume } from '../domain/volume';
import { generateKeySession } from '../domain/sessions';
import { withCoachFactor } from '../domain/coach';
import { aimSuggestion, dailyAverageKm, walkingPace } from '../domain/aim';
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
import { addDays, dateRange, daysBetween, endOfDay, mondayOf, startOfDay, toDateKey } from '../domain/dates';
import { baselineFor, generateGoal, LOOKBACK_DAYS, PLAN_VERSION } from '../domain/generator';
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
  /** This week's km: planned, done, left, last week's, and each session's share. */
  week: {
    volume: WeekVolume;
    split: ReturnType<typeof weekSplit>;
    doneKm: number;
    leftKm: number;
    lastWeekKm: number;
    /** The 4 weeks before this one, oldest first. */
    recentWeeksKm: number[];
    /** Zone 2 minutes this week vs. ~35% of the week's walking time; `aerobic` = altitude base phase. */
    zone2: { minutes: number; targetMin: number; aerobic: boolean };
    /** Metres climbed this week, and whether your walks come with elevation at all. */
    climbM: number;
    elevationKnown: boolean;
  };
  /** Your cycle, if known (period records or "started today" taps). */
  cycle: { cycleDays: number; source: 'history' | 'settings'; next: Period | null } | null;
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
  const sessions = await source.getActivities(startOfDay(fetchFrom), endOfDay(today));
  // Add each day's distance outside recorded workouts (what Samsung shows as "distance while active").
  const dailyDistance = source.getDailyDistance
    ? await source.getDailyDistance(startOfDay(fetchFrom), endOfDay(today)).catch(() => ({}))
    : {};
  const activities = withAllDayWalking(sessions, dailyDistance);

  const doneOn = (d: DateKey) => {
    const g = goals.get(d)?.goal;
    return !!g && progressOf(g, activitiesOn(d, activities), settings).done;
  };
  const rf = settings.rideFactor;

  // Your cycle (optional): known and predicted periods place the light week.
  const periodRecords = source.getPeriods
    ? await source.getPeriods(startOfDay(addDays(today, -400)), endOfDay(today)).catch(() => [] as Period[])
    : [];
  const cycle = cycleInfo(periodRecords, settings.periodStarts, settings.cycleDays);

  // The weekly-volume plan: how many km a week, from your recent weeks toward your goal.
  const startKm = () => {
    const typical = typicalWeekKm(activities, today, rf);
    if (typical != null) return typical;
    const day = baselineFor({ kind: 'distance', meters: 0, suggestedSport: 'walk' }, activities, settings);
    return ((day?.value ?? 3000) / 1000) * Math.max(1, 7 - settings.restDaysPerWeek);
  };
  const volumeFor = async (monday: DateKey, provisional: boolean): Promise<WeekVolume> => {
    const prevPlan = await loadWeekPlan(db, addDays(monday, -7));
    const prev = prevPlan?.volume
      ? { volume: prevPlan.volume, actualKm: weekKm(activities, addDays(monday, -7), rf) }
      : null;
    const v = planVolume({
      monday,
      settings,
      startKm: startKm(),
      prev,
      periodWeek: cycle ? isPeriodWeek(monday, cycle) : null,
    });
    return { ...v, v: PLAN_VERSION, ...(provisional ? { provisional: true } : {}) };
  };
  // A week change you accepted from the coach survives the week's km being recomputed.
  const coached = async (monday: DateKey, provisional: boolean, factor?: number) =>
    withCoachFactor(await volumeFor(monday, provisional), factor);
  const trekDaysIn = (monday: DateKey): DateKey[] => {
    const ev = settings.event;
    if (!ev) return [];
    return Array.from({ length: ev.days ?? 1 }, (_, i) => addDays(ev.date, i)).filter(
      (d) => mondayOf(d) === monday,
    );
  };
  const makePlan = async (monday: DateKey, firstDay: DateKey, provisional: boolean): Promise<WeekPlan> => {
    const volume = await volumeFor(monday, provisional);
    const p = planWeek(monday, firstDay, activities, settings, {
      backToBack: volume.backToBack,
      trekDays: trekDaysIn(monday).filter((d) => d >= firstDay),
    });
    return { ...p, volume };
  };

  if (plan) plan = normalizePlan(plan);
  if (!plan) {
    plan = await makePlan(thisMonday, maxKey(today, start), false);
    await saveWeekPlan(db, plan);
  } else if (!plan.volume || plan.volume.provisional || plan.volume.v !== PLAN_VERSION || opts.regenerateToday) {
    // Plans from before weekly volumes, plans made on Sunday for this week, or
    // a changed aim / event: (re)compute this week's km, keeping the days you arranged.
    plan = { ...plan, volume: await coached(thisMonday, false, plan.coach?.factor) };
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
  if (opts.todayKind && todaysSession && isMovable(todaysSession)) {
    const to = freeDays(plan, today, true, todaysSession.id)[0];
    plan = to ? moveSession(plan, todaysSession.id, to, today, true) : dropSession(plan, todaysSession.id);
    await saveWeekPlan(db, plan);
  }
  // Next week's plan from Sunday evening, so you can arrange it before Monday.
  const nextMonday = addDays(thisMonday, 7);
  let nextPlan = await loadWeekPlan(db, nextMonday);
  if (nextPlan) nextPlan = normalizePlan(nextPlan);
  if (!nextPlan && nextWeekVisible(now)) {
    nextPlan = await makePlan(nextMonday, nextMonday, true);
    await saveWeekPlan(db, nextPlan);
  }

  // Each session's km for a plan's week.
  const splitOf = (p: WeekPlan) => {
    const live = p.sessions.filter((x) => !x.dropped);
    return weekSplit(
      p.volume!,
      settings.restDaysPerWeek,
      {
        long: live.some((x) => x.kind === 'long_walk'),
        brisk: live.some((x) => x.kind === 'brisk_walk'),
        backToBack: live.some((x) => x.kind === 'back_to_back'),
        trekDays: live.filter((x) => x.kind === 'trek_day').length,
      },
      settings.event,
    );
  };
  // Climb targets only when your watch's walks come with elevation (otherwise they couldn't be met).
  const elevationKnown = hasElevationData(activities);
  const usualClimb = typicalClimbPerKm(activities);
  const keyClimb = (x: KeySession, km: number): number | null => {
    if (!elevationKnown || !settings.event?.ascentM || x.kind === 'brisk_walk') return null;
    return x.kind === 'trek_day' ? settings.event.ascentM : longWalkClimb(km, settings.event, usualClimb);
  };
  const keyKm = (x: KeySession, split: ReturnType<typeof splitOf>) =>
    x.kind === 'long_walk'
      ? split.longKm
      : x.kind === 'brisk_walk'
        ? split.briskKm
        : x.kind === 'back_to_back'
          ? split.b2bKm
          : split.trekKm;

  // Today's goal must match the plan: a key session if one is on today, a regular goal otherwise.
  const todaysKey = sessionOn(plan, today);
  const wantKey = todaysKey ? goalKindOf(todaysKey.kind) : undefined;
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
      const streakSoFar = computeStreak(history, date, settings.restDaysPerWeek);
      const statuses = streakSoFar.statuses;
      const readiness = source.getNights ? readinessFor(date, nights) : undefined;
      const kind = date === today ? opts.todayKind : undefined;
      const dayPlan = date >= thisMonday ? plan : await loadWeekPlan(db, mondayOf(date));
      const key = sessionOn(dayPlan, date);
      const volume = dayPlan?.volume;
      if (dayPlan && volume) {
        const split = splitOf(dayPlan);
        const monday = dayPlan.week;
        if (key) {
          daily = generateKeySession({
            date,
            kind: key.kind,
            settings,
            activities,
            history,
            readiness,
            targetKm: keyKm(key, split),
            ascentM: keyClimb(key, keyKm(key, split)),
            light: !!volume.light,
            weekNotes: volume.notes,
          });
        } else {
          // Mid-week rebalancing: what's left of the week over the days left.
          const doneKm = weekKm(activities, monday, rf, addDays(date, -1));
          const keyAhead = dayPlan.sessions.filter((x) => !x.dropped && x.day >= date);
          const dayKm = rebalancedDayKm({
            plannedDayKm: split.regularDayKm,
            weekKm: volume.km,
            doneKm,
            keyKmLeft: keyAhead.reduce((t, x) => t + keyKm(x, split), 0),
            daysLeft: daysBetween(date, addDays(monday, 6)) + 1,
            keyDaysLeft: keyAhead.length,
            restLeft: streakSoFar.restLeftThisWeek,
          });
          const planNotes = [
            `This week: ${volume.km} km (${Math.round(doneKm * 10) / 10} done so far). Today’s share: ${dayKm} km.`,
            ...volume.notes,
          ];
          daily = generateGoal({
            date,
            settings,
            activities,
            history,
            statuses,
            readiness,
            kind,
            dayKm,
            planNotes,
            light: !!volume.light,
            aerobic: isAerobicPhase(date, settings.event),
          });
        }
      } else {
        daily = key
          ? generateKeySession({ date, kind: key.kind, settings, activities, history, readiness, targetKm: 5 })
          : generateGoal({ date, settings, activities, history, statuses, readiness, kind });
      }
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
    week: (() => {
      const doneKm = weekKm(activities, thisMonday, rf, today);
      const volume = plan.volume!;
      return {
        volume,
        split: splitOf(plan),
        doneKm: Math.round(doneKm * 10) / 10,
        leftKm: Math.max(0, Math.round((volume.km - doneKm) * 10) / 10),
        lastWeekKm: Math.round(weekKm(activities, addDays(thisMonday, -7), rf) * 10) / 10,
        recentWeeksKm: [4, 3, 2, 1].map((w) => Math.round(weekKm(activities, addDays(thisMonday, -7 * w), rf) * 10) / 10),
        zone2: (() => {
          const aerobic = isAerobicPhase(today, settings.event);
          const pace = walkingPace(activities) ?? 0.72;
          return {
            minutes: zone2Minutes(activities, thisMonday, today, settings.maxHr),
            targetMin: Math.round((volume.km * 1000 * pace * WEEKLY_ZONE2_SHARE) / 60),
            aerobic,
          };
        })(),
        climbM: Math.round(
          activities
            .filter((a) => toDateKey(a.start) >= thisMonday && toDateKey(a.start) <= today)
            .reduce((t, a) => t + (a.ascentM ?? 0), 0),
        ),
        elevationKnown,
      };
    })(),
    cycle: cycle
      ? { cycleDays: cycle.cycleDays, source: cycle.source, next: nextPeriod(cycle, today) }
      : null,
    forwarded: forwarded.moved,
    previews: Object.fromEntries(
      [...plan.sessions, ...(nextPlan?.sessions ?? [])]
        .filter((x) => x.day > today && !x.dropped)
        .map((x) => [
          x.day,
          generateKeySession({
            date: x.day,
            kind: x.kind,
            settings,
            activities,
            history,
            targetKm: keyKm(x, splitOf(x.day >= nextMonday && nextPlan ? nextPlan : plan)),
            ascentM: keyClimb(x, keyKm(x, splitOf(x.day >= nextMonday && nextPlan ? nextPlan : plan))),
          }).goal,
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
