import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import type { WidgetState } from './state';
import { TodayWidget } from './TodayWidget';

export const WIDGET_NAME = 'Today';

/** Redraw every "Today" widget on the home screen (no-op if none is added). */
export async function updateTodayWidget(state: WidgetState): Promise<void> {
  if (Platform.OS !== 'android') return;
  await requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: () => <TodayWidget state={state} />,
  });
}
