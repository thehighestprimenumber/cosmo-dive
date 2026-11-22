import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { setExtra } from '../data/db';
import { SAFETY_NOTE, STRENGTH_XP, videoUrl } from '../domain/strength';
import { sessionSteps, skipExercise } from '../domain/strengthSession';
import { useApp } from '../state/AppState';
import { Button, Card, Label, ProgressBar, styles } from '../ui/components';
import { colors } from '../ui/theme';

const steps = sessionSteps();
const total = steps[steps.length - 1].index + 1;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Guided strength & mobility on the phone: one exercise at a time, with a
 * countdown for holds and rests and a buzz when it's time to move on. The
 * screen stays on. Finishing ticks today off (+XP), like the watch.
 */
export default function StrengthSessionScreen() {
  useKeepAwake();
  const db = useSQLiteContext();
  const { snapshot, refresh } = useApp();
  const [at, setAt] = useState(0);
  const [left, setLeft] = useState<number | null>(null); // seconds left on a running timer
  const [details, setDetails] = useState(false);
  const [finished, setFinished] = useState(false);
  const endsAt = useRef<number | null>(null);

  const step = steps[at];

  useEffect(() => {
    const id = setInterval(() => {
      if (endsAt.current == null) return;
      const s = Math.max(0, Math.ceil((endsAt.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        endsAt.current = null;
        Vibration.vibrate([0, 300, 150, 300]);
        next();
      }
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function start(seconds: number) {
    endsAt.current = Date.now() + seconds * 1000;
    setLeft(seconds);
  }
  function stop() {
    endsAt.current = null;
    setLeft(null);
  }
  const atRef = useRef(0);
  /** Show step i: a rest starts counting by itself; a timed hold waits for "Empezar". */
  function goTo(i: number) {
    if (i >= steps.length) {
      void finish();
      return;
    }
    atRef.current = i;
    setAt(i);
    setDetails(false);
    if (steps[i].rest) start(steps[i].seconds ?? 30);
    else stop();
  }
  function next() {
    goTo(atRef.current + 1);
  }
  async function finish() {
    stop();
    setFinished(true);
    Vibration.vibrate([0, 150, 120, 150, 120, 150]);
    if (snapshot) {
      await setExtra(db, snapshot.today, 'strength', true);
      await refresh();
    }
  }

  if (finished) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={[styles.content, { flex: 1, justifyContent: 'center' }]}>
          <Text style={[styles.h1, { textAlign: 'center' }]}>¡Listo! 🦵</Text>
          <Text style={[styles.body, { textAlign: 'center', marginVertical: 12 }]}>
            Fuerza y movilidad hecha hoy. +{STRENGTH_XP} XP.
          </Text>
          <Button title="Volver" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const e = step.exercise;
  const timing = left != null;
  const nextStep = steps[at + 1];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={[styles.body, { color: colors.accent }]}>‹ Salir</Text>
          </Pressable>
          <Text style={styles.muted}>
            Ejercicio {step.index + 1} de {total}
          </Text>
        </View>
        <ProgressBar fraction={at / (steps.length - 1)} done={false} />

        {step.rest ? (
          <Card>
            <Label>Descanso</Label>
            <Text style={[styles.h1, { textAlign: 'center', color: colors.accent, marginVertical: 12 }]}>{fmt(left ?? step.seconds ?? 0)}</Text>
            {nextStep && (
              <Text style={[styles.body, { textAlign: 'center' }]}>
                Sigue: {nextStep.exercise.name}
                {nextStep.side ? ` (${nextStep.side})` : ''} · serie {nextStep.set} de {nextStep.exercise.guide.sets}
              </Text>
            )}
            <Button title="Seguir ya" onPress={next} />
          </Card>
        ) : (
          <Card>
            <Label>
              Serie {step.set} de {e.guide.sets}
              {step.side ? ` · ${step.side}` : ''}
            </Label>
            <Text style={styles.h1}>{e.name}</Text>
            <Text style={[styles.h2, { marginVertical: 8 }]}>
              {e.guide.reps ? `${e.guide.reps} repeticiones` : `${step.seconds} segundos`}
              {step.side ? ` · pierna/lado ${step.side}` : ''}
            </Text>
            {step.seconds != null && (
              <Text style={[styles.h1, { textAlign: 'center', color: colors.accent, marginVertical: 8 }]}>{fmt(left ?? step.seconds)}</Text>
            )}
            {step.seconds != null && !timing ? (
              <Button title="▶ Empezar" onPress={() => start(step.seconds!)} />
            ) : (
              <Button title="✓ Listo" onPress={next} />
            )}
            <Text style={[styles.body, { marginTop: 10 }]}>⚠️ {e.careful[0]}</Text>
            <Pressable onPress={() => setDetails((d) => !d)} hitSlop={6} style={{ marginTop: 8 }}>
              <Text style={[styles.body, { color: colors.accent }]}>{details ? 'Ocultar' : 'Cómo se hace'} ▾</Text>
            </Pressable>
            {details && (
              <View style={{ marginTop: 6 }}>
                {e.steps.map((s, i) => (
                  <Text key={i} style={[styles.body, { marginBottom: 4 }]}>
                    {i + 1}. {s}
                  </Text>
                ))}
                {e.careful.slice(1).map((c, i) => (
                  <Text key={i} style={[styles.body, { marginBottom: 4 }]}>
                    • {c}
                  </Text>
                ))}
                <Text style={[styles.muted, { marginTop: 4 }]}>Más fácil: {e.easier}</Text>
                <Pressable onPress={() => Linking.openURL(videoUrl(e))} hitSlop={6} style={{ marginTop: 8 }}>
                  <Text style={[styles.body, { color: colors.accent, fontWeight: '700' }]}>▶ Ver cómo se hace (YouTube)</Text>
                </Pressable>
              </View>
            )}
            <Button title="Saltar ejercicio" variant="secondary" onPress={() => goTo(skipExercise(steps, at))} />
          </Card>
        )}
        <Text style={styles.hint}>⚠️ {SAFETY_NOTE}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
