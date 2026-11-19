import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DB_NAME, migrate } from '../data/db';
// Defines the background sync task; must be imported at startup.
import '../services/backgroundSync';
import { AppStateProvider } from '../state/AppState';
import { colors } from '../ui/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName={DB_NAME} onInit={migrate}>
        <AppStateProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
        </AppStateProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
