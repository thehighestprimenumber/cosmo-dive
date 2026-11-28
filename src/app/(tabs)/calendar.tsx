import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDays, mondayOf } from '../../domain/dates';
import { setExtra } from '../../data/db';
import { BIG_DAY, bigDay, FOCUS_NAME } from '../../domain/strength';
import { goalTarget } from '../../domain/progress';
import { formatMinutes, formatValue, goalEmoji, goalTitle } from '../../domain/format';
import type { DateKey, DayStatus } from '../../domain/types';
import { RECHECK_DAYS } from '../../services/sync';
import { useApp } from '../../state/AppState';
import { Button, Card, styles } from '../../ui/components';
import { colors, STATUS_COLOR } from '../../ui/theme';

const STATUS_LABEL: Record<DayStatus, string> = {
  done: 'Done',
  missed: 'Missed',
  frozen: 'Saved by a freeze',
  rest: 'Rest day (flexible)',
  pending: 'In progress',
  none: 'No goal',
};

const monthKey = (year: number, month: number): DateKey => `${year}-${String(month + 1).padStart(2, '0')}-01`;

export default function CalendarScreen() {
  const { snapshot, settings, refresh } = useApp();
  const db = useSQLiteContext();
  /** Strength done on a past day you forgot to mark: that day is redone (and the streak with it). */
  const markStrength = async (date: DateKey, done: boolean) => {
    await setExtra(db, date, 'strength', done);
    await refresh({ fullRebuild: date < addDays(snapshot!.today, -RECHECK_DAYS) });
  };
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState<DateKey | null>(snapshot?.today ?? null);

  const first = monthKey(ym.y, ym.m);
  const weeks = useMemo(() => {
    const out: DateKey[][] = [];
    let d = mondayOf(first);
    const nextMonth = monthKey(ym.m === 11 ? ym.y + 1 : ym.y, (ym.m + 1) % 12);
    while (d < nextMonth) {
      out.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
      d = addDays(d, 7);
    }
    return out;
  }, [first, ym]);

  const shift = (delta: number) =>
    setYm(({ y, m }) => {
      const total = y * 12 + m + delta;
      return { y: Math.floor(total / 12), m: total % 12 };
    });

  const monthName = new Date(ym.y, ym.m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const day = selected ? snapshot?.days.get(selected) : undefined;
  const big = !!day?.goal && bigDay(day.value, goalTarget(day.goal));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Pressable onPress={() => shift(-1)} hitSlop={16}>
            <Text style={styles.h2}>‹</Text>
          </Pressable>
          <Text style={styles.h2}>{monthName}</Text>
          <Pressable onPress={() => shift(1)} hitSlop={16}>
            <Text style={styles.h2}>›</Text>
          </Pressable>
        </View>

        <Card>
          <View style={{ flexDirection: 'row' }}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <Text key={i} style={[styles.muted, { flex: 1, textAlign: 'center', marginBottom: 8 }]}>
                {d}
              </Text>
            ))}
          </View>
          {weeks.map((week) => (
            <View key={week[0]} style={{ flexDirection: 'row' }}>
              {week.map((date) => {
                const inMonth = date.slice(0, 7) === first.slice(0, 7);
                const status = snapshot?.days.get(date)?.status ?? 'none';
                const isSel = date === selected;
                return (
                  <Pressable
                    key={date}
                    onPress={() => setSelected(date)}
                    style={{ flex: 1, aspectRatio: 1, padding: 3 }}
                  >
                    <View
                      style={{
                        flex: 1,
                        borderRadius: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: inMonth ? STATUS_COLOR[status] : 'transparent',
                        borderWidth: isSel ? 2 : 0,
                        borderColor: colors.text,
                        opacity: inMonth ? 1 : 0.3,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '600' }}>{Number(date.slice(8))}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Card>

        <View style={[styles.chips, { marginBottom: 16 }]}>
          {(['done', 'frozen', 'missed', 'rest', 'pending'] as DayStatus[]).map((s) => (
            <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: STATUS_COLOR[s] }} />
              <Text style={styles.muted}>{STATUS_LABEL[s]}</Text>
            </View>
          ))}
        </View>

        {selected && settings && (
          <Card>
            <Text style={styles.label}>
              {new Date(selected + 'T12:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
            {day ? (
              <>
                <Text style={styles.h2}>
                  {day.meta?.boss ? '⚔️ ' : ''}{goalEmoji(day.goal)} {day.goal ? goalTitle(day.goal, settings) : 'Rest day'}
                </Text>
                <Text style={styles.muted}>
                  {STATUS_LABEL[day.status]}
                  {day.goal
                    ? ` · ${formatValue(day.goal, day.value)} achieved`
                    : day.value > 0
                      ? ` · ${formatMinutes(day.value)} moved`
                      : ''}
                </Text>
                {day.meta?.strength && (
                  <>
                    <Text style={[styles.body, { marginTop: 6 }]}>
                      {day.strengthDone ? '✅' : '💪'} + {day.meta.strength.minutes} min of strength ·{' '}
                      {FOCUS_NAME[day.meta.strength.focus].toLowerCase()} ·{' '}
                      {day.strengthDone ? 'done' : big ? 'covered by a big day' : 'not done'}
                    </Text>
                    {!day.strengthDone && !big && (
                      <Text style={styles.hint}>
                        The day counts with both the walking goal and the strength part, or with {BIG_DAY}× the walking
                        goal.
                      </Text>
                    )}
                    {(!day.strengthDone || day.strengthTicked) && selected <= snapshot!.today && (
                      <Button
                        variant="secondary"
                        title={day.strengthTicked ? '✓ Strength marked done (undo)' : 'I did the strength: mark done'}
                        onPress={() => void markStrength(selected, !day.strengthTicked)}
                      />
                    )}
                  </>
                )}
              </>
            ) : (
              <Text style={styles.muted}>
                {selected < (settings.startDate ?? '') ? 'Before your plan started.' : 'No goal for this day.'}
              </Text>
            )}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
