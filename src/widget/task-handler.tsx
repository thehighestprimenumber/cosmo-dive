import * as SQLite from 'expo-sqlite';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { DB_NAME, migrate } from '../data/db';
import { loadWidgetState } from './store';
import { TodayWidget } from './TodayWidget';

/**
 * Android asks for the widget when it's added, resized, or every 30 minutes.
 * It draws the content saved by the last sync (app or background); taps open
 * the app (OPEN_APP is handled natively).
 */
export async function widgetTaskHandler({ widgetAction, renderWidget }: WidgetTaskHandlerProps): Promise<void> {
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
  let state = null;
  try {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await migrate(db);
    state = await loadWidgetState(db);
    await db.closeAsync();
  } catch {
    // Draw the "open the app" version.
  }
  renderWidget(<TodayWidget state={state} />);
}
