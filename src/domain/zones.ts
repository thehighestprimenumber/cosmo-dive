import type { HrSample, HrZone } from './types';

/** Zone lower bounds as a fraction of max heart rate (zone 1 starts at 50%). */
const ZONE_FLOORS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

/** Samples further apart than this are treated as a gap, not continuous effort. */
const MAX_SAMPLE_GAP_MS = 60_000;

export function estimateMaxHr(age: number): number {
  return Math.round(220 - age);
}

/** 0 means below zone 1. */
export function zoneOf(bpm: number, maxHr: number): 0 | HrZone {
  const pct = bpm / maxHr;
  for (let z = 5; z >= 1; z--) {
    if (pct >= ZONE_FLOORS[z - 1]) return z as HrZone;
  }
  return 0;
}

/** [low, high) bpm for a zone. Zone 5 has no real upper limit. */
export function zoneRange(zone: HrZone, maxHr: number): [number, number] {
  const low = Math.round(ZONE_FLOORS[zone - 1] * maxHr);
  const high = zone === 5 ? maxHr : Math.round(ZONE_FLOORS[zone] * maxHr);
  return [low, high];
}

/**
 * Seconds spent in a zone. Each sample "owns" the time until the next
 * sample, capped at MAX_SAMPLE_GAP_MS so sparse data doesn't inflate totals.
 */
export function secondsInZone(samples: HrSample[], zone: HrZone, maxHr: number): number {
  if (samples.length < 2) return 0;
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  let ms = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const dt = Math.min(sorted[i + 1].t - sorted[i].t, MAX_SAMPLE_GAP_MS);
    if (dt > 0 && zoneOf(sorted[i].bpm, maxHr) === zone) ms += dt;
  }
  return ms / 1000;
}
