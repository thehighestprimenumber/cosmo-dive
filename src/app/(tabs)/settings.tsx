import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Platform, ScrollView, Text } from 'react-native';
import { openHealthConnectSettings } from 'react-native-health-connect';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseTime } from '../../domain/dates';
import { zoneRange } from '../../domain/zones';
import { exportHistory, importHistory } from '../../services/backupFiles';
import { useApp } from '../../state/AppState';
import type { Settings } from '../../domain/types';
import { Button, Card, Field, Label, RestDayPicker, styles } from '../../ui/components';

export default function SettingsScreen() {
  const { settings } = useApp();
  if (!settings) return null;
  // Remount the form whenever the saved settings change, so it starts from them.
  return <SettingsForm key={JSON.stringify(settings)} settings={settings} />;
}

function SettingsForm({ settings }: { settings: Settings }) {
  const db = useSQLiteContext();
  const { updateSettings, refresh, connect, syncing, reloadAll } = useApp();
  const [restDays, setRestDays] = useState<number[]>(settings.restDays);
  const [maxHr, setMaxHr] = useState(String(settings.maxHr));
  const [rideFactor, setRideFactor] = useState(String(settings.rideFactor));
  const [minKm, setMinKm] = useState(String(settings.minDistanceKm));
  const [morning, setMorning] = useState(settings.morningReminder);
  const [evening, setEvening] = useState(settings.eveningReminder);

  const save = async () => {
    const hr = Number(maxHr);
    const factor = Number(rideFactor.replace(',', '.'));
    if (!(hr >= 120 && hr <= 230)) return Alert.alert('Max heart rate should be between 120 and 230.');
    if (!(factor >= 1 && factor <= 10)) return Alert.alert('Ride factor should be between 1 and 10.');
    const min = Number(minKm.replace(',', '.'));
    if (!(min >= 0 && min <= 40)) return Alert.alert('Minimum distance should be between 0 and 40 km.');
    if (!parseTime(morning) || !parseTime(evening)) return Alert.alert('Reminder times should look like 08:00.');
    await updateSettings({
      restDays,
      maxHr: hr,
      rideFactor: factor,
      minDistanceKm: min,
      morningReminder: morning,
      eveningReminder: evening,
    });
    await refresh({ regenerateToday: true });
    Alert.alert('Saved', 'Today’s goal was updated too, unless you had already completed it.');
  };

  const doExport = async () => {
    try {
      await exportHistory(db);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    }
  };

  const doImport = async () => {
    try {
      const added = await importHistory(db);
      if (added === null) return;
      await reloadAll();
      Alert.alert('Imported', `${added} past goals added. Your streak has been recalculated.`);
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    }
  };

  const rebuild = async () => {
    await refresh({ fullRebuild: true });
    Alert.alert('Done', 'History re-checked against your activities.');
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.h1, { marginBottom: 16 }]}>Settings</Text>

        <Card>
          <Label>Rest days</Label>
          <RestDayPicker value={restDays} onChange={setRestDays} />
        </Card>

        <Card>
          <Field
            label="Max heart rate (bpm)"
            value={maxHr}
            onChangeText={setMaxHr}
            keyboardType="number-pad"
            hint={
              Number(maxHr) > 0
                ? `Zone 2 = ${zoneRange(2, Number(maxHr)).join('–')} bpm · Zone 3 = ${zoneRange(3, Number(maxHr)).join('–')} bpm`
                : undefined
            }
          />
          <Field
            label="Minimum distance (km)"
            value={minKm}
            onChangeText={setMinKm}
            keyboardType="decimal-pad"
            hint="Distance goals are never shorter than this (walking; rides count 1/ride factor)."
          />
          <Field
            label="Ride factor"
            value={rideFactor}
            onChangeText={setRideFactor}
            keyboardType="decimal-pad"
            hint={`For distance goals, 1 km walked = ${rideFactor || '?'} km ridden.`}
          />
          <Field label="Morning reminder" value={morning} onChangeText={setMorning} keyboardType="numbers-and-punctuation" />
          <Field label="Evening reminder" value={evening} onChangeText={setEvening} keyboardType="numbers-and-punctuation" />
          <Button title="Save" onPress={save} />
        </Card>

        <Card>
          <Label>Data</Label>
          <Text style={styles.body}>
            Source: {settings.dataSource === 'demo' ? 'Demo data' : 'Health Connect'}
          </Text>
          <Text style={[styles.muted, { marginBottom: 8 }]}>Plan started {settings.startDate}.</Text>
          {settings.dataSource === 'demo' ? (
            <Button
              title="Switch to Health Connect"
              variant="secondary"
              onPress={async () => (await connect('health_connect')) && refresh({ fullRebuild: true })}
            />
          ) : (
            Platform.OS === 'android' && (
              <Button title="Open Health Connect" variant="secondary" onPress={() => openHealthConnectSettings()} />
            )
          )}
          <Button title={syncing ? 'Working…' : 'Rebuild history'} variant="secondary" onPress={rebuild} disabled={syncing} />
          <Text style={[styles.hint, { marginTop: 8 }]}>
            Re-checks every past goal against your activities, e.g. after editing or deleting a workout.
          </Text>
          <Button title="Diagnostics" variant="secondary" onPress={() => router.push('/diagnostics')} />
        </Card>

        <Card>
          <Label>Backup</Label>
          <Text style={styles.muted}>
            Your goal history only lives on this phone. Export it now and then (e.g. to Google Drive) so you can
            import it on a new phone.
          </Text>
          <Button title="Export history" variant="secondary" onPress={doExport} />
          <Button title="Import history" variant="secondary" onPress={doImport} disabled={syncing} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
