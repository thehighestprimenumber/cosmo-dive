import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { colors, gap, radius } from './theme';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.buttonText, variant === 'secondary' && { color: colors.text }]}>{title}</Text>
    </Pressable>
  );
}

export function ProgressBar({ fraction, done }: { fraction: number; done: boolean }) {
  return (
    <View style={styles.barTrack}>
      <View
        style={[
          styles.barFill,
          { width: `${Math.max(2, Math.round(fraction * 100))}%`, backgroundColor: done ? colors.done : colors.accent },
        ]}
      />
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad' | 'numbers-and-punctuation';
  hint?: string;
}) {
  return (
    <View style={{ marginBottom: gap }}>
      <Label>{label}</Label>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Choose how many flexible rest days per week (0–3). */
export function RestPerWeekPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={styles.chips}>
      {[0, 1, 2, 3].map((n) => {
        const on = value === n;
        return (
          <Pressable key={n} onPress={() => onChange(n)} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipText, on && { color: colors.text }]}>
              {n === 0 ? 'None' : `${n} per week`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: gap, paddingBottom: gap * 3 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius,
    padding: gap,
    marginBottom: gap,
  },
  h1: { color: colors.text, fontSize: 28, fontWeight: '800' },
  h2: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 6 },
  body: { color: colors.text, fontSize: 16, lineHeight: 22 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6 },
  hint: { color: colors.muted, fontSize: 13, marginTop: 4 },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.cardBorder },
  buttonText: { color: '#1A0E05', fontSize: 16, fontWeight: '700' },
  barTrack: { height: 14, backgroundColor: colors.bg, borderRadius: 7, overflow: 'hidden', marginVertical: 12 },
  barFill: { height: '100%', borderRadius: 7 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.muted, fontWeight: '600' },
});
