import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { openHealthConnectSettings } from 'react-native-health-connect';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseTime } from '../../domain/dates';
import { zoneRange } from '../../domain/zones';
import { exportHistory, importHistory } from '../../services/backupFiles';
import { formatTime, nudgeTime } from '../../domain/habits';
import { useApp } from '../../state/AppState';
import type { Settings } from '../../domain/types';
import { deleteApiKey, getApiKey, setApiKey } from '../../services/coach';
import { Button, Card, Field, Label, RestPerWeekPicker, styles } from '../../ui/components';

export default function SettingsScreen() {
  const { settings } = useApp();
  if (!settings) return null;
  // Remount the form whenever the saved settings change, so it starts from them.
  return <SettingsForm key={JSON.stringify(settings)} settings={settings} />;
}

function SettingsForm({ settings }: { settings: Settings }) {
  const db = useSQLiteContext();
  const { updateSettings, refresh, connect, syncing, reloadAll } = useApp();
  const [restDaysPerWeek, setRestDaysPerWeek] = useState(settings.restDaysPerWeek);
  const [maxHr, setMaxHr] = useState(String(settings.maxHr));
  const [rideFactor, setRideFactor] = useState(String(settings.rideFactor));
  const [aimKm, setAimKm] = useState(settings.dailyTargetKm ? String(settings.dailyTargetKm) : '');
  const [morning, setMorning] = useState(settings.morningReminder);
  const [evening, setEvening] = useState(settings.eveningReminder);
  const [smart, setSmart] = useState(settings.smartReminder);
  const usual = useApp().snapshot?.usualTime ?? null;

  const save = async () => {
    const hr = Number(maxHr);
    const factor = Number(rideFactor.replace(',', '.'));
    const aim = aimKm.trim() ? Number(aimKm.replace(',', '.')) : null;
    if (aim != null && !(aim > 0 && aim <= 40)) return Alert.alert('Aim should be between 0 and 40 km a day, or empty.');
    if (!(hr >= 120 && hr <= 230)) return Alert.alert('Max heart rate should be between 120 and 230.');
    if (!(factor >= 1 && factor <= 10)) return Alert.alert('Ride factor should be between 1 and 10.');
    if (!parseTime(morning) || !parseTime(evening)) return Alert.alert('Reminder times should look like 08:00.');
    await updateSettings({
      restDaysPerWeek,
      maxHr: hr,
      rideFactor: factor,
      dailyTargetKm: aim,
      morningReminder: morning,
      eveningReminder: evening,
      smartReminder: smart,
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
          <Text style={[styles.muted, { marginBottom: 8 }]}>
            Flexible: any day you skip uses one of these for that week.
          </Text>
          <RestPerWeekPicker value={restDaysPerWeek} onChange={setRestDaysPerWeek} />
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
            label="Aim: average km per day (optional)"
            value={aimKm}
            onChangeText={setAimKm}
            keyboardType="decimal-pad"
            placeholder="e.g. 5"
            hint={
              Number(aimKm) > 0
                ? `Averaging ${aimKm} km over every day means about ${(
                    (Number(aimKm.replace(',', '.')) * 7) /
                    Math.max(1, 7 - restDaysPerWeek)
                  ).toFixed(1)} km on training days. Goals start at 60% of that at least and go up 10% each time you complete one, until they get there. The monthly challenge becomes at least ${aimKm} km × days in the month.`
                : 'Leave empty to base goals only on your history.'
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label>Remind me before my usual time</Label>
            <Switch value={smart} onValueChange={setSmart} />
          </View>
          <Text style={styles.hint}>
            {usual
              ? `You usually start moving around ${formatTime(usual)}, so the reminder comes at ${formatTime(nudgeTime(usual))}.`
              : 'Learns from your walks and rides; needs about 5 days of data.'}
          </Text>
          <Button title="Save" onPress={save} />
        </Card>

        <CoachSettings settings={settings} />

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

/** AI coach: on/off, the Claude API key (secure storage only) and what it may see. */
function CoachSettings({ settings }: { settings: Settings }) {
  const { updateSettings } = useApp();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState('');

  useEffect(() => {
    getApiKey().then((k) => setHasKey(!!k));
  }, []);

  const saveKey = async () => {
    const k = key.trim();
    if (!k.startsWith('sk-ant-')) return Alert.alert('That doesn’t look like a Claude API key (they start with sk-ant-).');
    await setApiKey(k);
    setKey('');
    setHasKey(true);
    if (!settings.coachEnabled) await updateSettings({ coachEnabled: true });
  };

  const removeKey = () =>
    Alert.alert('Remove the API key?', 'The weekly review stops until you add one again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteApiKey();
          setHasKey(false);
        },
      },
    ]);

  return (
    <Card>
      <Label>🧠 AI coach</Label>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={styles.body}>Weekly review on Sunday evening</Text>
        <Switch value={settings.coachEnabled} onValueChange={(v) => void updateSettings({ coachEnabled: v })} />
      </View>
      <Text style={[styles.hint, { marginBottom: 8 }]}>
        Claude reviews your week and suggests up to two changes to next week (move a key session, or fewer or a few
        more km). The plan’s safety rules check them, and nothing changes unless you tap Apply. It sends a summary of
        this week and next week’s plan: goals, km, which days you walked, how rested you were. No raw workouts or
        heart rate. Costs a few cents a month on your Anthropic account.
      </Text>
      {hasKey ? (
        <>
          <Text style={[styles.body, { marginBottom: 4 }]}>✓ Claude API key saved (encrypted, on this phone only)</Text>
          <Button title="Remove API key" variant="secondary" onPress={removeKey} />
        </>
      ) : (
        <>
          <Field
            label="Claude API key"
            value={key}
            onChangeText={setKey}
            placeholder="sk-ant-…"
            secure
            hint="Create one at console.anthropic.com → API keys. It's stored encrypted on this phone, never in backups."
          />
          <Button title="Save API key" onPress={saveKey} disabled={!key.trim()} />
        </>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <Text style={[styles.body, { flex: 1 }]}>Morning check-in</Text>
        <Switch value={settings.dailyCheckin} onValueChange={(v) => void updateSettings({ dailyCheckin: v })} />
      </View>
      <Text style={styles.hint}>
        Only on mornings when something stands out: after a very big day, a short night, two days without the goal,
        falling behind on the week, no rest days left, or something you told the coach. Ordinary days: no message.
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <Text style={[styles.body, { flex: 1 }]}>Share my cycle with the coach</Text>
        <Switch value={settings.coachShareCycle} onValueChange={(v) => void updateSettings({ coachShareCycle: v })} />
      </View>
      <Text style={styles.hint}>
        Off: the coach only sees “light week”. On: it also sees that it’s for your period and when the next one is due.
      </Text>
    </Card>
  );
}
