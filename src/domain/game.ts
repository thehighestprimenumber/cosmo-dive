import { addDays, mondayOf, toDateKey } from './dates';
import { walkEquivalentMeters } from './progress';
import type { Activity, DateKey, DayResult, DayStatus } from './types';

// ---------- Boss days ----------

/** One day a week is a boss day: harder, worth more XP. */
export const BOSS_FACTOR = 1.25;

/** Deterministic: the same weekday for a given week, different week to week. */
export function isBossDay(date: DateKey): boolean {
  const monday = mondayOf(date);
  let h = 2166136261;
  for (const c of monday + 'boss') h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return addDays(monday, (h >>> 0) % 7) === date;
}

// ---------- XP and levels ----------

export const XP = {
  goal: 10,
  /** Extra per day of streak you were on, up to +10. */
  streakBonusCap: 10,
  boss: 30,
  perfectWeek: 25,
} as const;

/** Total XP, derived from history (nothing stored). */
export function totalXp(days: DayResult[], statuses: Map<DateKey, DayStatus>, restDaysPerWeek: number): number {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  let xp = 0;
  let run = 0;
  const doneByWeek = new Map<DateKey, number>();
  for (const d of sorted) {
    const st = statuses.get(d.date);
    if (st === 'done') {
      xp += (d.meta?.boss ? XP.boss : XP.goal) + Math.min(run, XP.streakBonusCap);
      run++;
      const w = mondayOf(d.date);
      doneByWeek.set(w, (doneByWeek.get(w) ?? 0) + 1);
    } else if (st === 'missed') {
      run = 0;
    }
  }
  for (const [, done] of doneByWeek) if (done >= 7 - restDaysPerWeek) xp += XP.perfectWeek;
  return xp;
}

/** XP needed to reach a level: 0, 100, 300, 600, 1000, … */
export const xpForLevel = (level: number) => 50 * level * (level - 1);

export function levelFor(xp: number): { level: number; into: number; needed: number } {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { level, into: xp - xpForLevel(level), needed: xpForLevel(level + 1) - xpForLevel(level) };
}

// ---------- Monthly challenge ----------

export const monthOf = (date: DateKey) => date.slice(0, 7);

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Walk-equivalent km in a month so far. */
export function monthKm(activities: Activity[], month: string, rideFactor: number): number {
  return (
    activities
      .filter((a) => monthOf(toDateKey(a.start)) === month)
      .reduce((s, a) => s + walkEquivalentMeters(a, rideFactor), 0) / 1000
  );
}

/**
 * This month's km target: last month's km (scaled up if only part of it is
 * in `activities`, which cover [coveredFrom, …)) plus 10%, rounded to 5 km,
 * at least 20 km. Computed once at the start of a month and then kept.
 */
export function monthTarget(
  month: string,
  activities: Activity[],
  coveredFrom: DateKey,
  rideFactor: number,
): number {
  const prev = prevMonth(month);
  const prevStart = `${prev}-01`;
  const from = coveredFrom > prevStart ? coveredFrom : prevStart;
  const covered = Math.max(0, daysInMonth(prev) - (Number(from.slice(8)) - 1));
  const km = monthKm(activities.filter((a) => toDateKey(a.start) >= from), prev, rideFactor);
  const projected = covered >= 7 ? (km / covered) * daysInMonth(prev) : 0;
  return Math.max(20, Math.round((projected * 1.1) / 5) * 5);
}

/** With an aim of `km` a day on average, the month needs km × its days (rounded to 5 km). */
export function aimMonthTarget(month: string, km: number): number {
  return Math.round((km * daysInMonth(month)) / 5) * 5;
}

// ---------- Achievements ----------

export type AchievementId =
  | 'first_goal'
  | 'streak_7'
  | 'streak_30'
  | 'streak_100'
  | 'boss_1'
  | 'boss_10'
  | 'perfect_week'
  | 'all_rounder'
  | 'comeback'
  | 'month_champion'
  | 'century'
  | 'level_5';

export const ACHIEVEMENTS: { id: AchievementId; emoji: string; title: string; description: string }[] = [
  { id: 'first_goal', emoji: '✨', title: 'First spark', description: 'Complete your first goal.' },
  { id: 'streak_7', emoji: '🔥', title: 'On fire', description: 'Reach a 7-day streak.' },
  { id: 'streak_30', emoji: '🌋', title: 'Unstoppable', description: 'Reach a 30-day streak.' },
  { id: 'streak_100', emoji: '👑', title: 'Legend', description: 'Reach a 100-day streak.' },
  { id: 'boss_1', emoji: '⚔️', title: 'Boss slayer', description: 'Beat a boss day.' },
  { id: 'boss_10', emoji: '🐉', title: 'Boss hunter', description: 'Beat 10 boss days.' },
  { id: 'perfect_week', emoji: '💯', title: 'Perfect week', description: 'Hit your goal every training day of a week.' },
  { id: 'all_rounder', emoji: '🎯', title: 'All-rounder', description: 'Complete a distance, a time and a heart-rate goal in one week.' },
  { id: 'comeback', emoji: '💪', title: 'Comeback', description: 'Hit your goal the day after a missed day.' },
  { id: 'month_champion', emoji: '🏅', title: 'Monthly champion', description: 'Complete a monthly km challenge.' },
  { id: 'century', emoji: '💯', title: 'Century', description: 'Cover 100 km (walking equivalent) in a month.' },
  { id: 'level_5', emoji: '⭐', title: 'Level 5', description: 'Reach level 5.' },
];

export type GameInput = {
  days: DayResult[];
  statuses: Map<DateKey, DayStatus>;
  longestStreak: number;
  restDaysPerWeek: number;
  level: number;
  monthKm: number;
  monthTarget: number;
};

/** Which achievements your data currently satisfies. Unlocks are stored, so they never disappear. */
export function earnedAchievements(g: GameInput): AchievementId[] {
  const done = g.days.filter((d) => g.statuses.get(d.date) === 'done');
  const out: AchievementId[] = [];
  if (done.length > 0) out.push('first_goal');
  if (g.longestStreak >= 7) out.push('streak_7');
  if (g.longestStreak >= 30) out.push('streak_30');
  if (g.longestStreak >= 100) out.push('streak_100');
  const bosses = done.filter((d) => d.meta?.boss).length;
  if (bosses >= 1) out.push('boss_1');
  if (bosses >= 10) out.push('boss_10');

  const weeks = new Map<DateKey, DayResult[]>();
  for (const d of done) weeks.set(mondayOf(d.date), [...(weeks.get(mondayOf(d.date)) ?? []), d]);
  if ([...weeks.values()].some((w) => w.length >= 7 - g.restDaysPerWeek)) out.push('perfect_week');
  if ([...weeks.values()].some((w) => new Set(w.map((d) => d.goal?.kind)).size >= 3)) out.push('all_rounder');

  if (done.some((d) => g.statuses.get(addDays(d.date, -1)) === 'missed')) out.push('comeback');
  if (g.monthKm >= g.monthTarget) out.push('month_champion');
  if (g.monthKm >= 100) out.push('century');
  if (g.level >= 5) out.push('level_5');
  return out;
}
