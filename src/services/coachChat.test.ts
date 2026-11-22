import { describe, expect, it, vi } from 'vitest';
import { loadChat, migrate } from '../data/db';
import { addDays, startOfDay } from '../domain/dates';
import { DEFAULT_SETTINGS, type Activity, type Settings } from '../domain/types';
import type { ActivitySource } from '../sources/ActivitySource';
import { fakeDb } from '../test/fakeDb';
import { refresh } from './sync';

vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => 'sk-ant-test'), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));

const { decideChatProposal, sendChat } = await import('./coachChat');

const MON = '2026-11-23';
const WED = addDays(MON, 2);
const at = (day: string, hour: number) => {
  const d = startOfDay(day);
  d.setHours(hour);
  return d;
};
const walk = (date: string, km: number): Activity => {
  const start = startOfDay(date).getTime() + 9 * 3_600_000;
  return { id: date, sport: 'walk', start, end: start + km * 720_000, durationS: km * 720, distanceM: km * 1000, hr: [], origin: 't' };
};
// 4 weeks of ~24 km, then 5 km on Monday and Tuesday of this week (both goals met).
const history = [
  ...Array.from({ length: 28 }, (_, i) => addDays(MON, -28 + i))
    .filter((_, i) => i % 7 < 6)
    .map((d) => walk(d, 4)),
  walk(MON, 5),
  walk(addDays(MON, 1), 5),
];
const source: ActivitySource = {
  name: 'test',
  status: async () => ({ state: 'ready' }),
  requestAccess: async () => true,
  getActivities: async (from, to) => history.filter((a) => a.start >= from.getTime() && a.start < to.getTime()),
};
const base: Settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-16', restDaysPerWeek: 1, onboarded: true, coachEnabled: true };

function claudeSays(json: unknown) {
  const bodies: Record<string, unknown>[] = [];
  const f = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify(json) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { f, bodies };
}

describe('coach chat', () => {
  it('a sore leg: the coach proposes rest, you apply it, today becomes a free rest day; undo brings the goal back', async () => {
    const db = fakeDb();
    await migrate(db);
    let settings = { ...base };
    let snap = await refresh(db, source, settings, { now: at(WED, 8) });
    expect(snap.todayRecovery).toBe(false);

    const { f, bodies } = claudeSays({
      reply: 'Si te duele, hoy descansá.',
      proposals: [{ type: 'rest_today', week: null, session_id: null, to: null, factor: null, kind: null, reason: 'Te duele la pierna.' }],
    });
    const msgs = await sendChat(db, 'Me duele un poco la pierna', snap, settings, at(WED, 8), f);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    const sent = bodies[0].messages as { role: string; content: string }[];
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain('Current data (JSON)');
    expect(sent[0].content).toContain('Me duele un poco la pierna');

    const answer = msgs[1];
    if (answer.role !== 'assistant') throw new Error();
    const d = await decideChatProposal(db, answer, answer.proposals[0].id, 'applied', snap, settings);
    expect(d.settingsPatch).toEqual({ coachRestDay: { date: WED, reason: 'Te duele la pierna.' } });
    settings = { ...settings, ...d.settingsPatch };
    snap = await refresh(db, source, settings, { now: at(WED, 9), ...d.refresh });
    expect(snap.todayRecovery).toBe(true);
    expect(snap.todayNotes[0]).toContain('agreed with the coach: Te duele la pierna.');
    // Resting today costs no rest day.
    const thu = await refresh(db, source, settings, { now: at(addDays(WED, 1), 9) });
    expect(thu.days.get(MON)?.status).toBe('done');
    expect(thu.days.get(WED)?.status).toBe('rest');
    expect(thu.streak.restLeftThisWeek).toBe(1);

    const stored = (await loadChat(db))[1];
    expect(stored.role === 'assistant' && stored.proposals[0].status).toBe('applied');
  });

  it('undoing the rest day gives today a normal goal again', async () => {
    const db = fakeDb();
    await migrate(db);
    let settings = { ...base };
    let snap = await refresh(db, source, settings, { now: at(WED, 8) });
    const { f } = claudeSays({
      reply: 'Ok.',
      proposals: [{ type: 'rest_today', week: null, session_id: null, to: null, factor: null, kind: null, reason: 'Cansancio.' }],
    });
    const [, answer] = await sendChat(db, 'Estoy muy cansade', snap, settings, at(WED, 8), f);
    if (answer.role !== 'assistant') throw new Error();
    const applied = await decideChatProposal(db, answer, answer.proposals[0].id, 'applied', snap, settings);
    settings = { ...settings, ...applied.settingsPatch };
    snap = await refresh(db, source, settings, { now: at(WED, 9), ...applied.refresh });
    if (applied.message.role !== 'assistant') throw new Error();
    const undone = await decideChatProposal(db, applied.message, answer.proposals[0].id, 'pending', snap, settings);
    expect(undone.settingsPatch).toEqual({ coachRestDay: null });
    settings = { ...settings, ...undone.settingsPatch };
    snap = await refresh(db, source, settings, { now: at(WED, 10), ...undone.refresh });
    expect(snap.todayRecovery).toBe(false);
  });

  it('a failed request shows as an error bubble and isn’t sent back next time', async () => {
    const db = fakeDb();
    await migrate(db);
    const snap = await refresh(db, source, base, { now: at(WED, 8) });
    const down = (async () => new Response('{"type":"error","error":{"type":"api_error","message":"x"}}', { status: 500 })) as typeof fetch;
    const msgs = await sendChat(db, 'Hola', snap, base, at(WED, 8), down);
    expect(msgs.at(-1)).toMatchObject({ role: 'assistant', error: true });
    const { f, bodies } = claudeSays({ reply: 'Hola!', proposals: [] });
    await sendChat(db, '¿Estás?', snap, base, at(WED, 8), f);
    const sent = bodies[0].messages as { role: string }[];
    expect(sent.map((m) => m.role)).toEqual(['user', 'user']);
  });
});
