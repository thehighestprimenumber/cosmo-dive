import { Text, View } from 'react-native';
import type { ProposalStatus } from '../domain/coach';
import { Button, styles } from './components';
import { colors } from './theme';

/** One coach suggestion: what changes, why, and Apply / Not now (then Undo). */
export function ProposalView({
  change,
  reason,
  adjusted,
  status,
  busy,
  canUndo = true,
  onDecide,
}: {
  change: string;
  reason: string;
  adjusted?: string;
  status: ProposalStatus;
  busy: boolean;
  canUndo?: boolean;
  onDecide: (to: ProposalStatus) => void;
}) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.cardBorder, paddingTop: 10, marginTop: 6 }}>
      <Text style={[styles.body, { fontWeight: '700' }]}>{change}</Text>
      <Text style={styles.muted}>{reason}</Text>
      {adjusted ? <Text style={styles.hint}>⚖️ {adjusted}</Text> : null}
      {status === 'pending' ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Apply" onPress={() => onDecide('applied')} disabled={busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Not now" variant="secondary" onPress={() => onDecide('dismissed')} disabled={busy} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[styles.hint, { color: status === 'applied' ? colors.done : colors.muted }]}>
            {status === 'applied' ? '✓ Applied' : 'Skipped'}
          </Text>
          {(status !== 'applied' || canUndo) && (
            <Button
              title={status === 'applied' ? 'Undo' : 'Apply after all'}
              variant="secondary"
              onPress={() => onDecide(status === 'applied' ? 'pending' : 'applied')}
              disabled={busy}
            />
          )}
        </View>
      )}
    </View>
  );
}
