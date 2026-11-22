import Constants from 'expo-constants';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { COACH_MODEL, getApiKey, loadCoachLog, type CoachCall } from '../services/coach';
import { useApp } from '../state/AppState';
import { updateInfo } from '../services/updates';
import { Label, styles } from './components';
import { colors } from './theme';

/**
 * Debug info for the AI coach: app build, settings that matter, and the last
 * requests with their status, timing and exact error. Text is selectable, so
 * it can be copied or screenshotted to report a problem.
 */
export function CoachDebug({ refreshKey = 0 }: { refreshKey?: number }) {
  const db = useSQLiteContext();
  const { settings, snapshot } = useApp();
  const at = snapshot?.activeTime;
  const [log, setLog] = useState<CoachCall[]>([]);
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([loadCoachLog(db).catch(() => []), getApiKey()]).then(([l, k]) => {
      if (!live) return;
      setLog(l);
      setKey(k);
    });
    return () => {
      live = false;
    };
  }, [db, refreshKey]);

  const build = Constants.expoConfig?.android?.versionCode ?? '?';
  const time = (ms: number) => new Date(ms).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const lines = [
    `Build ${build} · model ${COACH_MODEL}`,
    updateInfo(),
    at
      ? `Active today (heart rate ≥ ${at.thresholdBpm} bpm, outside workouts): ${at.todayS == null ? 'no readings' : `${Math.round(at.todayS / 60)} min`} · ${at.readingsToday} readings${at.medianGapS != null ? `, every ~${at.medianGapS} s` : ''}`
      : 'Active today: not synced yet',
    `API key: ${key ? `saved (…${key.slice(-4)})` : 'none'}`,
    `Coach ${settings?.coachEnabled ? 'on' : 'off'} · check-in ${settings?.dailyCheckin ? 'on' : 'off'} (last ${settings?.lastCheckin ?? 'never'}) · share cycle ${settings?.coachShareCycle ? 'on' : 'off'}`,
  ];

  return (
    <View style={{ backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, padding: 10, marginBottom: 12 }}>
      <Label>🐞 Debug</Label>
      {lines.map((l) => (
        <Text key={l} selectable style={[styles.hint, { marginTop: 0 }]}>
          {l}
        </Text>
      ))}
      <Text style={[styles.label, { marginTop: 8 }]}>Last requests ({log.length})</Text>
      {log.length === 0 && <Text style={styles.hint}>None yet.</Text>}
      {[...log].reverse().map((c, i) => (
        <Text
          key={`${c.at}-${i}`}
          selectable
          style={[styles.hint, { marginTop: 4, color: c.error ? colors.missed : colors.muted, fontFamily: 'monospace' }]}
        >
          {`${time(c.at)} ${c.purpose} ${c.mode} → ${c.status ?? 'no response'} in ${(c.ms / 1000).toFixed(1)}s`}
          {c.model ? `\n  ${c.model} · ${c.stopReason ?? ''} · ${c.tokensIn ?? '?'} in / ${c.tokensOut ?? '?'} out` : ''}
          {c.error ? `\n  ${c.error}` : ''}
          {c.requestId ? `\n  request ${c.requestId}` : ''}
        </Text>
      ))}
    </View>
  );
}
