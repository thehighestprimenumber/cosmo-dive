/** A local calendar date, formatted "YYYY-MM-DD". */
export type DateKey = string;

export type Sport = 'walk' | 'ride';

export type HrSample = {
  /** Epoch milliseconds. */
  t: number;
  bpm: number;
};

/** One walk or ride, normalised from whatever source recorded it. */
export type Activity = {
  id: string;
  sport: Sport;
  /** Epoch milliseconds. */
  start: number;
  end: number;
  durationS: number;
  /** null when the source has no distance (e.g. stationary bike). */
  distanceM: number | null;
  /** Heart rate samples recorded during the activity (may be empty). */
  hr: HrSample[];
  /** Which app wrote it (e.g. "com.sec.android.app.shealth"). */
  origin: string;
};

export type HrZone = 1 | 2 | 3 | 4 | 5;

/**
 * What a day asks of you. Add a new goal type by adding a variant here
 * plus a case in `measure()` (progress.ts) and the generator.
 */
export type GoalSpec =
  /** Distance in walk-equivalent metres (ride metres are divided by the ride factor). */
  | { kind: 'distance'; meters: number; suggestedSport: Sport }
  | { kind: 'duration'; seconds: number }
  | { kind: 'hr_zone'; zone: HrZone; seconds: number };

export type GoalKind = GoalSpec['kind'];

/** Why a goal is what it is, stored with it. */
export type GoalMeta = {
  /**
   * The progression level before day-specific tweaks (recovery week, a big
   * day yesterday, readiness…), so those tweaks never compound.
   */
  base: number;
  /** Human-readable reasons, shown under the goal. */
  notes: string[];
};

/**
 * Stored once per day and never rewritten (except today's, see sync.ts).
 * `goal: null` only appears in history from v1–v2 plans, which had fixed rest days.
 */
export type DailyGoal = {
  date: DateKey;
  goal: GoalSpec | null;
  planVersion: number;
  meta?: GoalMeta;
};

export type Settings = {
  /**
   * Rest days are flexible: any day you don't hit the goal uses one of these,
   * per Monday–Sunday week. Only days beyond them break the streak.
   */
  restDaysPerWeek: number;
  /** How many ride metres count as one walk metre for distance goals. */
  rideFactor: number;
  maxHr: number;
  /** "HH:MM" local time. */
  morningReminder: string;
  eveningReminder: string;
  /** First day of the plan. */
  startDate: DateKey;
  dataSource: 'health_connect' | 'demo';
  onboarded: boolean;
  /** Last day whose completed goal was already celebrated (so we notify once). */
  lastCelebrated: DateKey | null;
  /** Epoch ms of the last successful background sync (shown in Diagnostics). */
  lastBackgroundSync: number | null;
};

export const DEFAULT_SETTINGS: Omit<Settings, 'startDate'> = {
  restDaysPerWeek: 2,
  rideFactor: 3,
  maxHr: 185,
  morningReminder: '08:00',
  eveningReminder: '19:30',
  dataSource: 'health_connect',
  onboarded: false,
  lastCelebrated: null,
  lastBackgroundSync: null,
};

export type Progress = {
  value: number;
  target: number;
  fraction: number;
  done: boolean;
};

/** A day's goal plus how much of it was achieved. */
export type DayResult = {
  date: DateKey;
  goal: GoalSpec | null;
  value: number;
  done: boolean;
  planVersion?: number;
  meta?: GoalMeta;
};

/** `rest`: a day without the goal met that used one of the week's flexible rest days. */
export type DayStatus = 'done' | 'missed' | 'frozen' | 'rest' | 'pending' | 'none';
