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
import { dedupeActivities } from '../domain/progress';
import type { Activity, HrSample, Sport } from '../domain/types';
import type { ActivitySource, SourceStatus } from './ActivitySource';

const SPORT_BY_TYPE: Record<number, Sport> = {
  [ExerciseType.WALKING]: 'walk',
  [ExerciseType.HIKING]: 'walk',
  [ExerciseType.BIKING]: 'ride',
  [ExerciseType.BIKING_STATIONARY]: 'ride',
};

const READ_TYPES = ['ExerciseSession', 'Distance', 'HeartRate'] as const;

const PERMISSIONS = [
  ...READ_TYPES.map((recordType) => ({ accessType: 'read' as const, recordType })),
  // Without this, Health Connect only returns the last 30 days.
  { accessType: 'read' as const, recordType: 'ReadHealthDataHistory' as const },
];

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

async function readAll<T extends 'ExerciseSession' | 'HeartRate'>(type: T, from: Date, to: Date) {
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
    const sessions = (await readAll('ExerciseSession', from, to)).filter(
      (s) => SPORT_BY_TYPE[s.exerciseType] !== undefined,
    );

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
          sport: SPORT_BY_TYPE[s.exerciseType],
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
