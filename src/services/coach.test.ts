import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock('../data/db', () => ({}));

const { coachErrorMessage, COACH_MODEL, requestReview } = await import('./coach');

const answer = { summary: 'Buena semana.', tip: null, proposals: [] };

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}

const message = (text: string, stop = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: COACH_MODEL,
  content: [{ type: 'text', text }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

describe('the Claude request', () => {
  it('asks for structured JSON with refusal fallbacks, and parses the answer', async () => {
    const { f, calls } = fakeFetch(200, message(JSON.stringify(answer)));
    const r = await requestReview('sk-ant-test', { today: '2026-11-29' } as never, f);
    expect(r.json).toEqual(answer);
    const c = calls[0];
    expect(c.url).toContain('/v1/messages');
    expect(c.headers.get('authorization')).toBe('Bearer sk-ant-test');
    expect(c.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(c.body).toMatchObject({
      model: COACH_MODEL,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    expect(String((c.body.messages as { content: string }[])[0].content)).toContain('2026-11-29');
  });

  it('turns refusals and bad keys into plain messages', async () => {
    await expect(requestReview('k', {} as never, fakeFetch(200, message('', 'refusal')).f)).rejects.toThrow(/couldn’t answer/);
    const bad = fakeFetch(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    const err = await requestReview('k', {} as never, bad.f).catch((e) => e);
    expect(await coachErrorMessage(err)).toMatch(/API key was rejected/);
  });
});
