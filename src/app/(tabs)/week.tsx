import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDays, daysBetween } from '../../domain/dates';
import { formatValue, goalEmoji, goalTitle } from '../../domain/format';
import { freeDays, isMovable, sessionOn, type KeySession, type SessionKind, type WeekPlan } from '../../domain/plan';
import type { DateKey, GoalEvent } from '../../domain/types';
import { sourceFor } from '../../sources';
import { useApp } from '../../state/AppState';
import { Button, Card, Field, Label, ProgressBar, styles } from '../../ui/components';
import { colors, STATUS_COLOR } from '../../ui/theme';

const SESSION_LABEL: Record<SessionKind, string> = {
  long_walk: '🥾 Long walk',
  back_to_back: '🥾 Long walk, day 2',
  brisk_walk: '⚡ Brisk walk',
  trek_day: '🏔️ Trek day',
};

const dayName = (d: DateKey) =>
  new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

export default function WeekScreen() {
  const { snapshot, settings } = useApp();
  if (!snapshot || !settings) return null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.h1, { marginBottom: 12 }]}>This week</Text>

        <VolumeCard />
        <WeekList plan={snapshot.plan} />

        {snapshot.nextPlan ? (
          <>
            <Text style={[styles.h2, { marginTop: 8 }]}>Next week · {snapshot.nextPlan.volume?.km ?? '?'} km</Text>
            <Text style={[styles.muted, { marginBottom: 8 }]}>
              Arrange it now if you already know your week. Its km are confirmed on Monday.
            </Text>
            <WeekList plan={snapshot.nextPlan} />
          </>
        ) : (
          <Text style={[styles.hint, { textAlign: 'center', marginBottom: 16 }]}>
            Next week’s plan appears on Sunday evening.
          </Text>
        )}

        <EventCard />
        <CycleCard />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Week n of the plan: km planned / done / left, last week, and why. */
function VolumeCard() {
  const { snapshot, settings } = useApp();
  if (!snapshot || !settings) return null;
  const { volume, doneKm, leftKm, lastWeekKm } = snapshot.week;
  const ev = settings.event;
  const heading = ev
    ? `Toward ${ev.name}`
    : settings.dailyTargetKm
      ? `Toward ${settings.dailyTargetKm} km a day`
      : 'Your weekly plan';
  const badge =
    volume.light === 'period'
      ? '🌸 Light week (period)'
      : volume.light === 'every4'
        ? '🌙 Light week'
        : volume.eventWeek
          ? '🏔️ Event week'
          : volume.preEvent
            ? '🪶 Lighter week before your goal'
            : volume.backToBack
              ? '🥾🥾 Back-to-back week'
              : null;

  return (
    <Card>
      <Label>{heading}</Label>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={styles.h2}>{volume.km} km this week</Text>
        <Text style={styles.muted}>last week {lastWeekKm} km</Text>
      </View>
      {badge && <Text style={styles.body}>{badge}</Text>}
      <ProgressBar fraction={volume.km ? Math.min(1, doneKm / volume.km) : 0} done={leftKm === 0} />
      <Text style={styles.body}>
        {doneKm} km done · {leftKm} km left
      </Text>
      <Text style={[styles.hint, { marginTop: 4 }]}>
        Heading to {volume.destinationKm} km a week, at most +10% a week. Days adapt to what you’ve done: do more
        today and the rest of the week gets lighter.
      </Text>
      {volume.notes.map((n) => (
        <Text key={n} style={[styles.muted, { marginTop: 4 }]}>
          · {n}
        </Text>
      ))}
    </Card>
  );
}

function WeekList({ plan }: { plan: WeekPlan }) {
  const { snapshot, settings, moveKeySession, syncing } = useApp();
  const [moving, setMoving] = useState<string | null>(null);
  if (!snapshot || !settings) return null;
  const today = snapshot.today;
  const todayDone = !!snapshot.todayProgress?.done;
  const days = Array.from({ length: 7 }, (_, i) => addDays(plan.week, i));
  const dropped = plan.sessions.filter((s) => s.dropped);
  const trekIndex = (s: KeySession) => plan.sessions.filter((x) => x.kind === 'trek_day').indexOf(s) + 1;

  return (
    <Card>
      {days.map((d) => {
        const session = sessionOn(plan, d);
        const view = snapshot.days.get(d);
        const goal = view?.goal ?? snapshot.previews[d] ?? null;
        const isFuture = d > today;
        const canMove = session && isMovable(session) && (d > today || (d === today && !todayDone));
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
                    {session.kind === 'trek_day' ? ` ${trekIndex(session)}` : ''}
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
                <Pressable onPress={() => setMoving(moving === session.id ? null : session.id)} hitSlop={8}>
                  <Text style={{ color: colors.accent, fontWeight: '700' }}>Move</Text>
                </Pressable>
              )}
            </View>
            {session && moving === session.id && (
              <View style={[styles.chips, { marginTop: 8 }]}>
                {freeDays(plan, today, todayDone, session.id)
                  .filter((x) => x !== d)
                  .map((x) => (
                    <Pressable
                      key={x}
                      disabled={syncing}
                      style={styles.chip}
                      onPress={async () => {
                        setMoving(null);
                        await moveKeySession(plan.week, session.id, x);
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
        <Text key={s.id} style={[styles.hint, { marginTop: 8 }]}>
          {SESSION_LABEL[s.kind]} skipped this week: no free day was left.
        </Text>
      ))}
    </Card>
  );
}

/** A dated goal (a hike, or a multi-day trek) the plan builds toward. */
function EventCard() {
  const { settings, snapshot, updateSettings, refresh } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(settings?.event?.name ?? '');
  const [km, setKm] = useState(settings?.event ? String(settings.event.km) : '');
  const [days, setDays] = useState(settings?.event?.days ? String(settings.event.days) : '1');
  const [date, setDate] = useState(settings?.event?.date ?? '');
  if (!settings || !snapshot) return null;
  const ev = settings.event;

  const save = async () => {
    const k = Number(km.replace(',', '.'));
    const n = Number(days);
    if (!name.trim()) return Alert.alert('Give your goal a name, e.g. “Sierra Norte trek”.');
    if (!(k >= 3 && k <= 60)) return Alert.alert('Distance per day should be between 3 and 60 km.');
    if (!(Number.isInteger(n) && n >= 1 && n <= 21)) return Alert.alert('Days should be a whole number from 1 to 21.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= snapshot.today) {
      return Alert.alert('Date should look like 2027-07-10 and be in the future.');
    }
    const event: GoalEvent = { name: name.trim(), km: k, date, days: n };
    await updateSettings({ event });
    setEditing(false);
    await refresh({ regenerateToday: true });
  };

  if (!editing && ev && addDays(ev.date, (ev.days ?? 1) - 1) >= snapshot.today) {
    const until = daysBetween(snapshot.today, ev.date);
    const multi = (ev.days ?? 1) >= 2;
    return (
      <Card style={{ borderColor: colors.accent }}>
        <Label>🎯 Goal with a date</Label>
        <Text style={styles.h2}>
          {ev.name}: {multi ? `${ev.days} days × ${ev.km} km` : `${ev.km} km`}
        </Text>
        <Text style={styles.muted}>
          {until <= 0 ? 'It’s on! You’ve trained for this.' : `Starts ${ev.date} · in ${until} days (${Math.round(until / 7)} weeks)`}.
          {multi
            ? ' Your weekly km grows toward it; in the last 8 weeks before the taper the long walk becomes two days in a row.'
            : ' Your weekly km grows toward it, with a lighter week just before.'}
        </Text>
        {snapshot.week.volume.reachableEventKm != null && (
          <Text style={[styles.body, { color: colors.pending, marginTop: 6 }]}>
            ⚠️ At a safe pace you’ll reach about {snapshot.week.volume.reachableEventKm} km by then.
          </Text>
        )}
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
          Training for a hike or a multi-day trek? Add it and your weekly plan builds up to it.
        </Text>
        <Button title="Add a goal with a date" variant="secondary" onPress={() => setEditing(true)} />
      </Card>
    );
  }

  return (
    <Card>
      <Label>🎯 Goal with a date</Label>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Sierra Norte trek" />
      <Field
        label="Distance per day (km)"
        value={km}
        onChangeText={setKm}
        keyboardType="decimal-pad"
        placeholder="15"
        hint="For a multi-day trek, the longest day’s distance."
      />
      <Field label="Days in a row" value={days} onChangeText={setDays} keyboardType="number-pad" placeholder="1" />
      <Field
        label="First day"
        value={date}
        onChangeText={setDate}
        keyboardType="numbers-and-punctuation"
        placeholder="2027-07-10"
      />
      <Button title="Save" onPress={save} />
      <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} />
    </Card>
  );
}

/** Light weeks follow your period: from Health Connect, or a "started today" tap. */
function CycleCard() {
  const { settings, snapshot, updateSettings, refresh, logPeriodStart, syncing } = useApp();
  const [access, setAccess] = useState<boolean | null>(null);
  const [cycleDays, setCycleDays] = useState(String(settings?.cycleDays ?? 28));
  useEffect(() => {
    let cancelled = false;
    const src = settings ? sourceFor(settings) : null;
    src?.hasCycleAccess
      ?.()
      .then((ok) => !cancelled && setAccess(ok))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settings]);
  if (!settings || !snapshot) return null;
  const cycle = snapshot.cycle;

  return (
    <Card>
      <Label>🌸 Light week with your period</Label>
      <Text style={styles.muted}>
        {cycle?.next
          ? `Next period expected around ${dayName(cycle.next.start)}: that week is your light week (25% less, no pace push). Cycle: ${cycle.cycleDays} days${cycle.source === 'history' ? ', learned from your records' : ''}.`
          : 'Tell Daily Spark when your period starts and the light week will fall on it. Without it, every 4th week is light.'}{' '}
        This stays on your phone.
      </Text>
      <Button title="My period started today" variant="secondary" onPress={logPeriodStart} disabled={syncing} />
      {access === false && (
        <Button
          title="Read cycle data from Health Connect"
          variant="secondary"
          onPress={async () => {
            const src = sourceFor(settings);
            const ok = (await src.requestCycleAccess?.().catch(() => false)) ?? false;
            setAccess(ok);
            if (ok) await refresh({ regenerateToday: true });
          }}
        />
      )}
      <Field
        label="Typical cycle length (days)"
        value={cycleDays}
        onChangeText={setCycleDays}
        keyboardType="number-pad"
        hint="Used until 2 cycles are recorded."
      />
      <Button
        title="Save cycle length"
        variant="secondary"
        onPress={async () => {
          const n = Number(cycleDays);
          if (!(Number.isInteger(n) && n >= 18 && n <= 45)) return Alert.alert('Cycle length should be 18–45 days.');
          await updateSettings({ cycleDays: n });
          await refresh({ regenerateToday: true });
        }}
      />
    </Card>
  );
}
