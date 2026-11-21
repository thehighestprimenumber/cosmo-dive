import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { loadCoachRecord } from '../data/db';
import type { CoachProposal, CoachRecord, CoachReview } from '../domain/coach';
import { getApiKey, runWeeklyReview, setProposal } from '../services/coach';
import { useApp } from '../state/AppState';
import { Button, Card, Label, styles } from './components';
import { colors } from './theme';

/**
 * The AI coach's Sunday review on the Week tab: how the week went, a tip,
 * and up to two changes to next week that you apply (or not) with a tap.
 * Shown from Sunday evening (next week's plan) through that week.
 */
export function CoachCard() {
  const db = useSQLiteContext();
  const { snapshot, settings, refresh } = useApp();
  const [record, setRecord] = useState<CoachRecord | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // The review being planned (next week) or, from Monday, the one for this week.
  const week = snapshot?.nextPlan?.week ?? snapshot?.plan.week ?? null;
  const syncedAt = snapshot?.syncedAt;
  useEffect(() => {
    let live = true;
    (async () => {
      const key = await getApiKey();
      const r = week ? await loadCoachRecord(db, week) : null;
      if (!live) return;
      setHasKey(!!key);
      setRecord(r);
    })();
    return () => {
      live = false;
    };
  }, [db, week, syncedAt]);

  if (!snapshot || !settings?.coachEnabled) return null;
  const canAsk = !!snapshot.nextPlan;
  if (!record && !canAsk) return null;

  const ask = async () => {
    setBusy(true);
    try {
      const r = await runWeeklyReview(db, snapshot, settings);
      setRecord(r);
    } catch (e) {
      Alert.alert('Weekly review', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (review: CoachReview, p: CoachProposal, to: 'applied' | 'dismissed' | 'pending') => {
    setBusy(true);
    try {
      const r = await setProposal(db, review, p.id, to, snapshot.today, !!snapshot.todayProgress?.done);
      if (r.error) Alert.alert('Weekly review', r.error);
      setRecord({ ok: true, review: r.review });
      // A change to this week's plan can change today's goal (unless it's done).
      if (!r.error && p.status !== to) await refresh({ regenerateToday: review.week === snapshot.plan.week });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Label>🧠 Weekly review</Label>
      {record?.ok ? (
        <ReviewBody review={record.review} busy={busy} onDecide={decide} />
      ) : hasKey === false ? (
        <>
          <Text style={[styles.muted, { marginBottom: 8 }]}>
            Add your Claude API key in Settings to get a review of your week and suggestions for the next one.
          </Text>
          <Button title="Open Settings" variant="secondary" onPress={() => router.push('/settings')} />
        </>
      ) : (
        <>
          <Text style={[styles.muted, { marginBottom: 8 }]}>
            {record && !record.ok
              ? `Last try didn’t work: ${record.error}`
              : 'How your week went, and up to two changes to next week’s plan. Nothing changes unless you tap Apply.'}
          </Text>
          {busy ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} />
          ) : (
            <Button title={record ? 'Try again' : 'Get my weekly review'} onPress={ask} />
          )}
        </>
      )}
    </Card>
  );
}

function ReviewBody({
  review,
  busy,
  onDecide,
}: {
  review: CoachReview;
  busy: boolean;
  onDecide: (r: CoachReview, p: CoachProposal, to: 'applied' | 'dismissed' | 'pending') => void;
}) {
  return (
    <View>
      <Text style={[styles.body, { marginBottom: 8 }]}>{review.summary}</Text>
      {review.tip ? <Text style={[styles.muted, { marginBottom: 8 }]}>💡 {review.tip}</Text> : null}
      {review.proposals.length === 0 ? (
        <Text style={styles.hint}>No changes to next week: the plan fits.</Text>
      ) : (
        review.proposals.map((p) => (
          <View
            key={p.id}
            style={{ borderTopWidth: 1, borderTopColor: colors.cardBorder, paddingTop: 10, marginTop: 6 }}
          >
            <Text style={[styles.body, { fontWeight: '700' }]}>{p.change}</Text>
            <Text style={styles.muted}>{p.reason}</Text>
            {p.adjusted ? <Text style={styles.hint}>⚖️ {p.adjusted}</Text> : null}
            {p.status === 'pending' ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Apply" onPress={() => onDecide(review, p, 'applied')} disabled={busy} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Not now" variant="secondary" onPress={() => onDecide(review, p, 'dismissed')} disabled={busy} />
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[styles.hint, { color: p.status === 'applied' ? colors.done : colors.muted }]}>
                  {p.status === 'applied' ? '✓ Applied' : 'Skipped'}
                </Text>
                <Button
                  title={p.status === 'applied' ? 'Undo' : 'Apply after all'}
                  variant="secondary"
                  onPress={() => onDecide(review, p, p.status === 'applied' ? 'pending' : 'applied')}
                  disabled={busy}
                />
              </View>
            )}
          </View>
        ))
      )}
      <Text style={[styles.hint, { marginTop: 8 }]}>
        Suggestions from the AI coach, checked against the plan’s safety rules.
      </Text>
    </View>
  );
}
