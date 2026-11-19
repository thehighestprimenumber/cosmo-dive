import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { parseTime, startOfDay } from '../domain/dates';
import { goalTitle } from '../domain/format';
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

/** Shown when the background sync sees you moved enough on a rest day. */
export async function notifyBonusDay(streak: number): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Bonus day! 💜 ${streak}-day streak`,
      body: 'You moved on a rest day, so it counts toward your streak.',
    },
    trigger: { channelId: CHANNEL },
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
