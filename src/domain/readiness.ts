import { addDays } from './dates';
import { formatMinutes } from './format';
import type { DateKey } from './types';

/** One night of sleep, keyed by the date you woke up. */
export type Night = {
  date: DateKey;
  sleepS: number;
  /** Low point of your heart rate while asleep (10th percentile), if measured. */
  lowHr: number | null;
};

export type ReadinessLevel = 'low' | 'normal' | 'high' | 'unknown';

export type Readiness = {
  level: ReadinessLevel;
  /** Multiplies today's target. */
  factor: number;
  notes: string[];
};

const BASELINE_NIGHTS = 14;
const MIN_BASELINE_NIGHTS = 5;
const SHORT_NIGHT_S = 5.5 * 3600;
const LOW_FACTOR = 0.85;
const HIGH_FACTOR = 1.05;

/**
 * How ready you are today, from last night compared with your own last two
 * weeks. Short sleep or a resting heart rate 5+ bpm above usual → lighter
 * goal; a full night with a low resting heart rate → slightly harder.
 * Without last night's data it's "unknown" and changes nothing.
 */
export function readinessFor(date: DateKey, nights: Night[]): Readiness {
  const last = nights.find((n) => n.date === date);
  if (!last) return { level: 'unknown', factor: 1, notes: [] };

  const from = addDays(date, -BASELINE_NIGHTS);
  const prev = nights.filter((n) => n.date >= from && n.date < date);
  const sleeps = prev.map((n) => n.sleepS);
  const hrs = prev.map((n) => n.lowHr).filter((h): h is number => h != null);
  const sleepBase = sleeps.length >= MIN_BASELINE_NIGHTS ? median(sleeps) : null;
  const hrBase = hrs.length >= MIN_BASELINE_NIGHTS ? median(hrs) : null;

  const low: string[] = [];
  if (last.sleepS < SHORT_NIGHT_S || (sleepBase != null && last.sleepS < 0.8 * sleepBase)) {
    low.push(
      `Short night: ${formatMinutes(last.sleepS)}` +
        (sleepBase != null ? ` (you usually sleep ${formatMinutes(sleepBase)}).` : '.'),
    );
  }
  if (last.lowHr != null && hrBase != null && last.lowHr >= hrBase + 5) {
    low.push(`Resting heart rate up: ${Math.round(last.lowHr)} bpm (usually ${Math.round(hrBase)}).`);
  }
  if (low.length) {
    return { level: 'low', factor: LOW_FACTOR, notes: [...low, 'Taking it 15% easier today.'] };
  }

  if (
    sleepBase != null &&
    hrBase != null &&
    last.lowHr != null &&
    last.sleepS >= sleepBase &&
    last.lowHr <= hrBase - 2
  ) {
    return {
      level: 'high',
      factor: HIGH_FACTOR,
      notes: [`Well rested: ${formatMinutes(last.sleepS)} of sleep, resting heart rate ${Math.round(last.lowHr)} bpm. A little extra today.`],
    };
  }
  return { level: 'normal', factor: 1, notes: ['Sleep and resting heart rate look normal.'] };
}

/** 10th percentile, a robust "lowest heart rate" that ignores single odd readings. */
export function lowPoint(bpms: number[]): number | null {
  if (bpms.length < 20) return null;
  const s = [...bpms].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.1)];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
