import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { avoidBusyDays, moveSession, planWeek, type WeekPlan } from './plan';
import { busyDaysFrom } from './shifts';
import { DEFAULT_SETTINGS } from './types';

const MON = '2026-11-23';
const t = (day: string, h: number) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`);

describe('work days from the calendar', () => {
  it('6+ hours of events, an overnight shift on both days, or an all-day event', () => {
    const wed = addDays(MON, 2);
    const fri = addDays(MON, 4);
    const busy = busyDaysFrom(
      [
        { start: t(MON, 8), end: t(MON, 16), allDay: false }, // 8 h
        { start: t(addDays(MON, 1), 9), end: t(addDays(MON, 1), 12), allDay: false }, // 3 h: not a work day
        { start: t(wed, 20), end: t(addDays(wed, 1), 8), allDay: false }, // 20:00–08:00: 4 h + 8 h
        { start: new Date(`${fri}T00:00:00`), end: new Date(`${addDays(fri, 1)}T00:00:00`), allDay: true },
      ],
      MON,
      addDays(MON, 6),
    );
    expect(busy).toEqual([MON, addDays(MON, 3), fri]);
  });
});

describe('key sessions and work days', () => {
  it('a new plan avoids work days', () => {
    const sat = addDays(MON, 5);
    const plan = planWeek(MON, MON, [], DEFAULT_SETTINGS, { busy: [sat] });
    expect(plan.sessions.map((s) => s.day)).not.toContain(sat);
  });

  it('a session on a work day moves to a free day 2+ days from the other one; one you placed stays', () => {
    const plan: WeekPlan = {
      week: MON,
      sessions: [
        { id: 'long', kind: 'long_walk', day: addDays(MON, 5), plannedDay: addDays(MON, 5) },
        { id: 'brisk', kind: 'brisk_walk', day: addDays(MON, 2), plannedDay: addDays(MON, 2) },
      ],
    };
    const r = avoidBusyDays(plan, [addDays(MON, 5)], MON, false);
    expect(r.moved).toEqual([{ id: 'long', kind: 'long_walk', from: addDays(MON, 5), to: addDays(MON, 4) }]);
    // Fri is 2 days from Wed's brisk walk and nearest to Sat.
    const pinned = moveSession(plan, 'long', addDays(MON, 6), MON, false, true);
    expect(avoidBusyDays(pinned, [addDays(MON, 6)], MON, false).moved).toEqual([]);
    // Nowhere better: it stays.
    const allBusy = Array.from({ length: 7 }, (_, i) => addDays(MON, i));
    expect(avoidBusyDays(plan, allBusy, MON, false).moved).toEqual([]);
  });
});
