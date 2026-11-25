import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clearChat, deleteChatMessages, loadChat } from '../data/db';
import type { ChatAction, ChatMessage } from '../domain/coachChat';
import { getApiKey } from '../services/coach';
import { decideChatProposal, sendChat } from '../services/coachChat';
import { useApp } from '../state/AppState';
import { Button, styles } from '../ui/components';
import { CoachDebug } from '../ui/CoachDebug';
import { ProposalView } from '../ui/Proposal';
import { colors, radius } from '../ui/theme';

/** Quick starts for the things the data can't show. */
const STARTERS = [
  'Hoy tengo poco tiempo',
  'Mañana trabajo todo el día',
  'Me duele un poco la pierna',
  '¿Cómo vengo esta semana?',
];

/** Chat with the AI coach: advice, plus changes you apply with a tap. */
export default function CoachScreen() {
  const db = useSQLiteContext();
  const { snapshot, settings, refresh, updateSettings } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [debug, setDebug] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [m, k] = await Promise.all([loadChat(db), getApiKey()]);
      if (!live) return;
      setMessages(m);
      setHasKey(!!k);
    })();
    return () => {
      live = false;
    };
  }, [db]);

  const send = async (t: string) => {
    if (!t.trim() || !snapshot || !settings || sending) return;
    setText('');
    // Shown right away; replaced by the saved conversation when the answer arrives.
    const optimistic: ChatMessage = { id: 'pending', role: 'user', text: t.trim(), at: 0 };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    try {
      setMessages(await sendChat(db, t, snapshot, settings));
    } finally {
      setSending(false);
    }
  };

  /** Send the message that failed again (without keeping the failed attempt). */
  const retry = async (errorId: string) => {
    const i = messages.findIndex((x) => x.id === errorId);
    const asked = [...messages.slice(0, i)].reverse().find((x) => x.role === 'user');
    if (!asked) return;
    await deleteChatMessages(db, [asked.id, errorId]);
    setMessages((all) => all.filter((x) => x.id !== asked.id && x.id !== errorId));
    await send(asked.text);
  };

  const decide = async (m: Extract<ChatMessage, { role: 'assistant' }>, pid: string, to: 'applied' | 'dismissed' | 'pending') => {
    if (!snapshot || !settings) return;
    setBusy(true);
    try {
      const r = await decideChatProposal(db, m, pid, to, snapshot, settings);
      if (r.error) Alert.alert('Coach', r.error);
      setMessages((all) => all.map((x) => (x.id === m.id ? r.message : x)));
      if (r.settingsPatch) await updateSettings(r.settingsPatch);
      if (r.refresh) await refresh(r.refresh);
    } finally {
      setBusy(false);
    }
  };

  const clear = () =>
    Alert.alert('Clear the chat?', 'The coach forgets this conversation. Changes you applied stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearChat(db);
          setMessages([]);
        },
      },
    ]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={[styles.body, { color: colors.accent }]}>‹ Back</Text>
          </Pressable>
          <Pressable onPress={() => setDebug((d) => !d)} hitSlop={8}>
            <Text style={styles.h2}>🧠 Coach{debug ? ' 🐞' : ''}</Text>
          </Pressable>
          <Pressable onPress={clear} hitSlop={8} disabled={!messages.length}>
            <Text style={[styles.body, { color: messages.length ? colors.muted : 'transparent' }]}>Clear</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={scroll}
          contentContainerStyle={{ padding: 16, paddingTop: 0 }}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
        >
          {debug && <CoachDebug refreshKey={messages.length + (sending ? 1 : 0)} />}
          {hasKey === false ? (
            <View>
              <Text style={[styles.muted, { marginBottom: 8 }]}>Add your Claude API key in Settings → AI coach to chat.</Text>
              <Button title="Open Settings" variant="secondary" onPress={() => router.push('/settings')} />
            </View>
          ) : messages.length === 0 ? (
            <Text style={[styles.muted, { marginBottom: 12 }]}>
              Tip: tap the title for debug info. Tell the coach what your watch can’t: a long shift, little time, something sore, how you feel. It answers
              with advice and, when it helps, changes to today or your week. Nothing changes until you tap Apply. It sees
              a summary of your goals and weeks, not your raw workouts.
            </Text>
          ) : null}

          {messages.map((m) =>
            m.role === 'user' ? (
              <View key={m.id} style={[bubble, { alignSelf: 'flex-end', backgroundColor: colors.accentSoft }]}>
                <Text style={styles.body}>{m.text}</Text>
              </View>
            ) : (
              <View key={m.id} style={[bubble, { alignSelf: 'flex-start', backgroundColor: colors.card }]}>
                {m.checkin ? <Text style={styles.label}>☀️ Morning check-in</Text> : null}
                {m.congrats ? <Text style={styles.label}>🎉 Goal complete</Text> : null}
                <Text style={[styles.body, m.error && { color: colors.missed }]}>{m.text}</Text>
                {m.error && (
                  <Pressable onPress={() => retry(m.id)} disabled={sending} hitSlop={8} style={{ marginTop: 6 }}>
                    <Text style={[styles.body, { color: colors.accent, fontWeight: '700' }]}>↻ Try again</Text>
                  </Pressable>
                )}
                {m.proposals.map((p) => (
                  <ProposalView
                    key={p.id}
                    change={p.change}
                    reason={p.reason}
                    adjusted={p.adjusted}
                    status={p.status}
                    busy={busy || isStale(p.action, snapshot?.today)}
                    canUndo
                    onDecide={(to) => decide(m, p.id, to)}
                  />
                ))}
              </View>
            ),
          )}
          {sending && <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start', margin: 8 }} />}
        </ScrollView>

        {hasKey !== false && (
          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: colors.cardBorder }}>
            {messages.length === 0 && (
              <View style={[styles.chips, { marginBottom: 8 }]}>
                {STARTERS.map((s) => (
                  <Pressable key={s} style={styles.chip} onPress={() => send(s)} disabled={sending}>
                    <Text style={styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <TextInput
                style={[styles.input, { flex: 1, maxHeight: 120 }]}
                value={text}
                onChangeText={setText}
                placeholder="Escribile al coach…"
                placeholderTextColor={colors.muted}
                multiline
              />
              <Pressable
                onPress={() => send(text)}
                disabled={sending || !text.trim()}
                style={{ backgroundColor: colors.accent, borderRadius: radius, paddingHorizontal: 16, paddingVertical: 12, opacity: sending || !text.trim() ? 0.5 : 1 }}
              >
                <Text style={{ color: '#1A0E05', fontWeight: '700' }}>Send</Text>
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A change for a past day can't be applied anymore. */
const isStale = (a: ChatAction, today?: string) =>
  (a.type === 'rest_today' || a.type === 'today_kind') && a.date !== today;

const bubble = { borderRadius: radius, padding: 12, marginBottom: 10, maxWidth: '90%' as const };
