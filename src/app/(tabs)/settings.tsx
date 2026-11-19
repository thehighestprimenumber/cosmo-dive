import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, Text } from 'react-native';
import { openHealthConnectSettings } from 'react-native-health-connect';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseTime } from '../../domain/dates';
import { zoneRange } from '../../domain/zones';
import { useApp } from '../../state/AppState';
import { Button, Card, Field, Label, RestDayPicker, styles } from '../../ui/components';

export default function SettingsScreen() {
  const { settings, updateSettings, refresh, connect, syncing } = useApp();
  const [restDays, setRestDays] = useState<number[]>([]);
  const [maxHr, setMaxHr] = useState('');
  const [rideFactor, setRideFactor] = useState('');
  const [morning, setMorning] = useState('');
  const [evening, setEvening] = useState('');

  useEffect(() => {
    if (!settings) return;
    setRestDays(settings.restDays);
    setMaxHr(String(settings.maxHr));
    setRideFactor(String(settings.rideFactor));
    setMorning(settings.morningReminder);
    setEvening(settings.eveningReminder);
  }, [settings]);

  if (!settings) return null;

  const save = async () => {
    const hr = Number(maxHr);
    const factor = Number(rideFactor.replace(',', '.'));
    if (!(hr >= 120 && hr <= 230)) return Alert.alert('Max heart rate should be between 120 and 230.');
    if (!(factor >= 1 && factor <= 10)) return Alert.alert('Ride factor should be between 1 and 10.');
    if (!parseTime(morning) || !parseTime(evening)) return Alert.alert('Reminder times should look like 08:00.');
    await updateSettings({ restDays, maxHr: hr, rideFactor: factor, morningReminder: morning, eveningReminder: evening });
    await refresh();
    Alert.alert('Saved', 'Changes apply to goals from tomorrow. Today’s goal stays as it is.');
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
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
