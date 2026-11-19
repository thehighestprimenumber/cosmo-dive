import { Stack } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { ACHIEVEMENTS } from '../domain/game';
import { useApp } from '../state/AppState';
import { Card, styles } from '../ui/components';
import { colors } from '../ui/theme';

export default function AchievementsScreen() {
  const { snapshot } = useApp();
  const unlocked = snapshot?.game.achievements ?? {};
  const sorted = [...ACHIEVEMENTS].sort((a, b) => Number(!unlocked[a.id]) - Number(!unlocked[b.id]));

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Achievements',
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
        }}
      />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {snapshot && (
          <Text style={[styles.muted, { marginBottom: 16 }]}>
            ⭐ Level {snapshot.game.level} · {snapshot.game.xp} XP total. Goals give 10 XP plus a streak bonus, boss
            days 30 XP, a perfect week 25 XP.
          </Text>
        )}
        {sorted.map((a) => {
          const date = unlocked[a.id];
          return (
            <Card key={a.id} style={date ? { borderColor: colors.pending } : { opacity: 0.5 }}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <Text style={{ fontSize: 32 }}>{date ? a.emoji : '🔒'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.h2}>{a.title}</Text>
                  <Text style={styles.muted}>{a.description}</Text>
                  {date && <Text style={styles.hint}>Unlocked {date}</Text>}
                </View>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </>
  );
}
