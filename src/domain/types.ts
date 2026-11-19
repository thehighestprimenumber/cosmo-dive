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

/** Stored once per day and never rewritten. `goal: null` is a rest day. */
export type DailyGoal = {
  date: DateKey;
  goal: GoalSpec | null;
  planVersion: number;
};

export type Settings = {
  /** 0 = Sunday … 6 = Saturday. */
  restDays: number[];
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
};

export const DEFAULT_SETTINGS: Omit<Settings, 'startDate'> = {
  restDays: [2, 5], // Tue, Fri
  rideFactor: 3,
  maxHr: 185,
  morningReminder: '08:00',
  eveningReminder: '19:30',
  dataSource: 'health_connect',
  onboarded: false,
  lastCelebrated: null,
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
};

export type DayStatus = 'done' | 'missed' | 'frozen' | 'rest' | 'pending' | 'none';
