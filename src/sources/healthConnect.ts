import {
  ExerciseType,
  SdkAvailabilityStatus,
  aggregateRecord,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
} from 'react-native-health-connect';
import { toDateKey } from '../domain/dates';
import { dedupeActivities } from '../domain/progress';
import type { Period } from '../domain/cycle';
import { lowPoint, type Night } from '../domain/readiness';
import type { Activity, HrSample, Sport } from '../domain/types';
import type { ActivitySource, SourceStatus } from './ActivitySource';

/** Everything not listed here is 'other': counts for time and heart rate goals, not distance. */
const SPORT_BY_TYPE: Record<number, Sport> = {
  [ExerciseType.WALKING]: 'walk',
  [ExerciseType.HIKING]: 'walk',
  [ExerciseType.RUNNING]: 'walk',
  [ExerciseType.RUNNING_TREADMILL]: 'walk',
  [ExerciseType.BIKING]: 'ride',
  [ExerciseType.BIKING_STATIONARY]: 'ride',
};
const sportOf = (type: number): Sport => SPORT_BY_TYPE[type] ?? 'other';

const READ_TYPES = ['ExerciseSession', 'Distance', 'HeartRate'] as const;

const PERMISSIONS = [
  ...READ_TYPES.map((recordType) => ({ accessType: 'read' as const, recordType })),
  // Without this, Health Connect only returns the last 30 days.
  { accessType: 'read' as const, recordType: 'ReadHealthDataHistory' as const },
  // Lets the background sync read activities while the app is closed.
  { accessType: 'read' as const, recordType: 'BackgroundAccessPermission' as const },
  // Optional: sleep makes goals readiness-aware.
  { accessType: 'read' as const, recordType: 'SleepSession' as const },
];
// Periods (optional, sensitive) are only requested from the Week tab: requestCycleAccess().

let initialized = false;

async function ensureInitialized(): Promise<boolean> {
  if (!initialized) initialized = await initialize();
  return initialized;
}

const between = (from: Date, to: Date) => ({
  operator: 'between' as const,
  startTime: from.toISOString(),
  endTime: to.toISOString(),
});

async function readAll<T extends 'ExerciseSession' | 'HeartRate' | 'SleepSession' | 'MenstruationPeriod'>(
  type: T,
  from: Date,
  to: Date,
) {
  const out = [];
  let pageToken: string | undefined;
  do {
    const page = await readRecords(type, { timeRangeFilter: between(from, to), pageToken });
    out.push(...page.records);
    pageToken = page.pageToken || undefined;
  } while (pageToken);
  return out;
}

export const healthConnectSource: ActivitySource = {
  name: 'Health Connect',

  async hasSleepAccess() {
    if (!(await ensureInitialized())) return false;
    const granted = await getGrantedPermissions();
    return granted.some((p) => p.recordType === 'SleepSession' && p.accessType === 'read');
  },

  async requestSleepAccess() {
    if (!(await ensureInitialized())) return false;
    const granted = await requestPermission([{ accessType: 'read', recordType: 'SleepSession' }]);
    return granted.some((p) => p.recordType === 'SleepSession' && p.accessType === 'read');
  },

  async hasCycleAccess() {
    if (!(await ensureInitialized())) return false;
    const granted = await getGrantedPermissions();
    return granted.some((p) => p.recordType === 'MenstruationPeriod' && p.accessType === 'read');
  },

  async requestCycleAccess() {
    if (!(await ensureInitialized())) return false;
    const granted = await requestPermission([{ accessType: 'read', recordType: 'MenstruationPeriod' }]);
    return granted.some((p) => p.recordType === 'MenstruationPeriod' && p.accessType === 'read');
  },

  async getPeriods(from: Date, to: Date): Promise<Period[]> {
    await ensureInitialized();
    const records = await readAll('MenstruationPeriod', from, to);
    // The native module returns startTime/endTime (the record is an interval),
    // although the library's TypeScript type describes a single instant.
    return records.map((r) => {
      const rec = r as unknown as { startTime: string; endTime: string };
      return { start: toDateKey(new Date(rec.startTime)), end: toDateKey(new Date(new Date(rec.endTime).getTime() - 1)) };
    });
  },

  async getNights(from: Date, to: Date): Promise<Night[]> {
    await ensureInitialized();
    // Start a day early so a night that began before `from` but ended inside it is included.
    const sessions = await readAll('SleepSession', new Date(from.getTime() - 86_400_000), to);
    const byDate = new Map<string, { start: number; end: number }[]>();
    for (const s of sessions) {
      const start = new Date(s.startTime).getTime();
      const end = new Date(s.endTime).getTime();
      const wake = new Date(end);
      // Main sleep only: at least 2 h, ending between 03:00 and 14:00 (naps are ignored).
      if (end - start < 2 * 3_600_000 || wake.getHours() < 3 || wake.getHours() >= 14) continue;
      if (end < from.getTime() || end >= to.getTime()) continue;
      const date = toDateKey(wake);
      byDate.set(date, [...(byDate.get(date) ?? []), { start, end }]);
    }
    const nights: Night[] = [];
    for (const [date, spans] of byDate) {
      const sleepS = spans.reduce((t, s) => t + (s.end - s.start) / 1000, 0);
      const first = Math.min(...spans.map((s) => s.start));
      const last = Math.max(...spans.map((s) => s.end));
      const hrRecords = await readAll('HeartRate', new Date(first), new Date(last));
      const bpms: number[] = [];
      for (const rec of hrRecords) {
        for (const sample of rec.samples) {
          const t = new Date(sample.time).getTime();
          if (spans.some((s) => t >= s.start && t <= s.end)) bpms.push(sample.beatsPerMinute);
        }
      }
      nights.push({ date, sleepS, lowHr: lowPoint(bpms) });
    }
    return nights.sort((a, b) => (a.date < b.date ? -1 : 1));
  },

  async status(): Promise<SourceStatus> {
    const sdk = await getSdkStatus();
    if (sdk === SdkAvailabilityStatus.SDK_UNAVAILABLE) {
      return { state: 'unavailable', reason: 'Health Connect is not available on this device.' };
    }
    if (sdk === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
      return { state: 'unavailable', reason: 'Health Connect needs an update from the Play Store.' };
    }
    if (!(await ensureInitialized())) {
      return { state: 'unavailable', reason: 'Could not start Health Connect.' };
    }
    const granted = await getGrantedPermissions();
    const ok = READ_TYPES.every((t) => granted.some((p) => p.recordType === t && p.accessType === 'read'));
    return ok ? { state: 'ready' } : { state: 'needs_permission' };
  },

  async requestAccess(): Promise<boolean> {
    if (!(await ensureInitialized())) return false;
    const granted = await requestPermission(PERMISSIONS);
    return READ_TYPES.every((t) => granted.some((p) => p.recordType === t && p.accessType === 'read'));
  },

  async getActivities(from: Date, to: Date): Promise<Activity[]> {
    await ensureInitialized();
    const sessions = await readAll('ExerciseSession', from, to);

    const activities = await Promise.all(
      sessions.map(async (s): Promise<Activity> => {
        const start = new Date(s.startTime);
        const end = new Date(s.endTime);
        const origin = s.metadata?.dataOrigin ?? 'unknown';

        // Distance from the same app that recorded the session, so it isn't double counted.
        const dist = await aggregateRecord({
          recordType: 'Distance',
          timeRangeFilter: between(start, end),
          dataOriginFilter: origin === 'unknown' ? undefined : [origin],
        });
        const distanceM = dist.DISTANCE?.inMeters ?? 0;

        const hrRecords = await readAll('HeartRate', start, end);
        const seen = new Set<number>();
        const hr: HrSample[] = [];
        for (const rec of hrRecords) {
          for (const sample of rec.samples) {
            const t = new Date(sample.time).getTime();
            if (t < start.getTime() || t > end.getTime() || seen.has(t)) continue;
            seen.add(t);
            hr.push({ t, bpm: sample.beatsPerMinute });
          }
        }
        hr.sort((a, b) => a.t - b.t);

        return {
          id: s.metadata?.id ?? `${origin}-${s.startTime}`,
          sport: sportOf(s.exerciseType),
          label: TYPE_NAMES[s.exerciseType] ?? 'workout',
          start: start.getTime(),
          end: end.getTime(),
          durationS: (end.getTime() - start.getTime()) / 1000,
          distanceM: distanceM > 0 ? distanceM : null,
          hr,
          origin,
        };
      }),
    );

    return dedupeActivities(activities);
  },
};

// ---- diagnostics ----

const TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(ExerciseType).map(([name, id]) => [id, name.toLowerCase().replace(/_/g, ' ')]),
);

export type RawSession = {
  id: string;
  type: string;
  counted: boolean;
  start: number;
  end: number;
  origin: string;
};

/** Every exercise session Health Connect has, including ones Daily Spark ignores. */
export async function listRawSessions(from: Date, to: Date): Promise<RawSession[]> {
  await ensureInitialized();
  const sessions = await readAll('ExerciseSession', from, to);
  return sessions
    .map((s) => ({
      id: s.metadata?.id ?? s.startTime,
      type: TYPE_NAMES[s.exerciseType] ?? `type ${s.exerciseType}`,
      counted: true,
      start: new Date(s.startTime).getTime(),
      end: new Date(s.endTime).getTime(),
      origin: s.metadata?.dataOrigin ?? 'unknown',
    }))
    .sort((a, b) => b.start - a.start);
}

/** Granted Health Connect permissions, as readable names. */
export async function listGrantedPermissions(): Promise<string[]> {
  await ensureInitialized();
  const granted = await getGrantedPermissions();
  return granted.map((p) => `${p.accessType} ${p.recordType}`).sort();
}
