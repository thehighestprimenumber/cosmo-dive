import type { SQLiteDatabase } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import type Anthropic from '@anthropic-ai/sdk';
import { loadCoachRecord, loadWeekPlan, saveCoachRecord, saveWeekPlan } from '../data/db';
import {
  applyProposal,
  buildReviewInput,
  MAX_PROPOSALS,
  REVIEW_SCHEMA,
  reviewFrom,
  undoProposal,
  type CoachRecord,
  type CoachReview,
  type ReviewInput,
} from '../domain/coach';
import { normalizePlan } from '../domain/plan';
import type { DateKey, Settings } from '../domain/types';
import type { Snapshot } from './sync';

const KEY_NAME = 'anthropic-api-key';
export const COACH_MODEL = 'claude-opus-5-5';

// ---- the API key: only in Android's encrypted storage, never in the database or a backup ----

export const getApiKey = () => SecureStore.getItemAsync(KEY_NAME).catch(() => null);
export const setApiKey = (key: string) => SecureStore.setItemAsync(KEY_NAME, key.trim());
export const deleteApiKey = () => SecureStore.deleteItemAsync(KEY_NAME);

const SYSTEM = `You are the walking coach inside Daily Spark, a personal app for one person (the walker) who walks, and sometimes bikes or kayaks, with a Galaxy Watch. The walker's job has very irregular hours, so rest days are flexible.

Every Sunday evening you review the week that is ending and look at next week's plan, which the app's rules already made: weekly km grow at most 10% a week toward the walker's goal, with a light week every 4th week or during their period, a long walk and a brisk walk as key sessions, and taper before a dated goal. Those rules are sound; your job is judgement on top of them, not a new plan.

What you can propose (at most ${MAX_PROPOSALS}, and none if the plan already fits):
- move_session: move one of next week's key sessions (by id) to one of next week's free days. Use it when this week's pattern (e.g. which days they actually managed a long walk) suggests a better day.
- scale_week: change next week's km by a factor. Below 1 when the week looks like too much (missed days, low readiness, a long run of hard weeks). Above 1 only if they are clearly ahead; the app caps it at nextWeek.maxKm anyway.
The app checks and may cap each proposal, and the walker decides whether to apply it. Don't propose anything else, and don't describe changes you can't propose as if they would happen.

Write in Rioplatense Spanish (voseo), warm and direct, like a coach who knows them; address them directly with vos and avoid gendered adjectives. Be specific: name days, km and sessions from the data. No medical advice beyond common sense; if something looks like pain or illness, suggest rest and seeing someone. Keep the summary to 2–4 short sentences and each reason to one or two.`;

/** The SDK is loaded only when the coach is used, so it can never slow down or break app start. */
const loadSdk = async (): Promise<typeof Anthropic> => (await import('@anthropic-ai/sdk')).default;

/**
 * One request to Claude, answered as JSON matching `schema`. Throws on
 * network, auth or refusal problems.
 */
export async function askClaude(opts: {
  apiKey: string;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<{ json: unknown; model: string }> {
  const Sdk = await loadSdk();
  const client = new Sdk({
    apiKey: opts.apiKey,
    maxRetries: 2,
    timeout: 120_000,
    ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}),
  });
  const response = await client.beta.messages.create({
    model: COACH_MODEL,
    max_tokens: 16000,
    // If the model declines, the API retries on a fallback model in the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: opts.schema } },
    system: opts.system,
    messages: opts.messages,
  });
  if (response.stop_reason === 'refusal') throw new Error('The coach couldn’t answer this time.');
  if (response.stop_reason === 'max_tokens') throw new Error('The coach’s answer was cut off.');
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('The coach sent an empty answer.');
  return { json: JSON.parse(text.text), model: response.model };
}

/** One request to Claude for this week's review. */
export function requestReview(apiKey: string, input: ReviewInput, fetchImpl?: typeof fetch) {
  return askClaude({
    apiKey,
    system: SYSTEM,
    schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
    messages: [{ role: 'user', content: `Here is the data (JSON):\n${JSON.stringify(input)}` }],
    fetchImpl,
  });
}

/** Human-readable error for the app (no raw stack traces). */
export async function coachErrorMessage(e: unknown): Promise<string> {
  const Anthropic = await loadSdk().catch(() => null);
  if (!Anthropic) return e instanceof Error ? e.message : String(e);
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in Settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key can’t use the model.';
  if (e instanceof Anthropic.RateLimitError) return 'Too many requests right now. Try again later.';
  if (e instanceof Anthropic.APIConnectionError) return 'No connection to the coach. Check your internet.';
  if (e instanceof Anthropic.APIError) return `The coach service had a problem (${e.status ?? 'error'}).`;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Ask for the review of the week ending now (planning next week). Stores the
 * review, or the failed attempt. Needs next week's plan (Sunday evening on).
 */
export async function runWeeklyReview(
  db: SQLiteDatabase,
  snap: Snapshot,
  settings: Settings,
  now = Date.now(),
): Promise<CoachRecord> {
  const nextPlan = snap.nextPlan;
  if (!nextPlan?.volume) throw new Error('Next week’s plan appears on Sunday evening.');
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('Add your Claude API key in Settings first.');
  const input = buildReviewInput({
    today: snap.today,
    plan: snap.plan,
    nextPlan,
    days: snap.days,
    doneKm: snap.week.doneKm,
    recentWeeksKm: snap.week.recentWeeksKm,
    streak: { current: snap.streak.current, longest: snap.streak.longest, freezes: snap.streak.freezes },
    settings,
    nextPeriodStart: snap.cycle?.next?.start ?? null,
    feelings: snap.feelings,
  });
  let record: CoachRecord;
  try {
    const { json, model } = await requestReview(apiKey, input);
    record = { ok: true, review: reviewFrom(json, nextPlan, snap.week.doneKm, now, model) };
  } catch (e) {
    const prev = await loadCoachRecord(db, nextPlan.week);
    record = {
      ok: false,
      week: nextPlan.week,
      error: await coachErrorMessage(e),
      attempts: (prev && !prev.ok ? prev.attempts : 0) + 1,
      lastAttempt: now,
    };
  }
  await saveCoachRecord(db, nextPlan.week, record);
  return record;
}

/** Apply or undo one proposal on its week's saved plan; marks it in the review. */
export async function setProposal(
  db: SQLiteDatabase,
  review: CoachReview,
  proposalId: string,
  to: 'applied' | 'dismissed' | 'pending',
  today: DateKey,
  todayDone: boolean,
): Promise<{ review: CoachReview; error?: string }> {
  const p = review.proposals.find((x) => x.id === proposalId);
  if (!p) return { review };
  let from = p.from;
  if (to === 'applied' || (to === 'pending' && p.status === 'applied')) {
    const saved = await loadWeekPlan(db, review.week);
    if (!saved) return { review, error: 'That week’s plan is gone.' };
    const plan = normalizePlan(saved);
    if (to === 'applied') {
      const r = applyProposal(plan, p, today, todayDone);
      if (!r) return { review, error: 'This change doesn’t fit the plan anymore (a day passed or is taken).' };
      await saveWeekPlan(db, r.plan);
      from = r.from;
    } else {
      const undone = undoProposal(plan, p, today, todayDone);
      if (!undone) return { review, error: 'This can’t be undone anymore (that day passed or is taken).' };
      await saveWeekPlan(db, undone);
    }
  }
  const next: CoachReview = {
    ...review,
    proposals: review.proposals.map((x) => (x.id === proposalId ? { ...x, status: to, ...(from ? { from } : {}) } : x)),
  };
  await saveCoachRecord(db, review.week, { ok: true, review: next });
  return { review: next };
}
