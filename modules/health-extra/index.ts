import { requireOptionalNativeModule } from 'expo-modules-core';

export type IntensityInterval = { start: number; end: number; type: number; origin: string };
export type IntensityStatus = 'unsupported' | 'denied' | 'granted';

type HealthExtraModule = {
  activityIntensityStatus(): Promise<IntensityStatus>;
  requestActivityIntensity(): Promise<boolean>;
  readActivityIntensity(startIso: string, endIso: string): Promise<IntensityInterval[]>;
};

// Null outside a native Android build (tests, older APKs): everything reports "unsupported".
const native = requireOptionalNativeModule<HealthExtraModule>('HealthExtra');

/** Whether move minutes (Health Connect activity intensity) can be read. */
export async function moveMinutesStatus(): Promise<IntensityStatus> {
  if (!native) return 'unsupported';
  try {
    return await native.activityIntensityStatus();
  } catch {
    return 'unsupported';
  }
}

export async function requestMoveMinutes(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.requestActivityIntensity();
  } catch {
    return false;
  }
}

/** Moderate / vigorous intervals in [from, to). Empty when unsupported, not allowed or none. */
export async function readMoveMinutes(from: Date, to: Date): Promise<IntensityInterval[]> {
  if (!native) return [];
  try {
    return await native.readActivityIntensity(from.toISOString(), to.toISOString());
  } catch {
    return [];
  }
}
