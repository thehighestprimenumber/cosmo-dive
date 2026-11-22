import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { saveFeeling, setExtra } from '../data/db';
import { RPE_LABELS } from '../domain/effort';
import type { SessionKind } from '../domain/plan';
import { SAFETY_NOTE, STRENGTH_PER_WEEK, STRENGTH_ROUTINE, STRENGTH_XP, videoUrl, type Exercise } from '../domain/strength';
import { useApp } from '../state/AppState';
import { Button, Card, Label, styles } from './components';
import { colors } from './theme';

const SESSION: Record<SessionKind, string> = {
  long_walk: '🥾 long walk',
  back_to_back: '🥾 second long walk',
  brisk_walk: '⚡ brisk walk',
  trek_day: '🏔️ trek day',
};

/** "How did it feel?" after a key session: one tap, 1–10. */
export function RateCard() {
  const db = useSQLiteContext();
  const { snapshot, refresh } = useApp();
  const [picked, setPicked] = useState<number | null>(null);
  const r = snapshot?.toRate;
  if (!snapshot || !r) return null;
  const when = r.date === snapshot.today ? 'today' : 'yesterday';
  const rate = async (n: number) => {
    setPicked(n);
    await saveFeeling(db, r.date, n);
    await refresh();
  };
  return (
    <Card>
      <Label>How did it feel?</Label>
      <Text style={[styles.body, { marginBottom: 8 }]}>
        Your {SESSION[r.kind]} {when}: 1 = very easy, 10 = all out.
      </Text>
      <View style={[styles.chips, { justifyContent: 'space-between' }]}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <Pressable
            key={n}
            onPress={() => rate(n)}
            disabled={picked != null}
            style={[styles.chip, { minWidth: 44, alignItems: 'center' }, picked === n && styles.chipOn]}
          >
            <Text style={styles.chipText}>{n}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        {picked ? RPE_LABELS[picked] : 'At 9–10 the plan holds before the next step, and the brisk pace waits.'}
      </Text>
    </Card>
  );
}

/** Strength & mobility: 10 minutes, twice a week, ticked off by hand. */
export function StrengthCard() {
  const db = useSQLiteContext();
  const { snapshot, refresh } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!snapshot) return null;
  const { thisWeek, today } = snapshot.strength;
  const done = thisWeek.length;
  // Done for the week and not today: nothing to show.
  if (done >= STRENGTH_PER_WEEK && !today) return null;
  const toggle = async () => {
    setBusy(true);
    try {
      await setExtra(db, snapshot.today, 'strength', !today);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={today ? { borderColor: colors.done } : undefined}>
      <Pressable onPress={() => setOpen((o) => !o)}>
        <Label>🦵 Strength & mobility · {done} of {STRENGTH_PER_WEEK} this week</Label>
        <Text style={styles.muted}>
          10 minutes for trail legs and ankles, any {STRENGTH_PER_WEEK} days you like. +{STRENGTH_XP} XP.{' '}
          <Text style={{ color: colors.accent }}>{open ? 'Hide' : 'Show'} the routine</Text>
        </Text>
      </Pressable>
      {open && (
        <View style={{ marginTop: 6 }}>
          {STRENGTH_ROUTINE.map((x) => (
            <ExerciseView key={x.id} exercise={x} />
          ))}
          <Text style={[styles.hint, { marginTop: 8 }]}>⚠️ {SAFETY_NOTE}</Text>
        </View>
      )}
      <Button
        title={today ? '✓ Done today (undo)' : 'Done today'}
        variant={today ? 'secondary' : 'primary'}
        onPress={toggle}
        disabled={busy}
      />
    </Card>
  );
}

/** One exercise: tap for how to do it, what to watch out for, an easier version and a video. */
function ExerciseView({ exercise: x }: { exercise: Exercise }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.cardBorder, paddingVertical: 8 }}>
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={6}>
        <Text style={styles.body}>
          <Text style={{ fontWeight: '700' }}>{x.name}</Text> · {x.dose} <Text style={{ color: colors.accent }}>{open ? '▴' : '▾'}</Text>
        </Text>
        <Text style={styles.hint}>{x.why}</Text>
      </Pressable>
      {open && (
        <View style={{ marginTop: 6 }}>
          <Text style={styles.label}>Cómo</Text>
          {x.steps.map((st, i) => (
            <Text key={i} style={[styles.body, { marginBottom: 4 }]}>
              {i + 1}. {st}
            </Text>
          ))}
          <Text style={[styles.label, { marginTop: 6 }]}>Cuidado</Text>
          {x.careful.map((c, i) => (
            <Text key={i} style={[styles.body, { marginBottom: 4 }]}>
              • {c}
            </Text>
          ))}
          <Text style={[styles.label, { marginTop: 6 }]}>Más fácil para empezar</Text>
          <Text style={styles.body}>{x.easier}</Text>
          <Pressable onPress={() => Linking.openURL(videoUrl(x))} hitSlop={6} style={{ marginTop: 8 }}>
            <Text style={[styles.body, { color: colors.accent, fontWeight: '700' }]}>▶ Ver cómo se hace (YouTube)</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
