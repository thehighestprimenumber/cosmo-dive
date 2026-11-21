import { addDays, startOfDay, toDateKey } from '../domain/dates';
import type { Night } from '../domain/readiness';
import type { Activity, HrSample, Sport } from '../domain/types';
import type { ActivitySource } from './ActivitySource';

/** Cheap deterministic pseudo-random number in [0, 1) from a string. */
function rand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/**
 * Fake but stable walks and rides, for trying the app on a device or
 * emulator without Health Connect data. Today's activity "grows" during the day.
 */
export const demoSource: ActivitySource = {
  name: 'Demo data',
  status: async () => ({ state: 'ready' }),
  requestAccess: async () => true,

  async getActivities(from: Date, to: Date): Promise<Activity[]> {
    const out: Activity[] = [];
    const now = Date.now();
    for (let d = toDateKey(from); startOfDay(d) < to; d = addDays(d, 1)) {
      if (rand(d + 'skip') < 0.25) continue;
      const sport: Sport = rand(d + 'sport') < 0.3 ? 'ride' : 'walk';
      const minutes = Math.round(20 + rand(d + 'min') * 40);
      const start = startOfDay(d).getTime() + (8 + Math.floor(rand(d + 'h') * 10)) * 3_600_000;
      const end = Math.min(start + minutes * 60_000, now);
      if (end <= start) continue;
      const speed = sport === 'walk' ? 1.4 : 5; // m/s
      const hr: HrSample[] = [];
      for (let t = start; t <= end; t += 5000) {
        const effort = sport === 'walk' ? 0.62 : 0.7;
        hr.push({ t, bpm: Math.round(185 * (effort + 0.08 * Math.sin(t / 300_000))) });
      }
      out.push({
        id: `demo-${d}`,
        sport,
        start,
        end,
        durationS: (end - start) / 1000,
        distanceM: ((end - start) / 1000) * speed,
        hr,
        origin: 'demo',
      });
    }
    return out.filter((a) => a.start >= from.getTime() && a.start < to.getTime());
  },

  hasCycleAccess: async () => true,
  requestCycleAccess: async () => true,
  getPeriods: async () => [],

  hasSleepAccess: async () => true,
  requestSleepAccess: async () => true,

  async getNights(from: Date, to: Date): Promise<Night[]> {
    const nights: Night[] = [];
    for (let d = toDateKey(from); startOfDay(d) < to; d = addDays(d, 1)) {
      if (startOfDay(d).getTime() + 7 * 3_600_000 > Date.now()) continue; // not woken up yet
      nights.push({
        date: d,
        sleepS: (5.5 + rand(d + 'sleep') * 3) * 3600,
        lowHr: Math.round(50 + rand(d + 'rhr') * 10),
      });
    }
    return nights;
  },
};
