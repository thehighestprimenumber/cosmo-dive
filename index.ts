// App entry: Expo Router, plus the home-screen widget's background handler
// (it must be registered at startup, outside any screen).
import 'expo-router/entry';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/widget/task-handler';

registerWidgetTaskHandler(widgetTaskHandler);
