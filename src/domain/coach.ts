import { addDays, daysBetween } from './dates';
import { formatValue, goalTitle } from './format';
import { freeDays, isMovable, sessionById, type SessionKind, type WeekPlan } from './plan';
import type { DateKey, DayStatus, GoalEvent, GoalMeta, GoalSpec, Settings } from './types';
import { MAX_GROWTH, type WeekVolume } from './volume';

/**
 * The AI coach's weekly review. The coach only *proposes*; every proposal is
 * one of the changes you can also make by hand, checked against the plan's
 * safety rules here, and only applied when you tap Apply. Nothing here talks
 * to the network (see services/coach.ts).
 */

/** What the coach may propose: move a key session, or make next week lighter / a bit harder. */
export type CoachAction =
  | { type: 'move_session'; sessionId: string; to: DateKey }
  | { type: 'scale_week'; factor: number };

export type ProposalStatus = 'pending' | 'applied' | 'dismissed';

export type CoachProposal = {
  id: string;
  action: CoachAction;
  /** The coach's reason, in its words. */
  reason: string;
  /** Set when the safety rules changed what the coach asked for. */
  adjusted?: string;
  /** Before → after, e.g. "Long walk: Sat → Sun" or "Week: 32 → 28 km". */
  change: string;
  status: ProposalStatus;
  /** For undo: the day a moved session was on. */
  from?: DateKey;
};

export type CoachReview = {
  /** Monday of the week the review plans (next week, on Sunday evening). */
  week: DateKey;
  createdAt: number;
  summary: string;
  tip: string | null;
  proposals: CoachProposal[];
  model?: string;
};

/** Failed attempts are stored too, so the background sync doesn't retry every 30 minutes. */
export type CoachRecord =
  | { ok: true; review: CoachReview }
  | { ok: false; week: DateKey; error: string; attempts: number; lastAttempt: number };

export const MAX_PROPOSALS = 2;
export const MAX_BACKGROUND_ATTEMPTS = 3;
/** The coach can lighten a week down to 60% … */
export const MIN_FACTOR = 0.6;
/** … and changes smaller than ±3% aren't worth a card. */
const NO_OP = 0.03;

const round05 = (km: number) => Math.round(km * 2) / 2;

// ---------- what the coach sees ----------

export type ReviewDay = {
  date: DateKey;
  weekday: string;
  goal: string | null;
  result: string | null;
  done: boolean;
  status: DayStatus;
  keySession: SessionKind | null;
  /** How rested you were when the goal was made (from sleep and resting heart rate). */
  readiness: GoalMeta['readiness'] | null;
  boss: boolean;
};

export type ReviewInput = {
  today: DateKey;
  thisWeek: {
    monday: DateKey;
    plannedKm: number;
    doneKm: number;
    days: ReviewDay[];
  };
  recentWeeksKm: number[];
  nextWeek: {
    monday: DateKey;
    plannedKm: number;
    /** "light" without the reason unless you chose to share your cycle with the coach. */
    weekType: 'normal' | 'light' | 'light_period' | 'pre_event' | 'event' | 'back_to_back';
    heading: string;
    sessions: { id: string; kind: SessionKind; day: DateKey; weekday: string; movable: boolean }[];
    freeDays: DateKey[];
    /** The most the plan allows next week to grow to (safe progression). */
    maxKm: number;
  };
  streak: { current: number; longest: number; freezes: number };
  restDaysPerWeek: number;
  aimKmPerDay: number | null;
  event: (Omit<GoalEvent, 'name'> & { name: string; weeksAway: number }) | null;
  /** Only with "share my cycle with the coach" on. */
  nextPeriodStart?: DateKey | null;
};

const weekdayOf = (d: DateKey) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T12:00:00').getDay()];

type DayLike = { date: DateKey; goal: GoalSpec | null; value: number; done: boolean; status: DayStatus; meta?: GoalMeta };

export function buildReviewInput(input: {
  today: DateKey;
  plan: WeekPlan;
  nextPlan: WeekPlan;
  days: Map<DateKey, DayLike>;
  doneKm: number;
  recentWeeksKm: number[];
  streak: { current: number; longest: number; freezes: number };
  settings: Settings;
  nextPeriodStart?: DateKey | null;
}): ReviewInput {
  const { today, plan, nextPlan, settings } = input;
  const v = nextPlan.volume!;
  const share = settings.coachShareCycle;
  const days: ReviewDay[] = Array.from({ length: 7 }, (_, i) => addDays(plan.week, i))
    .filter((d) => d <= today)
    .map((date) => {
      const d = input.days.get(date);
      const s = plan.sessions.find((x) => x.day === date && !x.dropped);
      return {
        date,
        weekday: weekdayOf(date),
        goal: d?.goal ? goalTitle(d.goal, settings) : null,
        result: d?.goal ? formatValue(d.goal, d.value) : null,
        done: !!d?.done,
        status: d?.status ?? 'none',
        keySession: s?.kind ?? null,
        readiness: d?.meta?.readiness ?? null,
        boss: !!d?.meta?.boss,
      };
    });
  const ev = settings.event;
  return {
    today,
    thisWeek: {
      monday: plan.week,
      plannedKm: plan.volume?.km ?? 0,
      doneKm: Math.round(input.doneKm * 10) / 10,
      days,
    },
    recentWeeksKm: input.recentWeeksKm.map((k) => Math.round(k * 10) / 10),
    nextWeek: {
      monday: nextPlan.week,
      plannedKm: v.km,
      weekType: v.eventWeek
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
      heading: ev ? `Toward ${ev.name}` : settings.dailyTargetKm ? `Toward ${settings.dailyTargetKm} km a day` : 'Gentle growth',
      sessions: nextPlan.sessions
        .filter((s) => !s.dropped)
        .map((s) => ({ id: s.id, kind: s.kind, day: s.day, weekday: weekdayOf(s.day), movable: isMovable(s) })),
      freeDays: Array.from({ length: 7 }, (_, i) => addDays(nextPlan.week, i)).filter(
        (d) => !nextPlan.sessions.some((s) => s.day === d && !s.dropped),
      ),
      maxKm: round05(v.km * maxFactor(v, input.doneKm)),
    },
    streak: input.streak,
    restDaysPerWeek: settings.restDaysPerWeek,
    aimKmPerDay: settings.dailyTargetKm,
    event: ev ? { ...ev, weeksAway: Math.max(0, Math.floor(daysBetween(today, ev.date) / 7)) } : null,
    ...(share ? { nextPeriodStart: input.nextPeriodStart ?? null } : {}),
  };
}

// ---------- the safety rules ----------

/**
 * How much harder the coach may make a week: never in a light, pre-event or
 * event week, and never past +10% of what you actually did this week (the
 * plan's own growth limit). Usually that leaves no room: the plan already grows.
 */
export function maxFactor(v: WeekVolume, doneKm: number): number {
  if (v.light || v.preEvent || v.eventWeek || v.km <= 0) return 1;
  return Math.max(1, Math.min(MAX_GROWTH, (doneKm * MAX_GROWTH) / v.km));
}

const SESSION_NAME: Record<SessionKind, string> = {
  long_walk: 'Long walk',
  back_to_back: 'Long walk, day 2',
  brisk_walk: 'Brisk walk',
  trek_day: 'Trek day',
};

export type Checked = { ok: true; action: CoachAction; change: string; adjusted?: string } | { ok: false; why: string };

/** Check a proposal against the plan; clamp a week change into the safe range. */
export function checkAction(action: CoachAction, plan: WeekPlan, doneKm: number): Checked {
  if (action.type === 'move_session') {
    const s = sessionById(plan, action.sessionId);
    if (!s || s.dropped) return { ok: false, why: 'no such session' };
    if (!isMovable(s)) return { ok: false, why: 'trek days can’t move' };
    if (s.day === action.to) return { ok: false, why: 'already on that day' };
    if (!freeDays(plan, plan.week, false, s.id).includes(action.to)) return { ok: false, why: 'that day isn’t free' };
    return { ok: true, action, change: `${SESSION_NAME[s.kind]}: ${weekdayOf(s.day)} → ${weekdayOf(action.to)}` };
  }
  const v = plan.volume;
  if (!v) return { ok: false, why: 'no weekly km yet' };
  if (!Number.isFinite(action.factor)) return { ok: false, why: 'not a number' };
  const max = maxFactor(v, doneKm);
  const factor = Math.min(max, Math.max(MIN_FACTOR, action.factor));
  if (Math.abs(factor - 1) < NO_OP) {
    return { ok: false, why: action.factor > 1 ? 'the plan already grows as fast as is safe' : 'too small a change' };
  }
  const km = round05(v.km * factor);
  const adjusted =
    Math.abs(factor - action.factor) > 0.005
      ? factor < action.factor
        ? `Capped at ${km} km: the plan grows at most 10% a week over what you actually walked.`
        : `Kept at ${km} km: the coach doesn’t lighten a week below 60%.`
      : undefined;
  return {
    ok: true,
    action: { type: 'scale_week', factor: Math.round(factor * 100) / 100 },
    change: `Next week: ${v.km} → ${km} km`,
    ...(adjusted ? { adjusted } : {}),
  };
}

// ---------- applying and undoing ----------

/** The coach's factor on a freshly computed week (the plan recomputes km on Monday). */
export function withCoachFactor(volume: WeekVolume, factor: number | undefined): WeekVolume {
  if (!factor || factor === 1) return volume;
  const pct = Math.round((factor - 1) * 100);
  return {
    ...volume,
    km: round05(volume.km * factor),
    notes: [...volume.notes, `Coach: ${pct > 0 ? '+' : ''}${pct}% this week (from your Sunday review).`],
  };
}

/** Apply a proposal (checked again: the plan may have changed since the review). */
export function applyProposal(
  plan: WeekPlan,
  p: CoachProposal,
  today: DateKey,
  todayDone: boolean,
): { plan: WeekPlan; from?: DateKey } | null {
  const a = p.action;
  if (a.type === 'move_session') {
    const s = sessionById(plan, a.sessionId);
    if (!s || !isMovable(s)) return null;
    const firstDay = today > plan.week ? today : plan.week;
    if (!freeDays(plan, firstDay, firstDay === today && todayDone, s.id).includes(a.to)) return null;
    return {
      plan: { ...plan, sessions: plan.sessions.map((x) => (x.id === s.id ? { ...x, day: a.to, dropped: false } : x)) },
      from: s.day,
    };
  }
  if (!plan.volume || plan.coach?.factor) return null; // one week change per week
  return { plan: { ...plan, coach: { factor: a.factor }, volume: withCoachFactor(plan.volume, a.factor) } };
}

/** Undo an applied proposal, as far as the week still allows. */
export function undoProposal(plan: WeekPlan, p: CoachProposal, today: DateKey, todayDone: boolean): WeekPlan | null {
  const a = p.action;
  if (a.type === 'move_session') {
    const s = sessionById(plan, a.sessionId);
    if (!s || !p.from || s.day !== a.to) return null;
    const firstDay = today > plan.week ? today : plan.week;
    if (!freeDays(plan, firstDay, firstDay === today && todayDone, s.id).includes(p.from)) return null;
    return { ...plan, sessions: plan.sessions.map((x) => (x.id === s.id ? { ...x, day: p.from! } : x)) };
  }
  const f = plan.coach?.factor;
  if (!f || !plan.volume) return null;
  const { coach: _drop, ...rest } = plan;
  void _drop;
  return {
    ...rest,
    volume: {
      ...plan.volume,
      km: round05(plan.volume.km / f),
      notes: plan.volume.notes.filter((n) => !n.startsWith('Coach:')),
    },
  };
}

// ---------- reading the coach's answer ----------

/** The JSON the model must answer with (structured outputs). */
export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'How this week went, 2–4 short sentences.' },
    tip: { type: ['string', 'null'], description: 'One concrete tip for next week, or null.' },
    proposals: {
      type: 'array',
      description: `At most ${MAX_PROPOSALS} changes to next week's plan. Empty when the plan is fine.`,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['move_session', 'scale_week'] },
          session_id: { type: ['string', 'null'], description: 'move_session: the session id.' },
          to: { type: ['string', 'null'], description: 'move_session: a free day of next week, YYYY-MM-DD.' },
          factor: { type: ['number', 'null'], description: 'scale_week: e.g. 0.85 for 15% fewer km.' },
          reason: { type: 'string', description: 'Why, in one or two sentences, addressed to the walker.' },
        },
        required: ['type', 'session_id', 'to', 'factor', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'tip', 'proposals'],
  additionalProperties: false,
} as const;

type RawProposal = { type?: unknown; session_id?: unknown; to?: unknown; factor?: unknown; reason?: unknown };

/** Turn the model's JSON into a review: invalid or unsafe proposals are dropped, the rest clamped. */
export function reviewFrom(
  raw: unknown,
  nextPlan: WeekPlan,
  doneKm: number,
  now: number,
  model?: string,
): CoachReview {
  const r = (raw ?? {}) as { summary?: unknown; tip?: unknown; proposals?: unknown };
  const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
  if (!summary) throw new Error('The coach’s answer had no summary.');
  const proposals: CoachProposal[] = [];
  let scaled = false;
  for (const p of (Array.isArray(r.proposals) ? r.proposals : []) as RawProposal[]) {
    if (proposals.length >= MAX_PROPOSALS) break;
    const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
    let action: CoachAction | null = null;
    if (p.type === 'move_session' && typeof p.session_id === 'string' && typeof p.to === 'string') {
      action = { type: 'move_session', sessionId: p.session_id, to: p.to };
    } else if (p.type === 'scale_week' && typeof p.factor === 'number' && !scaled) {
      action = { type: 'scale_week', factor: p.factor };
    }
    if (!action || !reason) continue;
    // Two moves of the same session: keep the first.
    if (
      action.type === 'move_session' &&
      proposals.some((x) => x.action.type === 'move_session' && x.action.sessionId === (action as { sessionId: string }).sessionId)
    ) {
      continue;
    }
    const c = checkAction(action, nextPlan, doneKm);
    if (!c.ok) continue;
    if (c.action.type === 'scale_week') scaled = true;
    proposals.push({
      id: `p${proposals.length + 1}`,
      action: c.action,
      reason,
      change: c.change,
      status: 'pending',
      ...(c.adjusted ? { adjusted: c.adjusted } : {}),
    });
  }
  return {
    week: nextPlan.week,
    createdAt: now,
    summary,
    tip: typeof r.tip === 'string' && r.tip.trim() ? r.tip.trim() : null,
    proposals,
    ...(model ? { model } : {}),
  };
}

/** Should the background sync ask for this week's review now? */
export function shouldAutoReview(record: CoachRecord | null, now: number): boolean {
  if (!record) return true;
  if (record.ok) return false;
  // Back off: one try per 2 hours, 3 tries at most.
  return record.attempts < MAX_BACKGROUND_ATTEMPTS && now - record.lastAttempt >= 2 * 3_600_000;
}
