import type { SQLiteDatabase } from 'expo-sqlite';
import { saveSettings } from '../data/db';
import type { Settings } from '../domain/types';
import { ACHIEVEMENTS } from '../domain/game';
import { notifyAchievements, notifyGoalComplete, updateEvening, updateNudge } from './notifications';
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
  if (inBackground && snap.game.newlyUnlocked.length) {
    const titles = snap.game.newlyUnlocked.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.title ?? id);
    await notifyAchievements(titles);
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
