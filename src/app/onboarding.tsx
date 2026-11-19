import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toDateKey } from '../domain/dates';
import { DEFAULT_SETTINGS } from '../domain/types';
import { estimateMaxHr } from '../domain/zones';
import { setupNotifications } from '../services/notifications';
import { useApp } from '../state/AppState';
import { Button, Card, Field, Label, RestPerWeekPicker, styles } from '../ui/components';
import { colors } from '../ui/theme';

export default function Onboarding() {
  const { connect, updateSettings, refresh, sourceStatus } = useApp();
  const [connected, setConnected] = useState<'health_connect' | 'demo' | null>(null);
  const [age, setAge] = useState('');
  const [restDaysPerWeek, setRestDaysPerWeek] = useState(DEFAULT_SETTINGS.restDaysPerWeek);
  const [busy, setBusy] = useState(false);

  const ageNum = Number(age);
  const validAge = ageNum >= 10 && ageNum <= 100;

  const connectHc = async () => {
    setBusy(true);
    if (await connect('health_connect')) setConnected('health_connect');
    setBusy(false);
  };

  const useDemo = async () => {
    await connect('demo');
    setConnected('demo');
  };

  const start = async () => {
    setBusy(true);
    await updateSettings({
      restDaysPerWeek,
      maxHr: estimateMaxHr(ageNum),
      startDate: toDateKey(new Date()),
      onboarded: true,
    });
    await setupNotifications().catch(() => false);
    await refresh();
    setBusy(false);
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 56, textAlign: 'center', marginTop: 24 }}>🔥</Text>
        <Text style={[styles.h1, { textAlign: 'center' }]}>Daily Spark</Text>
        <Text style={[styles.muted, { textAlign: 'center', marginBottom: 24 }]}>
          A new walking or riding goal every day. Hit it, keep your streak alive.
        </Text>

        <Card style={connected ? { borderColor: colors.done } : undefined}>
          <Label>1 · Your activities</Label>
          <Text style={[styles.muted, { marginBottom: 8 }]}>
            Daily Spark reads the walks and rides your watch records, via Samsung Health → Health Connect. Nothing
            leaves your phone.
          </Text>
          {connected ? (
            <Text style={styles.body}>✅ {connected === 'demo' ? 'Using demo data' : 'Connected to Health Connect'}</Text>
          ) : (
            <>
              <Button title="Connect Health Connect" onPress={connectHc} disabled={busy} />
              {sourceStatus && sourceStatus.state !== 'ready' && (
                <Text style={[styles.hint, { color: colors.pending }]}>
                  {sourceStatus.state === 'unavailable'
                    ? sourceStatus.reason
                    : 'Permission not granted. Allow exercise, distance and heart rate, then try again.'}
                </Text>
              )}
              <Button title="Try with demo data" variant="secondary" onPress={useDemo} />
            </>
          )}
        </Card>

        <Card>
          <Label>2 · Heart rate zones</Label>
          <Field
            label="Your age"
            value={age}
            onChangeText={setAge}
            keyboardType="number-pad"
            placeholder="e.g. 40"
            hint={validAge ? `Estimated max heart rate: ${estimateMaxHr(ageNum)} bpm (you can change it later).` : undefined}
          />
        </Card>

        <Card>
          <Label>3 · Rest days</Label>
          <Text style={[styles.muted, { marginBottom: 8 }]}>
            No fixed days: every day has a goal, and any day you skip uses one of your rest days for that week.
            Rest days never break your streak.
          </Text>
          <RestPerWeekPicker value={restDaysPerWeek} onChange={setRestDaysPerWeek} />
        </Card>

        <Button title={busy ? 'Starting…' : 'Start my plan'} onPress={start} disabled={!connected || !validAge || busy} />
      </ScrollView>
    </SafeAreaView>
  );
}
