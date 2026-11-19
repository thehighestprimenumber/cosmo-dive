import { useEffect, useRef, useState } from 'react';
import { Animated, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatKm, formatMinutes, formatValue, goalEmoji, goalSubtitle, goalTitle } from '../../domain/format';
import { weekSummary } from '../../domain/summary';
import type { Activity } from '../../domain/types';
import { useApp } from '../../state/AppState';
import { Button, Card, ProgressBar, styles } from '../../ui/components';
import { colors, STATUS_COLOR } from '../../ui/theme';

export default function TodayScreen() {
  const { settings, snapshot, syncing, error, sourceStatus, refresh, connect } = useApp();
  const done = !!snapshot?.todayProgress?.done;

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
        </View>

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
            <Text style={styles.label}>Today’s goal</Text>
            <Text style={styles.h2}>
              {goalEmoji(goal)} {goalTitle(goal, settings)}
            </Text>
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
        {a.sport === 'walk' ? '🚶' : '🚴'} {time}
      </Text>
      <Text style={styles.muted}>{parts.join(' · ')}</Text>
    </View>
  );
}
