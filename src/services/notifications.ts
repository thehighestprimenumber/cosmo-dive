import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { parseTime, startOfDay } from '../domain/dates';
import { goalTitle } from '../domain/format';
import { formatTime, nudgeTime, type TimeOfDay } from '../domain/habits';
import type { DateKey, GoalSpec, Settings } from '../domain/types';

const CHANNEL = 'reminders';
const MORNING_ID = 'morning';
const eveningId = (date: DateKey) => `evening-${date}`;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function setupNotifications(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Daily reminders',
      importance: AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/** Repeating morning nudge. Safe to call repeatedly; it replaces the previous one. */
export async function scheduleMorning(settings: Settings): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(MORNING_ID).catch(() => {});
  const t = parseTime(settings.morningReminder);
  if (!t) return;
  await Notifications.scheduleNotificationAsync({
    identifier: MORNING_ID,
    content: { title: 'Your Daily Spark goal is ready 🔥', body: 'Open the app to see what today asks of you.' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: t.hour, minute: t.minute, channelId: CHANNEL },
  });
}

/** Shown when the background sync sees today's goal completed. */
export async function notifyGoalComplete(settings: Settings, goal: GoalSpec, streak: number): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Goal complete! 🔥 ${streak}-day streak`,
      body: `${goalTitle(goal, settings)} ✔`,
    },
    trigger: { channelId: CHANNEL },
  });
}

/** Your 14-day average reached your aim. */
export async function notifyAimReached(averageKm: number, suggestion: number): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `🎯 Aim reached: ${averageKm.toFixed(1)} km a day!`,
      body: `Open Daily Spark to raise your aim to ${suggestion} km.`,
    },
    trigger: { channelId: CHANNEL },
  });
}

/** The coach's Sunday review is ready. */
export async function notifyCoachReview(summary: string, proposals: number): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: proposals ? `🧠 Your weekly review: ${proposals} suggestion${proposals > 1 ? 's' : ''}` : '🧠 Your weekly review is ready',
      body: summary.length > 140 ? summary.slice(0, 137) + '…' : summary,
    },
    trigger: { channelId: CHANNEL },
  });
}

/** New achievements unlocked by a background sync. */
export async function notifyAchievements(titles: string[]): Promise<void> {
  if (!titles.length) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: titles.length === 1 ? `🏆 Achievement unlocked: ${titles[0]}` : `🏆 ${titles.length} achievements unlocked`,
      body: titles.length === 1 ? 'Open Daily Spark to see it.' : titles.join(' · '),
    },
    trigger: { channelId: CHANNEL },
  });
}

/**
 * "You usually head out around 18:00" nudge, 30 min before your learned
 * usual time, for today only and only while the goal isn't done.
 */
export async function updateNudge(
  settings: Settings,
  today: DateKey,
  goal: GoalSpec | null | undefined,
  done: boolean,
  usual: TimeOfDay | null,
): Promise<void> {
  const id = `nudge-${today}`;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  if (!settings.smartReminder || !goal || done || !usual) return;
  const t = nudgeTime(usual);
  const at = startOfDay(today);
  at.setHours(t.hour, t.minute);
  if (at.getTime() <= Date.now()) return;
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title: `You usually get moving around ${formatTime(usual)} 🔥`,
      body: `Today: ${goalTitle(goal, settings)}`,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
  });
}

/**
 * One-off "save your streak" reminder for today. Scheduled whenever the app
 * syncs and today's goal isn't done yet; cancelled once it is.
 */
export async function updateEvening(
  settings: Settings,
  today: DateKey,
  goal: GoalSpec | null | undefined,
  done: boolean,
  streak: number,
): Promise<void> {
  const id = eveningId(today);
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  if (!goal || done) return;
  const t = parseTime(settings.eveningReminder);
  if (!t) return;
  const at = startOfDay(today);
  at.setHours(t.hour, t.minute);
  if (at.getTime() <= Date.now()) return;
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title: streak > 0 ? `Keep your ${streak}-day streak alive 🔥` : 'Still time to get moving 🔥',
      body: goalTitle(goal, settings),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
  });
}
