import { formatKm, formatValue, goalEmoji, goalTitle } from '../domain/format';
import { weekSummary } from '../domain/summary';
import type { DateKey, DayStatus, Settings } from '../domain/types';
import type { Snapshot } from '../services/sync';

/**
 * What the home-screen widget (and later the watch Tile) shows. Built from a
 * sync's snapshot and stored, so it can be drawn while the app is closed.
 */
export type WidgetState = {
  /** The day this was built for; an older one means "open the app for today". */
  date: DateKey;
  streak: number;
  level: number;
  emoji: string;
  title: string;
  /** "7.7 of 13 km", "Goal complete!", … */
  detail: string;
  fraction: number;
  done: boolean;
  /** "⛰️ 320 of 600 m" for long walks with a climb. */
  climb: string | null;
  /** "21 of 35 km this week · 14 km left" */
  weekLine: string;
  /** Monday … Sunday. */
  dots: (DayStatus | 'future')[];
  todayIndex: number;
  updatedAt: number;
};

export function widgetStateFrom(snap: Snapshot, settings: Settings): WidgetState {
  const goal = snap.todayGoal;
  const p = snap.todayProgress;
  const summary = weekSummary(snap.streak.statuses, snap.today, settings.restDaysPerWeek, settings.startDate);
  const { volume, doneKm, leftKm } = snap.week;

  let title = 'No goal yet';
  let detail = 'Open Daily Spark to sync';
  if (goal === null) {
    title = 'Rest day';
    detail = 'Your streak is safe today';
  } else if (goal && p) {
    title = goalTitle(goal, settings);
    detail = p.done
      ? `Goal complete! ${formatValue(goal, p.value)}`
      : `${formatValue(goal, p.value)} of ${formatValue(goal, p.target)}`;
  }

  return {
    date: snap.today,
    streak: snap.streak.current,
    level: snap.game.level,
    emoji: goal === undefined ? '🔸' : goalEmoji(goal ?? null),
    title,
    detail,
    fraction: p ? Math.max(0, Math.min(1, p.fraction)) : 0,
    done: !!p?.done,
    climb: p?.ascent ? `⛰️ ${Math.round(p.ascent.value)} of ${p.ascent.target} m` : null,
    weekLine: `${formatKm(doneKm * 1000)} of ${formatKm(volume.km * 1000)} this week · ${formatKm(leftKm * 1000)} left`,
    dots: summary.days.map((d) => d.status),
    todayIndex: summary.days.findIndex((d) => d.date === snap.today),
    updatedAt: snap.syncedAt,
  };
}
