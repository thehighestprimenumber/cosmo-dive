import { describe, expect, it } from 'vitest';
import {
  applyProposal,
  buildReviewInput,
  checkAction,
  reviewFrom,
  shouldAutoReview,
  undoProposal,
  withCoachFactor,
  type CoachProposal,
} from './coach';
import { addDays } from './dates';
import type { WeekPlan } from './plan';
import { DEFAULT_SETTINGS, type Settings } from './types';
import type { WeekVolume } from './volume';

const MONDAY = '2026-11-23'; // this week
const NEXT = addDays(MONDAY, 7);
const SUNDAY = addDays(MONDAY, 6);
const settings: Settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-02', onboarded: true };

const volume = (km: number, extra: Partial<WeekVolume> = {}): WeekVolume => ({
  baseKm: km,
  km,
  light: null,
  preEvent: false,
  eventWeek: false,
  backToBack: false,
  destinationKm: 50,
  notes: [],
  ...extra,
});

const nextPlan = (v = volume(30)): WeekPlan => ({
  week: NEXT,
  sessions: [
    { id: 'long', kind: 'long_walk', day: addDays(NEXT, 5), plannedDay: addDays(NEXT, 5) },
    { id: 'brisk', kind: 'brisk_walk', day: addDays(NEXT, 2), plannedDay: addDays(NEXT, 2) },
  ],
  volume: v,
});

describe('checking what the coach proposes', () => {
  it('moves a key session only to a free day of that week', () => {
    const plan = nextPlan();
    const ok = checkAction({ type: 'move_session', sessionId: 'long', to: addDays(NEXT, 6) }, plan, 30);
    expect(ok).toMatchObject({ ok: true, change: 'Long walk: Sat → Sun' });
    expect(checkAction({ type: 'move_session', sessionId: 'long', to: addDays(NEXT, 2) }, plan, 30).ok).toBe(false); // brisk is there
    expect(checkAction({ type: 'move_session', sessionId: 'long', to: addDays(NEXT, 7) }, plan, 30).ok).toBe(false); // next-next week
    expect(checkAction({ type: 'move_session', sessionId: 'nope', to: addDays(NEXT, 6) }, plan, 30).ok).toBe(false);
    const trek: WeekPlan = { ...plan, sessions: [{ id: 'trek-1', kind: 'trek_day', day: NEXT, plannedDay: NEXT }] };
    expect(checkAction({ type: 'move_session', sessionId: 'trek-1', to: addDays(NEXT, 1) }, trek, 30).ok).toBe(false);
  });

  it('lightens a week down to 60% at most', () => {
    expect(checkAction({ type: 'scale_week', factor: 0.85 }, nextPlan(), 30)).toMatchObject({
      ok: true,
      change: 'Next week: 30 → 25.5 km',
    });
    const floor = checkAction({ type: 'scale_week', factor: 0.3 }, nextPlan(), 30);
    expect(floor).toMatchObject({ ok: true, action: { factor: 0.6 }, change: 'Next week: 30 → 18 km' });
    expect(floor.ok && floor.adjusted).toContain('60%');
  });

  it('never grows past +10% over what you actually walked, and never in a light week', () => {
    // Planned 30 km, walked 30 this week: up to 33 km.
    const capped = checkAction({ type: 'scale_week', factor: 1.3 }, nextPlan(), 30);
    expect(capped).toMatchObject({ ok: true, action: { factor: 1.1 }, change: 'Next week: 30 → 33 km' });
    // The plan already grew 10% over this week's 27.3 km: no room.
    expect(checkAction({ type: 'scale_week', factor: 1.1 }, nextPlan(), 27.3).ok).toBe(false);
    expect(checkAction({ type: 'scale_week', factor: 1.1 }, nextPlan(volume(30, { light: 'period' })), 40).ok).toBe(false);
    expect(checkAction({ type: 'scale_week', factor: 1.1 }, nextPlan(volume(30, { preEvent: true })), 40).ok).toBe(false);
    // A light week can still be lighter.
    expect(checkAction({ type: 'scale_week', factor: 0.9 }, nextPlan(volume(30, { light: 'every4' })), 40).ok).toBe(true);
  });

  it('ignores changes too small to matter', () => {
    expect(checkAction({ type: 'scale_week', factor: 0.99 }, nextPlan(), 30).ok).toBe(false);
  });
});

describe('reading the coach’s answer', () => {
  const raw = {
    summary: 'Buena semana: cumpliste 5 de 7.',
    tip: 'Llevá agua el sábado.',
    proposals: [
      { type: 'move_session', session_id: 'long', to: addDays(NEXT, 6), factor: null, reason: 'Los domingos caminás más.' },
      { type: 'scale_week', session_id: null, to: null, factor: 0.9, reason: 'Dormiste poco.' },
      { type: 'scale_week', session_id: null, to: null, factor: 0.8, reason: 'Una tercera.' },
    ],
  };

  it('keeps at most 2 valid proposals, clamped', () => {
    const r = reviewFrom(raw, nextPlan(), 30, 1000, 'm');
    expect(r.week).toBe(NEXT);
    expect(r.proposals.map((p) => p.change)).toEqual(['Long walk: Sat → Sun', 'Next week: 30 → 27 km']);
    expect(r.proposals.every((p) => p.status === 'pending')).toBe(true);
  });

  it('drops invalid ones and doesn’t crash on junk', () => {
    const r = reviewFrom(
      {
        summary: 'Ok.',
        tip: '',
        proposals: [
          { type: 'move_session', session_id: 'long', to: '2027-01-01', factor: null, reason: 'x' },
          { type: 'delete_everything', reason: 'y' },
          { type: 'scale_week', factor: 0.8, reason: '' },
          'nonsense',
        ],
      },
      nextPlan(),
      30,
      1000,
    );
    expect(r.proposals).toEqual([]);
    expect(r.tip).toBeNull();
    expect(() => reviewFrom({}, nextPlan(), 30, 1000)).toThrow();
  });
});

describe('applying and undoing', () => {
  const move: CoachProposal = {
    id: 'p1',
    action: { type: 'move_session', sessionId: 'long', to: addDays(NEXT, 6) },
    reason: '',
    change: '',
    status: 'pending',
  };
  const scale: CoachProposal = { ...move, id: 'p2', action: { type: 'scale_week', factor: 0.8 } };

  it('moves a session and moves it back', () => {
    const r = applyProposal(nextPlan(), move, SUNDAY, false)!;
    expect(r.from).toBe(addDays(NEXT, 5));
    expect(r.plan.sessions[0].day).toBe(addDays(NEXT, 6));
    const back = undoProposal(r.plan, { ...move, status: 'applied', from: r.from }, SUNDAY, false)!;
    expect(back.sessions[0].day).toBe(addDays(NEXT, 5));
  });

  it('won’t move onto a day that has passed', () => {
    const wed = addDays(NEXT, 2);
    const plan = nextPlan();
    const moveToTue: CoachProposal = { ...move, action: { type: 'move_session', sessionId: 'long', to: addDays(NEXT, 1) } };
    expect(applyProposal(plan, moveToTue, wed, false)).toBeNull();
  });

  it('scales the week once, keeps it when km are recomputed, and undoes it', () => {
    const r = applyProposal(nextPlan(), scale, SUNDAY, false)!;
    expect(r.plan.volume!.km).toBe(24);
    expect(r.plan.coach).toEqual({ factor: 0.8 });
    expect(r.plan.volume!.notes.at(-1)).toContain('-20%');
    expect(applyProposal(r.plan, scale, SUNDAY, false)).toBeNull(); // only one per week
    // Monday: the week's km is recomputed from the rules, the coach factor stays on top.
    expect(withCoachFactor(volume(31), r.plan.coach!.factor).km).toBe(25);
    const undone = undoProposal(r.plan, { ...scale, status: 'applied' }, SUNDAY, false)!;
    expect(undone.volume!.km).toBe(30);
    expect(undone.coach).toBeUndefined();
    expect(undone.volume!.notes).toEqual([]);
  });
});

describe('what the coach sees', () => {
  const plan: WeekPlan = {
    week: MONDAY,
    sessions: [{ id: 'long', kind: 'long_walk', day: addDays(MONDAY, 5), plannedDay: addDays(MONDAY, 5) }],
    volume: volume(28),
  };
  const days = new Map([
    [
      MONDAY,
      {
        date: MONDAY,
        goal: { kind: 'distance' as const, meters: 5000, suggestedSport: 'walk' as const },
        value: 6000,
        done: true,
        status: 'done' as const,
        meta: { base: 5000, notes: [], readiness: 'low' as const },
      },
    ],
  ]);
  const input = (s: Settings, light: WeekVolume['light']) =>
    buildReviewInput({
      today: SUNDAY,
      plan,
      nextPlan: nextPlan(volume(24, { light })),
      days,
      doneKm: 27.04,
      recentWeeksKm: [20, 22.33, 25, 26],
      streak: { current: 9, longest: 12, freezes: 1 },
      settings: s,
      nextPeriodStart: addDays(NEXT, 1),
    });

  it('summarizes the week and next week’s plan', () => {
    const i = input(settings, null);
    expect(i.thisWeek.days).toHaveLength(7);
    expect(i.thisWeek.days[0]).toMatchObject({ weekday: 'Mon', done: true, readiness: 'low', goal: 'Walk 5 km (or ride 15 km)' });
    expect(i.thisWeek.days[5].keySession).toBe('long_walk');
    expect(i.thisWeek.doneKm).toBe(27);
    expect(i.recentWeeksKm[1]).toBe(22.3);
    expect(i.nextWeek.freeDays).toHaveLength(5);
    expect(i.nextWeek.maxKm).toBe(26.5); // 24 km planned; you walked 27 → at most +10% of that (29.7), capped at +10% of 24
  });

  it('only mentions your period when you share it', () => {
    const hidden = input(settings, 'period');
    expect(hidden.nextWeek.weekType).toBe('light');
    expect('nextPeriodStart' in hidden).toBe(false);
    expect(JSON.stringify(hidden)).not.toMatch(/period/i);
    const shared = input({ ...settings, coachShareCycle: true }, 'period');
    expect(shared.nextWeek.weekType).toBe('light_period');
    expect(shared.nextPeriodStart).toBe(addDays(NEXT, 1));
  });
});

describe('background reviews', () => {
  it('asks once, retries a failure a few times with a pause', () => {
    const fail = (attempts: number, lastAttempt: number) =>
      ({ ok: false, week: NEXT, error: 'x', attempts, lastAttempt }) as const;
    expect(shouldAutoReview(null, 0)).toBe(true);
    expect(shouldAutoReview(fail(1, 0), 3_600_000)).toBe(false);
    expect(shouldAutoReview(fail(1, 0), 2 * 3_600_000)).toBe(true);
    expect(shouldAutoReview(fail(3, 0), 10 * 3_600_000)).toBe(false);
  });
});
