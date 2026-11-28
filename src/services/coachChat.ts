import type { SQLiteDatabase } from 'expo-sqlite';
import { loadChat, loadWeekPlan, saveChatMessage, saveSettings, saveWeekPlan } from '../data/db';
import { applyProposal, undoProposal, type CoachProposal } from '../domain/coach';
import {
  buildChatContext,
  CHAT_HISTORY,
  CHAT_SCHEMA,
  CHECKIN_SCHEMA,
  chatReplyFrom,
  historyText,
  MAX_CHAT_PROPOSALS,
  type ChatCheckContext,
  type ChatMessage,
  type ChatProposal,
} from '../domain/coachChat';
import { checkinReasons } from '../domain/checkin';
import { addDays } from '../domain/dates';
import { normalizePlan } from '../domain/plan';
import { STRENGTH_ROUTINE } from '../domain/strength';
import type { RegularKind, Settings } from '../domain/types';
import { askClaude, coachErrorMessage, getApiKey } from './coach';
import type { Snapshot } from './sync';

const SYSTEM = `You are the walking coach inside Daily Spark, a personal app for one person (the walker) who walks, and sometimes bikes or kayaks, with a Galaxy Watch. The walker's job has very irregular hours, so rest days are flexible. This is a chat: they tell you what the data can't show (a long shift, soreness, little time, how they feel) and you help.

The app's rules already make a sound plan: weekly km grow at most 10% a week toward their goal, light weeks every 4th week or with their period, a long walk and a brisk walk as key sessions, a recovery day after a very big day. Each message comes with the current data as JSON. Your job is judgement and encouragement on top of the plan, not a new plan.

Changes you can propose (at most ${MAX_CHAT_PROPOSALS} per answer, only when they help; often none):
- rest_today: today becomes a rest day that doesn't use one of their weekly rest days (and today's key session moves on). For pain, illness, exhaustion, or a day with no room at all.
- today_kind: switch today's goal to distance, duration or hr_zone (kind), and/or make it lighter with factor (0.3–1 of today's share; e.g. 0.4 when they ask for something short and easy). Use the factor whenever they ask for less, not only a different type. A day you adjust is always an easy one: heart-rate goals become zone 2.
- period_started: their period started on a day (to = YYYY-MM-DD, today or up to 10 days ago). Records it like the Week tab's "My period started today": the week with most of it becomes the light week (25% less, zone 2, no pace push). Propose it whenever they mention their period started and it isn't recorded; prefer it over scale_week for that.
- move_session: move a key session (session id, week = its Monday) to a free day of that week.
- scale_week: change a week's km by a factor (week = its Monday). This week: only lighter. Next week (exists from Sunday evening): lighter, or slightly more if they're clearly ahead.
The app checks every proposal, may cap it, and the walker decides with a tap. Never say a change is done: say you're proposing it. Don't promise anything else (you can't change goals directly, rest-day counts, the aim or the trek goal; suggest they do it in Settings or the Week tab if needed).

Strength is part of the goal twice a week (from Tuesday, then from Friday; never the day after one, nor on long-walk or recovery days): 30 min (20 on light days) of lower body, upper body or full body, in turns. The walker builds the routine in another app; it's done when they tick it or a strength workout reaches Health Connect. A day with strength isn't complete without it, unless they move 2× the walking goal (then the strength moves on to the next days); if they can't, rest_today frees the day. The app's own 10-minute strength & mobility routine for the trail (optional): ${STRENGTH_ROUTINE.map((e) => `${e.name} (${e.dose})`).join('; ')}. If they ask how to do one, explain the technique step by step with the key safety cues and an easier version, and suggest the "Ver cómo se hace" video link in the app; for pain or an old injury, a physio.

Write in Rioplatense Spanish (voseo), warm and direct, gender-neutral (avoid gendered adjectives). Be brief and concrete, with days and km from the data. No diagnosis: for pain that is sharp, lasting, or with swelling, suggest stopping and seeing a professional. If they just chat, just chat.`;

/** What the rules check proposals against, from the latest sync. */
function checkContext(snap: Snapshot, settings: Settings): ChatCheckContext {
  return {
    today: snap.today,
    todayDone: !!snap.todayProgress?.done,
    todayGoal: snap.todayGoal,
    todayRecovery: snap.todayRecovery,
    plan: snap.plan,
    nextPlan: snap.nextPlan,
    doneKm: snap.week.doneKm,
    periodStarts: settings.periodStarts,
  };
}

function contextFor(snap: Snapshot, settings: Settings, now: Date) {
  return buildChatContext({
    today: snap.today,
    now,
    todayGoal: snap.todayGoal,
    todayProgress: snap.todayProgress,
    todayNotes: snap.todayNotes,
    todayRecovery: snap.todayRecovery,
    plan: snap.plan,
    nextPlan: snap.nextPlan,
    days: snap.days,
    doneKm: snap.week.doneKm,
    recentWeeksKm: snap.week.recentWeeksKm,
    streak: {
      current: snap.streak.current,
      longest: snap.streak.longest,
      freezes: snap.streak.freezes,
      restLeftThisWeek: snap.streak.restLeftThisWeek,
    },
    settings,
    nextPeriodStart: snap.cycle?.next?.start ?? null,
    feelings: snap.feelings,
    strengthThisWeek: snap.strength.thisWeek.length,
    strengthToday: snap.strength.target
      ? { ...snap.strength.target, done: snap.strength.today, partOfTheGoal: true }
      : null,
    busyDays: snap.busyDays,
    forecast: snap.weather.forecast,
  });
}

/** Recent conversation as API messages (must start with the walker). */
function historyMessages(history: ChatMessage[], n: number) {
  const recent = history.filter((m) => !(m.role === 'assistant' && m.error)).slice(-n);
  while (recent.length && recent[0].role !== 'user') recent.shift();
  return recent.map((m) => ({ role: m.role, content: historyText(m) }));
}

const newId = (now: number) => `${now}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Send a message: saves it, asks Claude with the recent conversation plus
 * today's data, saves and returns the answer (or an error bubble).
 */
export async function sendChat(
  db: SQLiteDatabase,
  text: string,
  snap: Snapshot,
  settings: Settings,
  now = new Date(),
  fetchImpl?: typeof fetch,
): Promise<ChatMessage[]> {
  const t = now.getTime();
  const user: ChatMessage = { id: newId(t), role: 'user', text: text.trim(), at: t };
  await saveChatMessage(db, user);
  const history = (await loadChat(db)).filter((m) => !(m.role === 'assistant' && m.error));
  let answer: ChatMessage;
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('Add your Claude API key in Settings first.');
    const context = contextFor(snap, settings, now);
    const past = historyMessages(history.filter((m) => m.id !== user.id), CHAT_HISTORY - 1);
    const messages = [
      ...past,
      { role: 'user' as const, content: `Current data (JSON):\n${JSON.stringify(context)}\n\nMessage:\n${user.text}` },
    ];
    const { json } = await askClaude({ apiKey, system: SYSTEM, schema: CHAT_SCHEMA as unknown as Record<string, unknown>, messages, fetchImpl, db, purpose: 'chat' });
    answer = chatReplyFrom(json, checkContext(snap, settings), newId(t + 1), t + 1);
  } catch (e) {
    answer = { id: newId(t + 1), role: 'assistant', text: await coachErrorMessage(e), proposals: [], at: t + 1, error: true };
  }
  await saveChatMessage(db, answer);
  return [...history.filter((m) => !(m.role === 'assistant' && m.error)), answer];
}

export type ChatDecision = {
  message: ChatMessage;
  error?: string;
  /** What the app should do next: re-sync, maybe with today's goal redone or a goal type picked. */
  refresh?: { regenerateToday?: boolean; todayKind?: RegularKind };
  settingsPatch?: Partial<Settings>;
};

/** Apply, skip or undo one proposal from a chat answer. */
export async function decideChatProposal(
  db: SQLiteDatabase,
  message: Extract<ChatMessage, { role: 'assistant' }>,
  proposalId: string,
  to: 'applied' | 'dismissed' | 'pending',
  snap: Snapshot,
  settings: Settings,
): Promise<ChatDecision> {
  const p = message.proposals.find((x) => x.id === proposalId);
  if (!p || p.status === to) return { message };
  const a = p.action;
  const today = snap.today;
  const todayDone = !!snap.todayProgress?.done;
  const result: ChatDecision = { message };
  let from = p.from;

  if (to === 'applied' || p.status === 'applied') {
    const undo = to !== 'applied';
    if (a.type === 'period_started') {
      const starts = settings.periodStarts.filter((d) => d !== a.date);
      result.settingsPatch = { periodStarts: undo ? starts : [...starts, a.date].sort().slice(-24) };
      result.refresh = { regenerateToday: true };
    } else if (a.type === 'rest_today' || a.type === 'today_kind') {
      if (a.date !== today) return { message, error: 'That was for another day.' };
      if (todayDone) return { message, error: 'Today’s goal is already done.' };
      if (a.type === 'rest_today') {
        result.settingsPatch = { coachRestDay: undo ? null : { date: today, reason: p.reason } };
        result.refresh = { regenerateToday: true };
      } else if (undo) {
        // Back to the plan's goal for today.
        result.settingsPatch = { coachToday: null };
        result.refresh = { regenerateToday: true };
      } else {
        // Another goal type and/or a lighter goal; it also ends a coach rest day.
        result.settingsPatch = {
          // Stored even at full size: a day the coach adjusted is an easy one (zone 2).
          coachToday: { date: today, factor: a.factor ?? 1, reason: p.reason },
          ...(settings.coachRestDay?.date === today ? { coachRestDay: null } : {}),
        };
        result.refresh = { regenerateToday: true, ...(a.kind ? { todayKind: a.kind } : {}) };
      }
    } else {
      const saved = await loadWeekPlan(db, a.week);
      if (!saved) return { message, error: 'That week’s plan is gone.' };
      const plan = normalizePlan(saved);
      // Same moves as the Sunday review.
      const asReview: CoachProposal = {
        ...p,
        action: a.type === 'move_session' ? { type: 'move_session', sessionId: a.sessionId, to: a.to } : { type: 'scale_week', factor: a.factor },
      };
      if (undo) {
        const back = undoProposal(plan, asReview, today, todayDone);
        if (!back) return { message, error: 'This can’t be undone anymore (that day passed or is taken).' };
        await saveWeekPlan(db, back);
      } else {
        const r = applyProposal(plan, asReview, today, todayDone);
        if (!r) return { message, error: 'This change doesn’t fit the plan anymore.' };
        await saveWeekPlan(db, r.plan);
        from = r.from;
      }
      result.refresh = { regenerateToday: a.week === snap.plan.week };
    }
  }
  if (result.settingsPatch) await saveSettings(db, result.settingsPatch);
  const next: ChatMessage = {
    ...message,
    proposals: message.proposals.map((x): ChatProposal => (x.id === proposalId ? { ...x, status: to, ...(from ? { from } : {}) } : x)),
  };
  await saveChatMessage(db, next);
  return { ...result, message: next };
}

const CHECKIN_PROMPT = `This is your morning check-in, not a message from the walker: they'll get it as a notification. It runs only on days when something stands out (reasons below). Write 1–3 short sentences for today, and propose a change only if it clearly helps. If nothing useful needs saying (e.g. a follow-up that doesn't matter today), set worth_sending to false.`;

/**
 * The morning check-in: on days when something stands out, the coach writes
 * first (saved in the chat, with proposals to apply). Returns the message, or
 * null on an ordinary day / nothing worth sending / an error.
 */
export async function runDailyCheckin(
  db: SQLiteDatabase,
  snap: Snapshot,
  settings: Settings,
  now = new Date(),
  fetchImpl?: typeof fetch,
): Promise<Extract<ChatMessage, { role: 'assistant' }> | null> {
  const history = await loadChat(db);
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  const reasons = checkinReasons({
    today: snap.today,
    todayRecovery: snap.todayRecovery,
    todayReadiness: snap.todayReadiness,
    days: snap.days,
    weekPlannedKm: snap.week.volume.km,
    weekDoneKm: snap.week.doneKm,
    restLeftThisWeek: snap.streak.restLeftThisWeek,
    streak: snap.streak.current,
    lastUserMessageAt: lastUser?.at ?? null,
    yesterdayFelt: snap.feelings[addDays(snap.today, -1)] ?? null,
    now,
  });
  if (!reasons.length || snap.todayProgress?.done) return null;
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  try {
    const context = contextFor(snap, settings, now);
    const { json } = await askClaude({
      apiKey,
      system: SYSTEM,
      schema: CHECKIN_SCHEMA as unknown as Record<string, unknown>,
      db,
      purpose: 'checkin',
      messages: [
        ...historyMessages(history, 10),
        {
          role: 'user',
          content: `${CHECKIN_PROMPT}\n\nWhy today:\n- ${reasons.join('\n- ')}\n\nCurrent data (JSON):\n${JSON.stringify(context)}`,
        },
      ],
      fetchImpl,
    });
    if ((json as { worth_sending?: unknown })?.worth_sending === false) return null;
    const t = now.getTime();
    const m = chatReplyFrom(json, checkContext(snap, settings), newId(t), t);
    if (m.role !== 'assistant') return null;
    const message = { ...m, checkin: true };
    await saveChatMessage(db, message);
    return message;
  } catch {
    return null; // a missed check-in is fine
  }
}

const CONGRATS_PROMPT = `The walker just completed today's goal. This is not a message from them: they'll get your words as a notification. Write 1–2 short, warm, specific sentences of congratulations (use the numbers: how much, how far over the goal, the streak, the week so far). No proposals. Set worth_sending to true.`;

/**
 * When today's goal is completed: a short congratulation from the coach,
 * saved in the chat. Null when the coach is off, there's no key, or on error.
 */
export async function runCongrats(
  db: SQLiteDatabase,
  snap: Snapshot,
  settings: Settings,
  now = new Date(),
  fetchImpl?: typeof fetch,
): Promise<Extract<ChatMessage, { role: 'assistant' }> | null> {
  if (!snap.todayProgress?.done) return null;
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  try {
    const history = await loadChat(db);
    const context = contextFor(snap, settings, now);
    const { json } = await askClaude({
      apiKey,
      system: SYSTEM,
      schema: CHECKIN_SCHEMA as unknown as Record<string, unknown>,
      db,
      purpose: 'congrats',
      messages: [
        ...historyMessages(history, 6),
        { role: 'user', content: `${CONGRATS_PROMPT}\n\nCurrent data (JSON):\n${JSON.stringify(context)}` },
      ],
      fetchImpl,
    });
    const t = now.getTime();
    const m = chatReplyFrom({ ...(json as object), proposals: [] }, checkContext(snap, settings), newId(t), t);
    if (m.role !== 'assistant') return null;
    const message = { ...m, congrats: true };
    await saveChatMessage(db, message);
    return message;
  } catch {
    return null; // the plain notification goes out instead
  }
}
