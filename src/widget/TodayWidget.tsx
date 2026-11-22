import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { toDateKey } from '../domain/dates';
import type { DayStatus } from '../domain/types';
import { barWeights, type WidgetState } from './state';

// Same palette as the app (src/ui/theme.ts), as hex for RemoteViews.
const C = {
  bg: '#221D1A',
  track: '#14110F',
  text: '#F7F1EC',
  muted: '#A89C93',
  accent: '#FF7A1A',
  done: '#3DBE6E',
  missed: '#D9534F',
  frozen: '#5BB8E8',
  rest: '#4B4440',
  pending: '#FFB547',
  future: '#332B26',
} as const;

const DOT: Record<DayStatus | 'future', `#${string}`> = {
  done: C.done,
  missed: C.missed,
  frozen: C.frozen,
  rest: C.rest,
  pending: C.pending,
  none: C.track,
  future: C.future,
};

/** Today's goal, progress, streak and the week, in a 4×2 home-screen widget. Tap opens the app. */
export function TodayWidget({ state }: { state: WidgetState | null }) {
  const stale = !state || state.date !== toDateKey(new Date());

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: C.bg,
        borderRadius: 24,
        padding: 14,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between' }}>
        <TextWidget
          text={state ? `🔥 ${state.streak}-day streak` : '🔥 Daily Spark'}
          style={{ fontSize: 15, color: C.text, fontWeight: '700' }}
        />
        {state && <TextWidget text={`⭐ Level ${state.level}`} style={{ fontSize: 13, color: C.muted }} />}
      </FlexWidget>

      {stale ? (
        <TextWidget
          text={state ? 'New day! Tap for today’s goal' : 'Tap to open Daily Spark'}
          style={{ fontSize: 16, color: C.text, fontWeight: '600' }}
          maxLines={2}
        />
      ) : (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
          <TextWidget
            text={`${state.emoji} ${state.title}`}
            style={{ fontSize: 16, color: C.text, fontWeight: '600' }}
            maxLines={2}
            truncate="END"
          />
          <FlexWidget
            style={{
              width: 'match_parent',
              height: 10,
              marginTop: 8,
              backgroundColor: C.track,
              borderRadius: 5,
              flexDirection: 'row',
            }}
          >
            <FlexWidget
              style={{
                // Widget weights are whole numbers (Android rounds 0.45 down to 0): use per cent.
                flex: barWeights(state.fraction)[0],
                height: 'match_parent',
                backgroundColor: state.done ? C.done : C.accent,
                borderRadius: 5,
              }}
            />
            <FlexWidget style={{ flex: barWeights(state.fraction)[1], height: 'match_parent' }} />
          </FlexWidget>
          <TextWidget
            text={state.done ? `✅ ${state.detail}` : state.detail}
            style={{ fontSize: 13, color: state.done ? C.done : C.text, marginTop: 4 }}
          />
          {state.climb && <TextWidget text={state.climb} style={{ fontSize: 12, color: C.muted }} />}
        </FlexWidget>
      )}

      {state && (
        <FlexWidget
          style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <TextWidget text={state.weekLine} style={{ fontSize: 11, color: C.muted }} maxLines={1} truncate="END" />
          <FlexWidget style={{ flexDirection: 'row', flexGap: 4, marginLeft: 8 }}>
            {state.dots.map((s, i) => (
              <FlexWidget
                key={i}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  backgroundColor: DOT[s],
                  ...(i === state.todayIndex ? { borderWidth: 1, borderColor: C.text } : {}),
                }}
              />
            ))}
          </FlexWidget>
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
