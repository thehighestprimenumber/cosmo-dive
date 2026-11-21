import type { SQLiteDatabase } from 'expo-sqlite';
import type { WidgetState } from './state';

const KEY = 'widgetState';

/** The widget's content, kept in the settings table so it can be drawn while the app is closed. */
export async function saveWidgetState(db: SQLiteDatabase, state: WidgetState): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', KEY, JSON.stringify(state));
}

export async function loadWidgetState(db: SQLiteDatabase): Promise<WidgetState | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY);
  return row ? (JSON.parse(row.value) as WidgetState) : null;
}
