import { Stack } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { loadSettings } from '../data/db';
import { addDays, startOfDay, toDateKey } from '../domain/dates';
import { formatKm, formatMinutes } from '../domain/format';
import type { Activity, Settings } from '../domain/types';
import { backgroundSyncStatus } from '../services/backgroundSync';
import { sourceFor } from '../sources';
import type { SourceStatus } from '../sources/ActivitySource';
import { listGrantedPermissions, listRawSessions, type RawSession } from '../sources/healthConnect';
import { Card, Label, styles } from '../ui/components';
import { colors } from '../ui/theme';

const DAYS = 14;

type Report = {
  settings: Settings;
  status: SourceStatus;
  permissions: string[] | null;
  background: { available: boolean; registered: boolean } | null;
  sessions: RawSession[] | null;
  activities: Activity[];
  error: string | null;
};

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function buildReport(db: SQLiteDatabase): Promise<Report> {
  const settings = await loadSettings(db, toDateKey(new Date()));
  const source = sourceFor(settings);
  const r: Report = {
    settings,
    status: { state: 'unavailable', reason: 'not checked' },
    permissions: null,
    background: null,
    sessions: null,
    activities: [],
    error: null,
  };
  try {
    r.background = await backgroundSyncStatus().catch(() => null);
    r.status = await source.status();
    if (settings.dataSource === 'health_connect' && r.status.state !== 'unavailable') {
      r.permissions = await listGrantedPermissions();
    }
    if (r.status.state === 'ready') {
      const to = new Date();
      const from = startOfDay(addDays(toDateKey(to), -DAYS));
      if (settings.dataSource === 'health_connect') r.sessions = await listRawSessions(from, to);
      r.activities = await source.getActivities(from, to);
    }
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
  }
  return r;
}

/** What the app can actually see, to debug "my walk doesn't show up". */
export default function DiagnosticsScreen() {
  const db = useSQLiteContext();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    buildReport(db).then((r) => {
      if (cancelled) return;
      setReport(r);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [db, reloads]);

  const counted = new Map((report?.activities ?? []).map((a) => [a.id, a]));

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Diagnostics',
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
        }}
      />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => {
              setLoading(true);
              setReloads((n) => n + 1);
            }} tintColor={colors.accent} />}
      >
        {report && (
          <>
            <Card>
              <Label>Data source</Label>
              <Row k="Source" v={report.settings.dataSource === 'demo' ? 'Demo data' : 'Health Connect'} />
              <Row
                k="Status"
                v={report.status.state === 'unavailable' ? `unavailable: ${report.status.reason}` : report.status.state}
                ok={report.status.state === 'ready'}
              />
              <Row k="Plan started" v={report.settings.startDate} />
              {report.error && <Text style={[styles.muted, { color: colors.missed }]}>{report.error}</Text>}
            </Card>

            {report.permissions && (
              <Card>
                <Label>Health Connect permissions</Label>
                {report.permissions.length === 0 && <Text style={styles.muted}>None granted.</Text>}
                {report.permissions.map((p) => (
                  <Text key={p} style={styles.muted}>
                    ✅ {p}
                  </Text>
                ))}
                {!report.permissions.some((p) => p.includes('BackgroundAccessPermission')) && (
                  <Text style={[styles.hint, { color: colors.pending }]}>
                    Background access not granted: syncing only happens while the app is open.
                  </Text>
                )}
              </Card>
            )}

            <Card>
              <Label>Background sync</Label>
              <Row k="Available" v={report.background?.available ? 'yes' : 'no'} ok={report.background?.available} />
              <Row k="Registered" v={report.background?.registered ? 'yes' : 'no'} ok={report.background?.registered} />
              <Row
                k="Last run"
                v={report.settings.lastBackgroundSync ? fmtTime(report.settings.lastBackgroundSync) : 'never'}
              />
              <Text style={styles.hint}>
                Android decides when it runs. If it never runs, set Daily Spark’s battery usage to Unrestricted.
              </Text>
            </Card>

            <Card>
              <Label>Exercise sessions, last {DAYS} days</Label>
              {report.sessions === null &&
                report.activities.map((a) => <ActivityLine key={a.id} a={a} />)}
              {report.sessions?.length === 0 && (
                <Text style={styles.muted}>
                  Health Connect has no exercise sessions. Check Samsung Health → Settings → Health Connect.
                </Text>
              )}
              {report.sessions?.map((s) => {
                const a = counted.get(s.id);
                return (
                  <View key={s.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.cardBorder }}>
                    <Text style={styles.body}>
                      {a ? '✅' : s.counted ? '♻️' : '➖'} {s.type} · {fmtTime(s.start)}
                    </Text>
                    <Text style={styles.muted}>
                      {formatMinutes((s.end - s.start) / 1000)}
                      {a?.distanceM != null ? ` · ${formatKm(a.distanceM)}` : ''}
                      {a ? ` · ${a.hr.length} heart rate samples` : ''}
                      {!s.counted ? ' · not a walk or ride' : !a ? ' · duplicate, ignored' : ''}
                    </Text>
                    <Text style={styles.hint}>{s.origin}</Text>
                  </View>
                );
              })}
            </Card>
          </>
        )}
      </ScrollView>
    </>
  );
}

function Row({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 12 }}>
      <Text style={styles.muted}>{k}</Text>
      <Text
        style={[styles.body, { flexShrink: 1, textAlign: 'right' }, ok === false && { color: colors.pending }]}
      >
        {v}
      </Text>
    </View>
  );
}

function ActivityLine({ a }: { a: Activity }) {
  return (
    <Text style={[styles.muted, { paddingVertical: 4 }]}>
      {a.sport === 'walk' ? '🚶' : '🚴'} {fmtTime(a.start)} · {formatMinutes(a.durationS)}
      {a.distanceM != null ? ` · ${formatKm(a.distanceM)}` : ''} · {a.hr.length} HR samples
    </Text>
  );
}
