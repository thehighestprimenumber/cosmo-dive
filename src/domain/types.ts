/** A local calendar date, formatted "YYYY-MM-DD". */
export type DateKey = string;

/**
 * walk: walking, hiking, running (distance counts 1:1)
 * ride: cycling (distance counts 1/rideFactor)
 * other: everything else (kayak, swimming, gym…): counts for time and heart
 * rate goals, not for distance.
 */
export type Sport = 'walk' | 'ride' | 'other';
/** Sports with a distance that compares to walking. */
export type DistanceSport = 'walk' | 'ride';

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
  /** Exercise type as recorded, e.g. "paddling". */
  label?: string;
  /** Metres climbed during it, when the watch/app records elevation. */
  ascentM?: number | null;
  /** Not a recorded workout: the rest of the day's distance (see allday.ts). */
  synthetic?: boolean;
};

export type HrZone = 1 | 2 | 3 | 4 | 5;

/**
 * What a day asks of you. Add a new goal type by adding a variant here
 * plus a case in `measure()` (progress.ts) and the generator.
 */
export type GoalSpec =
  /** Distance in walk-equivalent metres (ride metres are divided by the ride factor). */
  | { kind: 'distance'; meters: number; suggestedSport: DistanceSport }
  | { kind: 'duration'; seconds: number }
  | { kind: 'hr_zone'; zone: HrZone; seconds: number }
  /** Key session: one walk (or hike/run) of at least this distance, and this much climb if set. */
  | { kind: 'long_walk'; meters: number; ascentM?: number }
  /** Key session: walking distance at this pace or faster (seconds per km). */
  | { kind: 'brisk_walk'; meters: number; paceSPerKm: number };

export type GoalKind = GoalSpec['kind'];
/** The everyday goal types (any sport for time and heart rate). */
export type RegularKind = 'distance' | 'duration' | 'hr_zone';
/** The weekly plan's key sessions. */
export type KeySessionKind = 'long_walk' | 'brisk_walk';
export type RegularGoalSpec = Extract<GoalSpec, { kind: RegularKind }>;

/** Why a goal is what it is, stored with it. */
export type GoalMeta = {
  /**
   * The progression level before day-specific tweaks (recovery week, a big
   * day yesterday, readiness…), so those tweaks never compound.
   */
  base: number;
  /** Human-readable reasons, shown under the goal. */
  notes: string[];
  /**
   * Readiness when the goal was made. 'unknown' (e.g. made at 1 am, before
   * you woke up) lets today's goal be redone once last night's sleep is in.
   */
  readiness?: 'low' | 'normal' | 'high' | 'unknown';
  /** A weekly boss day: harder, worth more XP. */
  boss?: boolean;
  /** The day after a very big day: resting is fine and doesn't use a rest day. */
  recovery?: boolean;
  /** Brisk walk: the pace level (s/km) before today-only tweaks. */
  pace?: number;
};

/**
 * A dated goal the plan builds toward, e.g. a 15 km hike on 31 Dec, or a
 * multi-day trek: `km` per day for `days` days in a row from `date`.
 */
export type GoalEvent = {
  name: string;
  km: number;
  date: DateKey;
  days?: number;
  ascentM?: number;
  /** Highest altitude (m); 1500+ adds an aerobic-base (Zone 2) phase. */
  altitudeM?: number;
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
  /**
   * Optional aim: average km per day over all days (rest days count as zero).
   * Goals step up toward it; the monthly challenge is at least aim × days.
   */
  dailyTargetKm: number | null;
  /** Optional dated goal; the weekly plan builds toward it. */
  event: GoalEvent | null;
  /** "My period started today" taps (used with or without Health Connect cycle data). */
  periodStarts: DateKey[];
  /** Typical cycle length, used until 2+ cycles are known. */
  cycleDays: number;
  /** "Not now" on raising the aim: don't ask again before this date. */
  aimSnoozedUntil: DateKey | null;
  /** The aim we already sent a "you reached it" notification for. */
  aimNotifiedKm: number | null;
  maxHr: number;
  /** "HH:MM" local time. */
  morningReminder: string;
  eveningReminder: string;
  /** Also remind 30 min before the time you usually start moving (learned). */
  smartReminder: boolean;
  /** First day of the plan. */
  startDate: DateKey;
  dataSource: 'health_connect' | 'demo';
  onboarded: boolean;
  /** Last day whose completed goal was already celebrated (so we notify once). */
  lastCelebrated: DateKey | null;
  /** Epoch ms of the last successful background sync (shown in Diagnostics). */
  lastBackgroundSync: number | null;
  /** Monthly km challenge targets, fixed the first time each month is seen ("2026-11" → km). */
  monthTargets: Record<string, number>;
  /** Unlocked achievements → date unlocked. Never removed. */
  achievements: Record<string, DateKey>;
  /** AI coach: a weekly review on Sunday evening (needs a Claude API key, kept in secure storage). */
  coachEnabled: boolean;
  /** Tell the coach that a light week is for your period, and when the next one is due. Off by default. */
  coachShareCycle: boolean;
  /** A rest day agreed with the coach in the chat (today only). */
  coachRestDay: { date: DateKey; reason: string } | null;
  /** A lighter goal for today agreed with the coach (today's share × factor). */
  coachToday: { date: DateKey; factor: number; reason: string } | null;
  /** The coach checks in on mornings when something stands out (with the coach on). */
  dailyCheckin: boolean;
  /** Last day the morning check-in was considered (so it runs once a day). */
  lastCheckin: DateKey | null;
  /** Calendars whose events are work shifts (ids on this phone). Empty: not used. */
  workCalendars: string[];
  /** Your town, for the forecast (only its coordinates are sent to Open-Meteo). */
  weatherPlace: { name: string; lat: number; lon: number } | null;
  /** Weather suggestions you answered "Not now" to. */
  weatherDismissed: string[];
  /** Folder for the weekly automatic backup (Android folder address), if chosen. */
  backupFolder: string | null;
  lastAutoBackup: { at: number; ok: boolean; error?: string } | null;
  /** Strength sessions from the watch already ticked here (so an untick sticks). */
  watchStrengthImported: DateKey[];
};

export const DEFAULT_SETTINGS: Omit<Settings, 'startDate'> = {
  restDaysPerWeek: 2,
  rideFactor: 3,
  dailyTargetKm: null,
  event: null,
  periodStarts: [],
  cycleDays: 28,
  aimSnoozedUntil: null,
  aimNotifiedKm: null,
  maxHr: 185,
  morningReminder: '08:00',
  eveningReminder: '19:30',
  smartReminder: true,
  dataSource: 'health_connect',
  onboarded: false,
  lastCelebrated: null,
  lastBackgroundSync: null,
  monthTargets: {},
  achievements: {},
  coachEnabled: false,
  coachShareCycle: false,
  coachRestDay: null,
  coachToday: null,
  dailyCheckin: true,
  lastCheckin: null,
  workCalendars: [],
  weatherPlace: null,
  weatherDismissed: [],
  backupFolder: null,
  lastAutoBackup: null,
  watchStrengthImported: [],
};

export type Progress = {
  value: number;
  target: number;
  fraction: number;
  done: boolean;
  /** Long walks with a climb target: metres climbed in that walk vs. the target. */
  ascent?: { value: number; target: number };
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
