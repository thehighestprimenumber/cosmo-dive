import { toDateKey } from './dates';
import type { Activity, DateKey, HrSample } from './types';
import { zoneRange } from './zones';

/**
 * Active minutes from the watch's all-day heart rate: time with the heart
 * rate raised (zone 2 or more), outside recorded workouts (those already
 * count with their own duration). Close to Samsung's "raised HR activity
 * time", which Health Connect doesn't share.
 */

/** Two raised readings further apart than this aren't joined (the watch reads less often at rest). */
export const MAX_GAP_MS = 6 * 60_000;
/** Days of all-day heart rate read on each sync (older days keep the distance estimate). */
export const ACTIVE_TIME_DAYS = 14;

/** Raised = zone 2 or more (60% of max heart rate). */
export const raisedBpm = (maxHr: number) => zoneRange(2, maxHr)[0];

/**
 * Seconds of raised heart rate per day, outside the given workouts. Every day
 * with heart rate readings is in the result (0 when nothing was raised), so a
 * missing day means "no data" rather than "no activity".
 */
export function raisedSeconds(samples: HrSample[], minBpm: number, workouts: Activity[]): Record<DateKey, number> {
  const out: Record<DateKey, number> = {};
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  for (const s of sorted) out[toDateKey(s.t)] ??= 0;
  const busy = workouts.filter((w) => !w.synthetic).map((w) => [w.start, w.end] as const);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a.bpm < minBpm || b.bpm < minBpm || b.t - a.t > MAX_GAP_MS || b.t <= a.t) continue;
    // The part of [a, b] not inside a recorded workout.
    let ms = b.t - a.t;
    for (const [ws, we] of busy) ms -= Math.max(0, Math.min(b.t, we) - Math.max(a.t, ws));
    if (ms > 0) out[toDateKey(a.t)] += ms / 1000;
  }
  for (const d of Object.keys(out)) out[d] = Math.round(out[d]);
  return out;
}

/**
 * Seconds of moderate or vigorous activity per day (Health Connect "activity
 * intensity", e.g. Google Fit's move minutes), outside recorded workouts.
 * Overlapping intervals count once.
 */
export function intensitySeconds(intervals: { start: number; end: number }[], workouts: Activity[]): Record<DateKey, number> {
  const out: Record<DateKey, number> = {};
  const busy = workouts.filter((w) => !w.synthetic).map((w) => [w.start, w.end] as const);
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  let coveredUntil = -Infinity;
  for (const iv of sorted) {
    const start = Math.max(iv.start, coveredUntil);
    if (iv.end <= start) continue;
    coveredUntil = iv.end;
    let ms = iv.end - start;
    for (const [ws, we] of busy) ms -= Math.max(0, Math.min(iv.end, we) - Math.max(start, ws));
    const d = toDateKey(iv.start);
    out[d] = (out[d] ?? 0) + Math.max(0, ms) / 1000;
  }
  for (const d of Object.keys(out)) out[d] = Math.round(out[d]);
  return out;
}

/** Per day: move minutes when known, else raised heart rate (the larger if both). */
export function combineActive(move: Record<DateKey, number>, hr: Record<DateKey, number>): Record<DateKey, number> {
  const out: Record<DateKey, number> = { ...hr };
  for (const [d, s] of Object.entries(move)) out[d] = Math.max(s, hr[d] ?? 0);
  return out;
}
