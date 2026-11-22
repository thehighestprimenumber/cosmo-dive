import { describe, expect, it } from 'vitest';
import { buildChatContext, chatReplyFrom, checkChatAction, historyText, type ChatCheckContext } from './coachChat';
import { addDays } from './dates';
import type { WeekPlan } from './plan';
import { DEFAULT_SETTINGS, type Settings } from './types';
import type { WeekVolume } from './volume';

const MONDAY = '2026-11-23';
const WED = addDays(MONDAY, 2);
const NEXT = addDays(MONDAY, 7);
const settings: Settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-02', onboarded: true };
const volume = (km: number, extra: Partial<WeekVolume> = {}): WeekVolume => ({
  baseKm: km, km, light: null, preEvent: false, eventWeek: false, backToBack: false, destinationKm: 50, notes: [], ...extra,
});
const plan: WeekPlan = {
  week: MONDAY,
  sessions: [
    { id: 'brisk', kind: 'brisk_walk', day: addDays(MONDAY, 1), plannedDay: addDays(MONDAY, 1) },
    { id: 'long', kind: 'long_walk', day: addDays(MONDAY, 5), plannedDay: addDays(MONDAY, 5) },
  ],
  volume: volume(30),
};
const ctx: ChatCheckContext = {
  today: WED,
  todayDone: false,
  todayGoal: { kind: 'distance', meters: 5000, suggestedSport: 'walk' },
  todayRecovery: false,
  plan,
  nextPlan: null,
  doneKm: 12,
};

describe('chat proposals', () => {
  it('rest today and another goal type today, only while today isn’t done', () => {
    expect(checkChatAction({ type: 'rest_today', date: WED }, ctx)).toMatchObject({ ok: true, change: 'Today: rest day 🛌' });
    expect(checkChatAction({ type: 'rest_today', date: WED }, { ...ctx, todayDone: true }).ok).toBe(false);
    expect(checkChatAction({ type: 'rest_today', date: WED }, { ...ctx, todayRecovery: true }).ok).toBe(false);
    expect(checkChatAction({ type: 'today_kind', date: WED, kind: 'duration' }, ctx)).toMatchObject({ ok: true, change: 'Today’s goal: Time' });
    expect(checkChatAction({ type: 'today_kind', date: WED, kind: 'distance' }, ctx).ok).toBe(false); // already
  });

  it('moves this week’s sessions only to free days from today on, never a past session', () => {
    expect(checkChatAction({ type: 'move_session', week: MONDAY, sessionId: 'long', to: addDays(MONDAY, 6) }, ctx)).toMatchObject({
      ok: true,
      change: 'Long walk: Sat → Sun',
    });
    expect(checkChatAction({ type: 'move_session', week: MONDAY, sessionId: 'long', to: addDays(MONDAY, 1) }, ctx).ok).toBe(false); // past
    expect(checkChatAction({ type: 'move_session', week: MONDAY, sessionId: 'brisk', to: addDays(MONDAY, 3) }, ctx).ok).toBe(false); // its day passed
    expect(checkChatAction({ type: 'move_session', week: NEXT, sessionId: 'long', to: addDays(NEXT, 6) }, ctx).ok).toBe(false); // no next plan yet
  });

  it('this week can only get lighter; next week follows the Sunday-review rules', () => {
    expect(checkChatAction({ type: 'scale_week', week: MONDAY, factor: 0.8 }, ctx)).toMatchObject({ ok: true, change: 'This week: 30 → 24 km' });
    expect(checkChatAction({ type: 'scale_week', week: MONDAY, factor: 1.1 }, ctx).ok).toBe(false);
    const next: WeekPlan = { week: NEXT, sessions: [], volume: volume(33) };
    const sunday = { ...ctx, nextPlan: next, doneKm: 30 };
    expect(checkChatAction({ type: 'scale_week', week: NEXT, factor: 1.2 }, sunday).ok).toBe(false); // 33 is already +10% of 30
    expect(checkChatAction({ type: 'scale_week', week: NEXT, factor: 0.9 }, sunday)).toMatchObject({ ok: true, action: { week: NEXT, factor: 0.9 } });
  });

  it('reads the answer: valid, non-contradicting proposals only', () => {
    const m = chatReplyFrom(
      {
        reply: 'Descansá hoy.',
        proposals: [
          { type: 'rest_today', week: null, session_id: null, to: null, factor: null, kind: null, reason: 'Te duele.' },
          { type: 'today_kind', week: null, session_id: null, to: null, factor: null, kind: 'duration', reason: 'Contradice.' },
          { type: 'move_session', week: MONDAY, session_id: 'long', to: addDays(MONDAY, 6), factor: null, kind: null, reason: 'Más margen.' },
        ],
      },
      ctx,
      'a1',
      5,
    );
    expect(m.role === 'assistant' && m.proposals.map((p) => p.action.type)).toEqual(['rest_today', 'move_session']);
    expect(() => chatReplyFrom({ reply: '' }, ctx, 'a2', 5)).toThrow();
    expect(historyText(m)).toContain('[Proposed: Today: rest day 🛌 (not decided); Long walk: Sat → Sun (not decided)]');
  });
});

describe('what the chat sends', () => {
  it('today, this week so far and the plan; the period only if shared', () => {
    const c = buildChatContext({
      today: WED,
      now: new Date(2026, 10, 25, 7, 5),
      todayGoal: ctx.todayGoal,
      todayProgress: { value: 1200, target: 5000, fraction: 0.24, done: false },
      todayNotes: ['This week: 30 km.', 'Light week: your period.'],
      todayRecovery: false,
      plan: { ...plan, volume: volume(22, { light: 'period' }) },
      nextPlan: null,
      days: new Map(),
      doneKm: 12.04,
      recentWeeksKm: [25, 26, 27, 28],
      streak: { current: 4, longest: 9, freezes: 1, restLeftThisWeek: 1 },
      settings,
      nextPeriodStart: '2026-12-20',
    });
    expect(c.now).toBe('2026-11-25 Wed 07:05');
    expect(c.today).toMatchObject({ goal: 'Walk 5 km (or ride 15 km)', progress: '1.2 km of 5 km', done: false });
    expect(c.thisWeek.days.map((d) => d.weekday)).toEqual(['Mon', 'Tue']);
    expect(c.thisWeek.freeDays).toEqual([WED, addDays(MONDAY, 3), addDays(MONDAY, 4), addDays(MONDAY, 6)]);
    expect(c.thisWeek.sessions.find((s) => s.id === 'brisk')?.movable).toBe(false);
    expect(JSON.stringify(c)).not.toMatch(/period/i);
  });
});
