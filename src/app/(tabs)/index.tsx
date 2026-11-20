import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatKm, formatMinutes, formatValue, goalEmoji, goalSubtitle, goalTitle } from '../../domain/format';
import { weekSummary } from '../../domain/summary';
import type { Activity, GoalKind } from '../../domain/types';
import { ACHIEVEMENTS } from '../../domain/game';
import { sourceFor } from '../../sources';
import { useApp } from '../../state/AppState';
import { Button, Card, ProgressBar, styles } from '../../ui/components';
import { colors, STATUS_COLOR } from '../../ui/theme';

export default function TodayScreen() {
  const { settings, snapshot, syncing, error, sourceStatus, refresh, connect } = useApp();
  const done = !!snapshot?.todayProgress?.done;
  const game = snapshot?.game;
  const unlockedToday = game
    ? ACHIEVEMENTS.filter((a) => game.achievements[a.id] === snapshot?.today)
    : [];

  // Sleep is an optional extra permission; offer it if it's missing.
  const [sleepAccess, setSleepAccess] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const src = settings ? sourceFor(settings) : null;
    src?.hasSleepAccess
      ?.()
      .then((ok) => !cancelled && setSleepAccess(ok))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settings]);
  const allowSleep = async () => {
    const src = settings ? sourceFor(settings) : null;
    const ok = (await src?.requestSleepAccess?.().catch(() => false)) ?? false;
    setSleepAccess(ok);
    if (ok) refresh();
  };

  // Pop the flame when today's goal flips to done.
  const [scale] = useState(() => new Animated.Value(1));
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current) {
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.6, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 3, useNativeDriver: true }),
      ]).start();
    }
    wasDone.current = done;
  }, [done, scale]);

  if (!settings) return null;
  const streak = snapshot?.streak;
  const goal = snapshot?.todayGoal;
  const progress = snapshot?.todayProgress;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => refresh()} tintColor={colors.accent} />}
      >
        {/* Streak header */}
        <View style={{ alignItems: 'center', marginVertical: 24 }}>
          <Animated.Text style={{ fontSize: 64, transform: [{ scale }] }}>{done ? '🔥' : '🔸'}</Animated.Text>
          <Text style={[styles.h1, { fontSize: 48 }]}>{streak?.current ?? 0}</Text>
          <Text style={styles.muted}>day streak · best {streak?.longest ?? 0}</Text>
          <Text style={[styles.muted, { marginTop: 4 }]}>
            {'🧊'.repeat(streak?.freezes ?? 0) || 'No freezes'}
            {'  ·  '}next freeze in {streak?.nextFreezeIn ?? 7} done days
          </Text>
          {game && (
            <View style={{ alignSelf: 'stretch', marginTop: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.body}>⭐ Level {game.level}</Text>
                <Text style={styles.muted}>
                  {game.into} / {game.needed} XP
                </Text>
              </View>
              <ProgressBar fraction={game.into / game.needed} done={false} />
            </View>
          )}
        </View>

        {unlockedToday.length > 0 && (
          <Card style={{ borderColor: colors.pending }}>
            <Text style={styles.label}>New achievement{unlockedToday.length > 1 ? 's' : ''}</Text>
            {unlockedToday.map((a) => (
              <Text key={a.id} style={styles.h2}>
                {a.emoji} {a.title}
              </Text>
            ))}
          </Card>
        )}

        {sourceStatus && sourceStatus.state !== 'ready' && (
          <Card style={{ borderColor: colors.pending }}>
            <Text style={styles.h2}>Can’t read your activities</Text>
            <Text style={styles.muted}>
              {sourceStatus.state === 'unavailable'
                ? sourceStatus.reason
                : 'Daily Spark needs permission to read exercise, distance and heart rate from Health Connect.'}
            </Text>
            {sourceStatus.state === 'needs_permission' && (
              <Button title="Grant access" onPress={async () => (await connect()) && refresh()} />
            )}
          </Card>
        )}

        {error && (
          <Card style={{ borderColor: colors.missed }}>
            <Text style={styles.h2}>Sync failed</Text>
            <Text style={styles.muted}>{error}</Text>
          </Card>
        )}

        {/* Today's goal */}
        {goal === null && (
          <Card>
            <Text style={styles.h2}>😴 Rest day</Text>
            <Text style={styles.muted}>From your old fixed schedule. Your streak is safe today.</Text>
          </Card>
        )}
        {goal && progress && (
          <Card style={done ? { borderColor: colors.done } : undefined}>
            <Text style={styles.label}>{snapshot.todayBoss ? '⚔️ Boss day' : 'Today’s goal'}</Text>
            <Text style={styles.h2}>
              {goalEmoji(goal)} {goalTitle(goal, settings)}
            </Text>
            {snapshot.todayReadiness === 'low' && <Text style={styles.body}>🪫 Take it easier today</Text>}
            {snapshot.todayReadiness === 'high' && <Text style={styles.body}>🔋 Well rested: a little extra today</Text>}
            <Text style={styles.muted}>{goalSubtitle(goal, settings)}</Text>
            <ProgressBar fraction={progress.fraction} done={done} />
            <Text style={styles.body}>
              {done
                ? `Goal complete! 🎉 ${formatValue(goal, progress.value)}`
                : `${formatValue(goal, progress.value)} of ${formatValue(goal, progress.target)}`}
            </Text>
            {!done && streak && (
              <Text style={[styles.hint, { marginTop: 8 }]}>
                {streak.restLeftThisWeek > 0
                  ? `Not today? Skipping uses 1 of your ${streak.restLeftThisWeek} rest day${streak.restLeftThisWeek === 1 ? '' : 's'} left this week — no streak lost.`
                  : 'No rest days left this week: skipping today costs a freeze or your streak.'}
              </Text>
            )}
            {!done && (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.label}>Doing something different today?</Text>
                <View style={styles.chips}>
                  {KIND_CHOICES.map((c) => {
                    const on = goal.kind === c.kind;
                    return (
                      <Pressable
                        key={c.kind}
                        disabled={on || syncing}
                        onPress={() => refresh({ regenerateToday: true, todayKind: c.kind })}
                        style={[styles.chip, on && styles.chipOn]}
                      >
                        <Text style={[styles.chipText, on && { color: colors.text }]}>{c.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.hint}>Time and heart rate goals count every sport, e.g. kayak or swimming.</Text>
              </View>
            )}
            {snapshot.todayNotes.length > 0 && (
              <View style={{ marginTop: 12, gap: 2 }}>
                <Text style={styles.label}>Why this goal</Text>
                {snapshot.todayNotes.map((n) => (
                  <Text key={n} style={styles.muted}>
                    · {n}
                  </Text>
                ))}
              </View>
            )}
          </Card>
        )}
        {goal === undefined && !syncing && snapshot && (
          <Card>
            <Text style={styles.muted}>No goal yet. Pull down to sync.</Text>
          </Card>
        )}

        {sleepAccess === false && (
          <Card>
            <Text style={styles.h2}>😴 Smarter with your sleep</Text>
            <Text style={styles.muted}>
              Let Daily Spark read your sleep from Health Connect. After a short night or with a raised resting heart
              rate, your goal gets lighter; when you’re well rested, a little harder.
            </Text>
            <Button title="Allow sleep access" variant="secondary" onPress={allowSleep} />
          </Card>
        )}

        {/* Aim */}
        {snapshot?.aim && (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={styles.label}>🎯 Aim: {snapshot.aim.km} km a day</Text>
              <Text style={styles.body}>{snapshot.aim.averageKm.toFixed(1)} km/day</Text>
            </View>
            <ProgressBar
              fraction={Math.min(1, snapshot.aim.averageKm / snapshot.aim.km)}
              done={snapshot.aim.averageKm >= snapshot.aim.km}
            />
            <Text style={styles.hint}>Your average over the last 14 days, counting every day.</Text>
          </Card>
        )}

        {/* This month */}
        {game && (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={styles.label}>
                {new Date(game.month + '-15').toLocaleDateString([], { month: 'long' })} challenge
              </Text>
              <Text style={styles.body}>
                {Math.round(game.monthKm)} / {game.monthTarget} km
              </Text>
            </View>
            <ProgressBar fraction={Math.min(1, game.monthKm / game.monthTarget)} done={game.monthKm >= game.monthTarget} />
            <Text style={styles.hint}>Walking km this month (rides count 1/{settings.rideFactor}). Target: last month + 10%.</Text>
          </Card>
        )}

        {game && (
          <Pressable onPress={() => router.push('/achievements')}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.body}>
                  🏆 {Object.keys(game.achievements).length} of {ACHIEVEMENTS.length} achievements
                </Text>
                <Text style={styles.muted}>See all ›</Text>
              </View>
            </Card>
          </Pressable>
        )}

        {/* This week */}
        {snapshot && (
          <WeekCard
            summary={weekSummary(snapshot.streak.statuses, snapshot.today, settings.restDaysPerWeek, settings.startDate)}
            today={snapshot.today}
          />
        )}

        {/* Today's activities */}
        {snapshot && snapshot.todayActivities.length > 0 && (
          <Card>
            <Text style={styles.label}>Today’s activities</Text>
            {snapshot.todayActivities.map((a) => (
              <ActivityRow key={a.id} a={a} />
            ))}
          </Card>
        )}

        <Text style={[styles.muted, { textAlign: 'center' }]}>
          {snapshot ? `Synced ${new Date(snapshot.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          {settings.dataSource === 'demo' ? ' · demo data' : ''}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const KIND_CHOICES: { kind: GoalKind; label: string }[] = [
  { kind: 'distance', label: '📏 Distance' },
  { kind: 'duration', label: '⏱️ Time' },
  { kind: 'hr_zone', label: '❤️ Heart rate' },
];

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function WeekCard({ summary, today }: { summary: ReturnType<typeof weekSummary>; today: string }) {
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={styles.label}>This week</Text>
        <Text style={styles.body}>
          {summary.done}/{summary.planned} goals · {summary.restUsed} rest
        </Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
        {summary.days.map((d, i) => (
          <View key={d.date} style={{ alignItems: 'center', gap: 4 }}>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: STATUS_COLOR[d.status],
                borderWidth: d.date === today ? 2 : 0,
                borderColor: colors.text,
              }}
            />
            <Text style={styles.muted}>{DAY_LETTERS[i]}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

function ActivityRow({ a }: { a: Activity }) {
  const time = new Date(a.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const parts = [formatMinutes(a.durationS), a.distanceM != null ? formatKm(a.distanceM) : null].filter(Boolean);
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Text style={styles.body}>
        {a.sport === 'walk' ? '🚶' : a.sport === 'ride' ? '🚴' : '🏅'} {time}
        {a.label && a.sport === 'other' ? ` · ${a.label}` : ''}
      </Text>
      <Text style={styles.muted}>{parts.join(' · ')}</Text>
    </View>
  );
}
