import { checkAction, type CoachAction, type ProposalStatus } from './coach';
import { addDays, daysBetween } from './dates';
import { formatValue, goalTitle } from './format';
import { freeDays, isMovable, sessionById, sessionOn, type SessionKind, type WeekPlan } from './plan';
import type { DateKey, DayStatus, GoalEvent, GoalMeta, GoalSpec, Progress, RegularKind, Settings } from './types';
import { MIN_FACTOR } from './coach';

/**
 * The coach chat: you tell it what the data can't know (a long shift, a sore
 * calf, a busy week) and it answers with advice plus changes you can apply.
 * Same idea as the Sunday review: it only proposes, the rules check.
 */

export type ChatAction =
  | { type: 'move_session'; week: DateKey; sessionId: string; to: DateKey }
  | { type: 'scale_week'; week: DateKey; factor: number }
  /** Your period started on this day (records it, like "My period started today": the light week follows). */
  | { type: 'period_started'; date: DateKey }
  /** Today becomes a rest day agreed with the coach (doesn't use a rest day). */
  | { type: 'rest_today'; date: DateKey }
  /**
   * Today's goal: another type (as with the chips on Today) and/or lighter
   * (factor 0.3–1, e.g. 0.4 for a short easy day). kind null = same type.
   */
  | { type: 'today_kind'; date: DateKey; kind: RegularKind | null; factor?: number };

export type ChatProposal = {
  id: string;
  action: ChatAction;
  reason: string;
  change: string;
  adjusted?: string;
  status: ProposalStatus;
  from?: DateKey;
};

export type ChatMessage =
  | { id: string; role: 'user'; text: string; at: number }
  | {
      id: string;
      role: 'assistant';
      text: string;
      proposals: ChatProposal[];
      at: number;
      error?: boolean;
      /** A morning check-in the coach started (not an answer). */
      checkin?: boolean;
    };

/** Messages sent back to the model (older ones are kept on the phone but not sent). */
export const CHAT_HISTORY = 20;
export const MAX_CHAT_PROPOSALS = 2;
/** The coach can make today's goal as light as 30% of the day's share (less than that: rest today). */
export const MIN_TODAY_FACTOR = 0.3;

const weekdayOf = (d: DateKey) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T12:00:00').getDay()];

const KIND_LABEL: Record<RegularKind, string> = { distance: 'Distance', duration: 'Time', hr_zone: 'Heart rate' };
const SESSION_NAME: Record<SessionKind, string> = {
  long_walk: 'Long walk',
  back_to_back: 'Long walk, day 2',
  brisk_walk: 'Brisk walk',
  trek_day: 'Trek day',
};

// ---------- what the coach sees ----------

type DayLike = { date: DateKey; goal: GoalSpec | null; value: number; done: boolean; status: DayStatus; meta?: GoalMeta };

export type ChatContextInput = {
  today: DateKey;
  now: Date;
  todayGoal: GoalSpec | null | undefined;
  todayProgress: Progress | null;
  todayNotes: string[];
  todayRecovery: boolean;
  plan: WeekPlan;
  nextPlan: WeekPlan | null;
  days: Map<DateKey, DayLike>;
  doneKm: number;
  recentWeeksKm: number[];
  streak: { current: number; longest: number; freezes: number; restLeftThisWeek: number };
  settings: Settings;
  nextPeriodStart?: DateKey | null;
  /** Your 1–10 ratings of key sessions, by day. */
  feelings?: Record<DateKey, number>;
  strengthThisWeek?: number;
  /** Work days from your calendar (this week and next). */
  busyDays?: DateKey[];
  /** The next days' forecast, if a town is set. */
  forecast?: { date: DateKey; rainChance: number; rainMm: number; tempMax: number; windMax: number }[];
};

const weekView = (p: WeekPlan, today: DateKey, share: boolean) => {
  const v = p.volume;
  return {
    monday: p.week,
    plannedKm: v?.km ?? null,
    weekType: !v
      ? 'normal'
      : v.eventWeek
        ? 'event'
        : v.preEvent
          ? 'pre_event'
          : v.light
            ? v.light === 'period' && share
              ? 'light_period'
              : 'light'
            : v.backToBack
              ? 'back_to_back'
              : 'normal',
    alreadyChangedByCoach: !!p.coach,
    sessions: p.sessions
      .filter((s) => !s.dropped)
      .map((s) => ({ id: s.id, kind: s.kind, day: s.day, weekday: weekdayOf(s.day), movable: isMovable(s) && s.day >= today })),
    freeDays: Array.from({ length: 7 }, (_, i) => addDays(p.week, i)).filter(
      (d) => d >= today && !p.sessions.some((s) => s.day === d && !s.dropped),
    ),
  };
};

export function buildChatContext(i: ChatContextInput) {
  const { today, settings, plan } = i;
  const share = settings.coachShareCycle;
  const ev = settings.event;
  return {
    now: `${today} ${weekdayOf(today)} ${String(i.now.getHours()).padStart(2, '0')}:${String(i.now.getMinutes()).padStart(2, '0')}`,
    today: {
      goal: i.todayGoal ? goalTitle(i.todayGoal, settings) : null,
      goalType: i.todayGoal?.kind ?? null,
      progress: i.todayGoal && i.todayProgress ? `${formatValue(i.todayGoal, i.todayProgress.value)} of ${formatValue(i.todayGoal, i.todayProgress.target)}` : null,
      done: !!i.todayProgress?.done,
      recoveryDay: i.todayRecovery,
      keySession: sessionOn(plan, today)?.kind ?? null,
      whyThisGoal: i.todayNotes.filter((n) => share || !/period/i.test(n)),
    },
    thisWeek: {
      ...weekView(plan, today, share),
      doneKm: Math.round(i.doneKm * 10) / 10,
      days: Array.from({ length: 7 }, (_, k) => addDays(plan.week, k))
        .filter((d) => d < today)
        .map((date) => {
          const d = i.days.get(date);
          return {
            date,
            weekday: weekdayOf(date),
            goal: d?.goal ? goalTitle(d.goal, settings) : null,
            result: d?.goal ? formatValue(d.goal, d.value) : null,
            status: d?.status ?? 'none',
            readiness: d?.meta?.readiness ?? null,
            felt: i.feelings?.[date] ?? null,
          };
        }),
    },
    nextWeek: i.nextPlan ? weekView(i.nextPlan, today, share) : null,
    recentWeeksKm: i.recentWeeksKm,
    strengthSessionsThisWeek: i.strengthThisWeek ?? 0,
    workDays: (i.busyDays ?? []).filter((d) => d >= today),
    forecast: (i.forecast ?? []).slice(0, 8),
    streak: i.streak,
    restDaysPerWeek: settings.restDaysPerWeek,
    aimKmPerDay: settings.dailyTargetKm,
    event: ev ? { ...(ev as GoalEvent), weeksAway: Math.max(0, Math.floor(daysBetween(today, ev.date) / 7)) } : null,
    ...(share ? { nextPeriodStart: i.nextPeriodStart ?? null } : {}),
  };
}

// ---------- the safety rules ----------

export type ChatCheckContext = {
  today: DateKey;
  todayDone: boolean;
  todayGoal: GoalSpec | null | undefined;
  todayRecovery: boolean;
  plan: WeekPlan;
  nextPlan: WeekPlan | null;
  /** Km walked this week so far (caps how much harder next week may get). */
  doneKm: number;
  /** Period starts already recorded ("started today" taps). */
  periodStarts?: DateKey[];
};

export type ChatChecked = { ok: true; action: ChatAction; change: string; adjusted?: string } | { ok: false; why: string };

export function checkChatAction(a: ChatAction, c: ChatCheckContext): ChatChecked {
  switch (a.type) {
    case 'period_started': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || a.date > c.today || daysBetween(a.date, c.today) > 10) {
        return { ok: false, why: 'only a day in the last 10' };
      }
      if ((c.periodStarts ?? []).some((d) => Math.abs(daysBetween(d, a.date)) <= 3)) return { ok: false, why: 'already recorded' };
      return { ok: true, action: a, change: `Period started ${a.date === c.today ? 'today' : weekdayOf(a.date)}: light week` };
    }
    case 'rest_today':
      if (a.date !== c.today) return { ok: false, why: 'only today' };
      if (c.todayDone) return { ok: false, why: 'today is already done' };
      if (c.todayRecovery) return { ok: false, why: 'today is already a rest day' };
      return { ok: true, action: a, change: 'Today: rest day 🛌' };
    case 'today_kind': {
      if (a.date !== c.today) return { ok: false, why: 'only today' };
      if (c.todayDone) return { ok: false, why: 'today is already done' };
      if (a.kind != null && !['distance', 'duration', 'hr_zone'].includes(a.kind)) return { ok: false, why: 'unknown goal type' };
      const isKey = c.todayGoal?.kind === 'long_walk' || c.todayGoal?.kind === 'brisk_walk';
      if (a.kind == null && isKey) return { ok: false, why: 'pick a goal type to replace a key session' };
      const factor = a.factor != null && Number.isFinite(a.factor) ? Math.min(1, Math.max(MIN_TODAY_FACTOR, a.factor)) : null;
      const lighter = factor != null && factor < 0.97;
      if (!lighter && (a.kind == null || (c.todayGoal?.kind === a.kind && !c.todayRecovery))) {
        return { ok: false, why: 'nothing changes' };
      }
      const parts = [
        ...(a.kind ? [KIND_LABEL[a.kind]] : []),
        ...(lighter ? [`${Math.round((1 - factor!) * 100)}% lighter`] : []),
      ];
      return {
        ok: true,
        action: { type: 'today_kind', date: a.date, kind: a.kind, ...(lighter ? { factor: Math.round(factor! * 100) / 100 } : {}) },
        change: `Today’s goal: ${parts.join(', ')}`,
        ...(lighter && a.factor! < MIN_TODAY_FACTOR ? { adjusted: 'Kept at 30% of today’s share at least: for less, rest today.' } : {}),
      };
    }
    case 'move_session': {
      const plan = a.week === c.plan.week ? c.plan : a.week === c.nextPlan?.week ? c.nextPlan : null;
      if (!plan) return { ok: false, why: 'not this week or next' };
      const s = sessionById(plan, a.sessionId);
      if (!s || s.dropped || !isMovable(s) || s.day === a.to) return { ok: false, why: 'can’t move that session' };
      const firstDay = plan.week > c.today ? plan.week : c.today;
      if (s.day < c.today) return { ok: false, why: 'that session’s day has passed' };
      if (!freeDays(plan, firstDay, firstDay === c.today && c.todayDone, s.id).includes(a.to)) {
        return { ok: false, why: 'that day isn’t free' };
      }
      return { ok: true, action: a, change: `${SESSION_NAME[s.kind]}: ${weekdayOf(s.day)} → ${weekdayOf(a.to)}` };
    }
    case 'scale_week': {
      if (a.week === c.nextPlan?.week) {
        if (c.nextPlan.coach) return { ok: false, why: 'next week was already changed' };
        const r = checkAction({ type: 'scale_week', factor: a.factor }, c.nextPlan, c.doneKm);
        if (!r.ok) return r;
        return { ...r, action: { ...a, factor: (r.action as Extract<CoachAction, { type: 'scale_week' }>).factor } };
      }
      if (a.week !== c.plan.week) return { ok: false, why: 'not this week or next' };
      // This week: only lighter (it's already under way).
      const v = c.plan.volume;
      if (!v || c.plan.coach) return { ok: false, why: 'this week was already changed' };
      if (!Number.isFinite(a.factor) || a.factor >= 0.97) return { ok: false, why: 'this week can only get lighter' };
      const factor = Math.max(MIN_FACTOR, a.factor);
      const km = Math.round(v.km * factor * 2) / 2;
      return {
        ok: true,
        action: { ...a, factor: Math.round(factor * 100) / 100 },
        change: `This week: ${v.km} → ${km} km`,
        ...(factor !== a.factor ? { adjusted: `Kept at ${km} km: the coach doesn’t lighten a week below 60%.` } : {}),
      };
    }
  }
}

// ---------- reading the answer ----------

export const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Your answer to the walker. Short: 1–5 sentences.' },
    proposals: {
      type: 'array',
      description: `At most ${MAX_CHAT_PROPOSALS} changes for the walker to apply. Empty when none fits.`,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['move_session', 'scale_week', 'rest_today', 'today_kind', 'period_started'] },
          week: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'move_session / scale_week: the Monday of the week (YYYY-MM-DD).' },
          session_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          to: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'move_session: a free day, YYYY-MM-DD. period_started: the day it started, YYYY-MM-DD.' },
          factor: {
            anyOf: [{ type: 'number' }, { type: 'null' }],
            description: 'scale_week: e.g. 0.85 for 15% fewer km. today_kind: optional, today’s share × factor (0.3–1), e.g. 0.4 for a short easy day.',
          },
          kind: { anyOf: [{ type: 'string', enum: ['distance', 'duration', 'hr_zone'] }, { type: 'null' }] },
          reason: { type: 'string', description: 'Why, in one sentence.' },
        },
        required: ['type', 'week', 'session_id', 'to', 'factor', 'kind', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'proposals'],
  additionalProperties: false,
} as const;

/** The check-in answers like the chat, plus whether it's worth sending at all. */
export const CHECKIN_SCHEMA = {
  ...CHAT_SCHEMA,
  properties: {
    ...CHAT_SCHEMA.properties,
    worth_sending: { type: 'boolean', description: 'False when nothing useful needs saying today (then nothing is sent).' },
  },
  required: [...CHAT_SCHEMA.required, 'worth_sending'],
} as const;

type Raw = { type?: unknown; week?: unknown; session_id?: unknown; to?: unknown; factor?: unknown; kind?: unknown; reason?: unknown };
const str = (x: unknown) => (typeof x === 'string' && x ? x : null);

export function chatReplyFrom(raw: unknown, c: ChatCheckContext, id: string, at: number): ChatMessage {
  const r = (raw ?? {}) as { reply?: unknown; proposals?: unknown };
  const text = typeof r.reply === 'string' ? r.reply.trim() : '';
  if (!text) throw new Error('The coach sent an empty answer.');
  const proposals: ChatProposal[] = [];
  for (const p of (Array.isArray(r.proposals) ? r.proposals : []) as Raw[]) {
    if (proposals.length >= MAX_CHAT_PROPOSALS) break;
    const reason = str(p.reason)?.trim();
    if (!reason) continue;
    let action: ChatAction | null = null;
    if (p.type === 'rest_today') action = { type: 'rest_today', date: c.today };
    else if (p.type === 'period_started') action = { type: 'period_started', date: str(p.to) ?? c.today };
    else if (p.type === 'today_kind' && (str(p.kind) || typeof p.factor === 'number')) {
      action = {
        type: 'today_kind',
        date: c.today,
        kind: (str(p.kind) as RegularKind | null) ?? null,
        ...(typeof p.factor === 'number' ? { factor: p.factor } : {}),
      };
    }
    else if (p.type === 'move_session' && str(p.week) && str(p.session_id) && str(p.to)) {
      action = { type: 'move_session', week: p.week as string, sessionId: p.session_id as string, to: p.to as string };
    } else if (p.type === 'scale_week' && str(p.week) && typeof p.factor === 'number') {
      action = { type: 'scale_week', week: p.week as string, factor: p.factor };
    }
    if (!action) continue;
    // Contradicting pairs: rest today vs. another goal type today; two changes of the same thing.
    const clash = proposals.some(
      (x) =>
        (['rest_today', 'today_kind'].includes(x.action.type) && ['rest_today', 'today_kind'].includes(action.type)) ||
        (x.action.type === 'scale_week' && action.type === 'scale_week' && x.action.week === action.week) ||
        (x.action.type === 'move_session' && action.type === 'move_session' && x.action.sessionId === action.sessionId && x.action.week === action.week),
    );
    if (clash) continue;
    const checked = checkChatAction(action, c);
    if (!checked.ok) continue;
    proposals.push({
      id: `${id}-p${proposals.length + 1}`,
      action: checked.action,
      reason,
      change: checked.change,
      status: 'pending',
      ...(checked.adjusted ? { adjusted: checked.adjusted } : {}),
    });
  }
  return { id, role: 'assistant', text, proposals, at };
}

/** How a past message reads back to the model (with what happened to its proposals). */
export function historyText(m: ChatMessage): string {
  if (m.role === 'user') return m.text;
  const text = m.checkin ? `[Morning check-in you sent] ${m.text}` : m.text;
  if (!m.proposals.length) return text;
  const what = m.proposals.map((p) => `${p.change} (${p.status === 'pending' ? 'not decided' : p.status})`).join('; ');
  return `${text}\n[Proposed: ${what}]`;
}
