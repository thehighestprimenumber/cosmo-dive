import { describe, expect, it } from 'vitest';
import { loadExtras, migrate, setExtra } from '../data/db';
import { watchRoutine } from '../domain/strength';
import { DEFAULT_SETTINGS, type Settings } from '../domain/types';
import { fakeDb } from '../test/fakeDb';
import { importWatchStrength } from './watchStrength';

describe('strength sessions from the watch', () => {
  it('ticks each day once; a day unticked on the phone stays unticked', async () => {
    const db = fakeDb();
    await migrate(db);
    const s: Settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-01' };
    expect(await importWatchStrength(db, s, ['2026-11-20', '2026-11-22'])).toEqual(['2026-11-20', '2026-11-22']);
    await setExtra(db, '2026-11-20', 'strength', false); // untick on the phone
    expect(await importWatchStrength(db, s, ['2026-11-20', '2026-11-22'])).toEqual([]);
    expect((await loadExtras(db, '2026-11-01', '2026-11-30')).map((x) => x.date)).toEqual(['2026-11-22']);
  });

  it('the watch gets sets and reps or seconds for each exercise', () => {
    const r = watchRoutine();
    expect(r).toHaveLength(7);
    expect(r.every((e) => e.sets >= 1 && (e.reps || e.seconds) && e.cue && e.name)).toBe(true);
  });
});
