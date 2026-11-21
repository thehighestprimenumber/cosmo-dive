import { describe, expect, it } from 'vitest';
import { migrate } from '../data/db';
import { addDays, startOfDay } from '../domain/dates';
import { DEFAULT_SETTINGS, type Activity, type Settings } from '../domain/types';
import { refresh } from '../services/sync';
import type { ActivitySource } from '../sources/ActivitySource';
import { fakeDb } from '../test/fakeDb';
import { widgetStateFrom } from './state';

const settings: Settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-16', onboarded: true };
function walk(date: string, km: number, hour = 9): Activity {
  const start = startOfDay(date).getTime() + hour * 3_600_000;
  return { id: date + hour, sport: 'walk', start, end: start + km * 12 * 60_000, durationS: km * 720, distanceM: km * 1000, hr: [], origin: 't' };
}
const source = (acts: Activity[]): ActivitySource => ({
  name: 'test',
  status: async () => ({ state: 'ready' }),
  requestAccess: async () => true,
  getActivities: async (from, to) => acts.filter((a) => a.start >= from.getTime() && a.start < to.getTime()),
});

describe('widget content', () => {
  it('shows today’s goal, progress, streak and the week', async () => {
    const db = fakeDb();
    await migrate(db);
    const history = Array.from({ length: 21 }, (_, i) => walk(addDays('2026-11-21', -21 + i), 4));
    const snap = await refresh(db, source([...history, walk('2026-11-21', 2, 10)]), settings, {
      now: new Date(2026, 10, 21, 18, 0),
    });
    const w = widgetStateFrom(snap, settings);
    expect(w.date).toBe('2026-11-21');
    expect(w.title).not.toBe('No goal yet');
    expect(w.detail).toMatch(/ of |complete/);
    expect(w.fraction).toBeGreaterThan(0);
    expect(w.dots).toHaveLength(7);
    expect(w.todayIndex).toBe(5); // Saturday
    expect(w.weekLine).toMatch(/this week · .* left/);
    expect(w.streak).toBe(snap.streak.current);
  });
});
