import type { SQLiteDatabase } from 'expo-sqlite';
import { loadCoachRecord, saveSettings } from '../data/db';
import type { Settings } from '../domain/types';
import { ACHIEVEMENTS } from '../domain/game';
import { widgetStateFrom } from '../widget/state';
import { saveWidgetState } from '../widget/store';
import { updateTodayWidget } from '../widget/update';
import { sendStateToWatch } from '../../modules/wear-sync';
import { shouldAutoReview } from '../domain/coach';
import { getApiKey, runWeeklyReview } from './coach';
import { notifyAchievements, notifyCoachReview, notifyAimReached, notifyGoalComplete, updateEvening, updateNudge } from './notifications';
import type { Snapshot } from './sync';

/**
 * Runs after every successful sync, in the app or in the background:
 * keeps the evening reminder in step with today's progress and celebrates
 * a completed goal exactly once per day.
 */
export async function afterSync(
  db: SQLiteDatabase,
  settings: Settings,
  snap: Snapshot,
  { inBackground }: { inBackground: boolean },
): Promise<void> {
  const done = !!snap.todayProgress?.done;
  // Home-screen widget: save its content (for redraws while closed) and redraw it now.
  try {
    const state = widgetStateFrom(snap, settings);
    await saveWidgetState(db, state);
    await updateTodayWidget(state);
    // Same content for the watch Tile.
    await sendStateToWatch(JSON.stringify(state));
  } catch {
    // A widget problem must never break syncing.
  }
  // You reached your aim: offer to raise it, once per aim.
  if (inBackground && snap.aim?.suggestion && settings.aimNotifiedKm !== snap.aim.km) {
    await notifyAimReached(snap.aim.averageKm, snap.aim.suggestion);
    await saveSettings(db, { aimNotifiedKm: snap.aim.km });
  }
  if (inBackground && snap.game.newlyUnlocked.length) {
    const titles = snap.game.newlyUnlocked.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.title ?? id);
    await notifyAchievements(titles);
  }
  // Sunday evening: the coach's weekly review, once (a few retries if it fails).
  if (inBackground && settings.coachEnabled && snap.nextPlan) {
    try {
      const record = await loadCoachRecord(db, snap.nextPlan.week);
      if (shouldAutoReview(record, Date.now()) && (await getApiKey())) {
        const r = await runWeeklyReview(db, snap, settings);
        if (r.ok) await notifyCoachReview(r.review.summary, r.review.proposals.length);
      }
    } catch {
      // The coach is optional; never break syncing.
    }
  }
  await updateEvening(settings, snap.today, snap.todayGoal, done, snap.streak.current);
  await updateNudge(settings, snap.today, snap.todayGoal, done, snap.usualTime);

  if (!done || !snap.todayGoal) return;
  // Re-read: the other side (app vs. background) may have celebrated already.
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'lastCelebrated'");
  const lastCelebrated = row ? (JSON.parse(row.value) as string | null) : null;
  if (lastCelebrated === snap.today) return;

  await saveSettings(db, { lastCelebrated: snap.today });
  // In the app, the Today screen's flame animation is the celebration.
  if (inBackground) await notifyGoalComplete(settings, snap.todayGoal, snap.streak.current);
}
