import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDays, daysBetween } from '../../domain/dates';
import { formatValue, goalEmoji, goalTitle } from '../../domain/format';
import { freeDays, sessionOn, type KeySession, type WeekPlan } from '../../domain/plan';
import type { DateKey, GoalEvent } from '../../domain/types';
import { useApp } from '../../state/AppState';
import { Button, Card, Field, Label, styles } from '../../ui/components';
import { colors, STATUS_COLOR } from '../../ui/theme';

const SESSION_LABEL = { long_walk: '🥾 Long walk', brisk_walk: '⚡ Brisk walk' } as const;

const dayName = (d: DateKey) =>
  new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

export default function WeekScreen() {
  const { snapshot, settings } = useApp();
  if (!snapshot || !settings) return null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.h1, { marginBottom: 4 }]}>This week</Text>
        <Text style={[styles.muted, { marginBottom: 16 }]}>
          Two key sessions a week: a 🥾 long walk and a ⚡ brisk walk; the other days keep your daily goal. Busy day?
          Move a session. A missed one slides to your next free day. {snapshot.streak.restLeftThisWeek} rest day
          {snapshot.streak.restLeftThisWeek === 1 ? '' : 's'} left this week.
        </Text>

        <EventCard />

        <WeekList plan={snapshot.plan} />

        {snapshot.nextPlan ? (
          <>
            <Text style={[styles.h2, { marginTop: 8 }]}>Next week</Text>
            <Text style={[styles.muted, { marginBottom: 8 }]}>Arrange it now if you already know your week.</Text>
            <WeekList plan={snapshot.nextPlan} />
          </>
        ) : (
          <Text style={[styles.hint, { textAlign: 'center' }]}>Next week’s plan appears on Sunday evening.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function WeekList({ plan }: { plan: WeekPlan }) {
  const { snapshot, settings, moveKeySession, syncing } = useApp();
  const [moving, setMoving] = useState<KeySession['kind'] | null>(null);
  if (!snapshot || !settings) return null;
  const today = snapshot.today;
  const todayDone = !!snapshot.todayProgress?.done;
  const days = Array.from({ length: 7 }, (_, i) => addDays(plan.week, i));
  const dropped = plan.sessions.filter((s) => s.dropped);

  return (
    <Card>
      {days.map((d) => {
        const session = sessionOn(plan, d);
        const view = snapshot.days.get(d);
        const goal = view?.goal ?? snapshot.previews[d] ?? null;
        const isFuture = d > today;
        const canMove = session && (d > today || (d === today && !todayDone));
        const status = view?.status ?? (isFuture ? 'future' : 'none');
        return (
          <View key={d} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.cardBorder }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: STATUS_COLOR[status] }} />
              <Text style={[styles.body, { width: 92, fontWeight: d === today ? '800' : '400' }]}>
                {d === today ? 'Today' : dayName(d)}
              </Text>
              <View style={{ flex: 1 }}>
                {session ? (
                  <Text style={styles.body}>
                    {SESSION_LABEL[session.kind]}
                    {goal && 'meters' in goal ? ` · ${isFuture ? 'about ' : ''}${formatValue(goal, goal.meters)}` : ''}
                  </Text>
                ) : goal && !isFuture ? (
                  <Text style={styles.muted}>
                    {goalEmoji(goal)} {goalTitle(goal, settings)}
                  </Text>
                ) : (
                  <Text style={styles.muted}>{isFuture ? 'Daily goal, set on the day' : '—'}</Text>
                )}
                {session && session.day !== session.plannedDay && (
                  <Text style={styles.hint}>Moved from {dayName(session.plannedDay)}</Text>
                )}
              </View>
              {canMove && (
                <Pressable onPress={() => setMoving(moving === session.kind ? null : session.kind)} hitSlop={8}>
                  <Text style={{ color: colors.accent, fontWeight: '700' }}>Move</Text>
                </Pressable>
              )}
            </View>
            {session && moving === session.kind && (
              <View style={[styles.chips, { marginTop: 8 }]}>
                {freeDays(plan, today, todayDone, session.kind)
                  .filter((x) => x !== d)
                  .map((x) => (
                    <Pressable
                      key={x}
                      disabled={syncing}
                      style={styles.chip}
                      onPress={async () => {
                        setMoving(null);
                        await moveKeySession(plan.week, session.kind, x);
                      }}
                    >
                      <Text style={styles.chipText}>{x === today ? 'Today' : dayName(x)}</Text>
                    </Pressable>
                  ))}
              </View>
            )}
          </View>
        );
      })}
      {dropped.map((s) => (
        <Text key={s.kind} style={[styles.hint, { marginTop: 8 }]}>
          {SESSION_LABEL[s.kind]} skipped this week: no free day was left.
        </Text>
      ))}
    </Card>
  );
}

/** A dated goal (e.g. a hike) the long walk builds toward. */
function EventCard() {
  const { settings, snapshot, updateSettings, refresh } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(settings?.event?.name ?? '');
  const [km, setKm] = useState(settings?.event ? String(settings.event.km) : '');
  const [date, setDate] = useState(settings?.event?.date ?? '');
  if (!settings || !snapshot) return null;
  const ev = settings.event;

  const save = async () => {
    const k = Number(km.replace(',', '.'));
    if (!name.trim()) return Alert.alert('Give your goal a name, e.g. “Coastal hike”.');
    if (!(k >= 3 && k <= 60)) return Alert.alert('Distance should be between 3 and 60 km.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= snapshot.today) {
      return Alert.alert('Date should look like 2026-12-31 and be in the future.');
    }
    const event: GoalEvent = { name: name.trim(), km: k, date };
    await updateSettings({ event });
    setEditing(false);
    await refresh({ regenerateToday: true });
  };

  if (!editing && ev && ev.date >= snapshot.today) {
    const days = daysBetween(snapshot.today, ev.date);
    return (
      <Card style={{ borderColor: colors.accent }}>
        <Label>🎯 Goal with a date</Label>
        <Text style={styles.h2}>
          {ev.name}: {ev.km} km
        </Text>
        <Text style={styles.muted}>
          {days === 0 ? 'Today! You’ve trained for this.' : `${ev.date} · in ${days} day${days === 1 ? '' : 's'}`}.
          Your weekly long walk builds up to it and gets lighter the week before.
        </Text>
        <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} />
        <Button
          title="Remove"
          variant="secondary"
          onPress={async () => {
            await updateSettings({ event: null });
            await refresh({ regenerateToday: true });
          }}
        />
      </Card>
    );
  }

  if (!editing) {
    return (
      <Card>
        <Label>🎯 Goal with a date</Label>
        <Text style={styles.muted}>
          Training for a hike or a long walk? Add it and your weekly long walk builds up to it.
        </Text>
        <Button title="Add a goal with a date" variant="secondary" onPress={() => setEditing(true)} />
      </Card>
    );
  }

  return (
    <Card>
      <Label>🎯 Goal with a date</Label>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Coastal hike" />
      <Field label="Distance (km)" value={km} onChangeText={setKm} keyboardType="decimal-pad" placeholder="15" />
      <Field
        label="Date"
        value={date}
        onChangeText={setDate}
        keyboardType="numbers-and-punctuation"
        placeholder="2026-12-31"
      />
      <Button title="Save" onPress={save} />
      <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} />
    </Card>
  );
}
