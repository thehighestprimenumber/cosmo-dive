# Decisions log

Product decisions made while the owner was away, so they can be reviewed and changed. Newest first.

## 2026-11-21: home-screen widget (before the watch Tile)

The owner wants a phone widget equivalent to a watch Tile first; once it works as wanted, the same content goes to the Galaxy Watch.

| Topic | Decision | Why / how to change |
|---|---|---|
| Library | `react-native-android-widget` (JSX → RemoteViews, Expo config plugin, headless task handler) | Keeps the widget in TypeScript; supports Expo SDK 54+ |
| Content | Streak, level, today's goal (emoji + title), progress bar, "X of Y" / done, climb if any, week km done/left, 7 day dots. Tap opens the app | `src/widget/state.ts` (`widgetStateFrom`) is the single source; the watch Tile will reuse it |
| Size | 4×2 cells (min 250×110 dp), resizable | Fits the goal title and the week row |
| Updates | After every sync (app open or background task) the state is saved and widgets redrawn; Android also asks every 30 min and the handler redraws the saved state | No sync inside the widget handler: the background task already syncs |
| Stale day | If the saved state is from an earlier day: "New day! Tap for today's goal" | Avoids showing yesterday's goal |
| Testing | Diagnostics shows a live preview (same native renderer); the CI walkthrough opens it and fails on a crash | Adding a real widget to a home screen can't be automated on the emulator |

## 2026-11-21: real numbers (all-day distance, split walks)

From the owner's screenshots: Samsung Health showed 13.97 km for the day and a recorded 13.01 km walk, but the app saw a 7.7 km long walk, a 1.4 km/day average and 19 km for November.

| Topic | Decision | Why / how to change |
|---|---|---|
| All-day distance | Read Health Connect's daily Distance total; what's beyond recorded workouts becomes one synthetic "other walking" activity per day | `src/domain/allday.ts`; Samsung counts all walking, not only workouts |
| Where it counts | Distance goals, weekly km, typical week/day, aim average, monthly challenge, weekday scores for planning | Matches what the owner sees in Samsung Health |
| Where it doesn't | Long walk, brisk walk, climb, walking pace, usual start time, time and heart-rate goals | Those need a real recorded outing / duration |
| Active day | A day counts for your typical day with 15+ min of exercise **or 1.5+ km of walking** | All-day distance has no duration |
| Session distance | max(distance from the session's own app, distance from all apps) in its time window | Watch and phone can write a workout's distance under different origins |
| Split recordings | Recorded walks **up to 30 min** apart are one outing for the long walk (distance and climb add up) | Confirmed from the owner's data: a 13 km Samsung workout reached Health Connect as 3.4 + 1.7 + 0.5 + 7.7 km with 19–24 min gaps. 30 min also covers a meal stop on a trek |
| Rules version | `PLAN_VERSION` 8; this week's km is recomputed on update | |

**Confirmed (owner's screenshot, 21 Nov):** the walk was split into 4 sessions in Health Connect. The all-day distance part is still unconfirmed on the real phone.

## 2026-11-21: aerobic base for altitude

The owner chose option 1 (a stronger aerobic base) over acclimatisation days and altitude monitoring. Altitude itself can't be trained from the app (adaptation needs low-oxygen exposure); a better aerobic base makes the same effort cheaper, which offsets part of the missing oxygen.

| Topic | Decision | Why / how to change |
|---|---|---|
| Trigger | Optional "highest altitude (m)" on the dated goal; 1500 m or more turns the phase on | `ALTITUDE_M` in `src/domain/aerobic.ts` |
| When | The 16 weeks before the pre-event week | `AEROBIC_WEEKS` |
| Regular days | Mix weighted to Zone 2: hr_zone, distance, hr_zone, duration (≈ half the days). Without heart rate data: more time goals instead | `kindForDay(…, aerobic)` |
| Heart rate goals | Always Zone 2 (no Zone 3 alternation) and 70% of the day's time in zone instead of 50% | `AEROBIC_ZONE_SHARE` |
| Weekly view | "Zone 2: X of Y min", target ≈ 35% of the week's walking time (shown all the time, not only in the phase) | `WEEKLY_ZONE2_SHARE` |
| Unchanged | Weekly km, long/brisk walks, climb, light weeks | The phase only changes how regular days are spent |
| Later, if wanted | Acclimatisation days on arrival; monitoring resting HR / SpO2 during the trip | Offered, not chosen yet |

## 2026-11-21: climb (elevation gain)

| Topic | Decision | Why / how to change |
|---|---|---|
| Data | Health Connect ElevationGained per walk, from the same app as the session (optional permission). No data shows as "unknown", never as 0 m | `src/sources/healthConnect.ts` |
| Goal | Optional "climb per day (m)" on the dated goal (the hardest day) | Week → 🎯 |
| Long walks | Long walk and back-to-back day get a climb target in the **same walk**: metres per km move from your usual (median of your walks) toward the trek's, as the long walk's distance approaches the trek's. Unknown usual → half the trek's | `longWalkClimb` in `src/domain/elevation.ts` |
| Trek days | The full daily climb | |
| Counting | An outing counts as far as its weaker side (12 km with half the climb = half done) | `bestLongWalk` in `progress.ts` |
| No elevation data | No climb targets (so goals stay achievable); the Week tab says why | |
| Readiness | Also scales the climb (not on trek days) | |

## 2026-11-21: one weekly-volume engine, period-aware light weeks, multi-day treks

The owner asked to merge the two planning mechanisms (recent activity vs. dated goal), to have the light week during her period, and to support her goal: **multi-day village-to-village treks in Oaxaca's Sierra Norte** in the Argentine winter (Jun–Aug 2027).

| Topic | Decision | Why / how to change |
|---|---|---|
| One engine | Everything comes from **km per week** (walk-equivalent). Recent activity = starting point; aim and/or dated goal = destination. Replaces the aim's +10%-per-goal ramp, the long walk's own progression and the event ramp | `src/domain/volume.ts` |
| Starting point | Median km of the last 4 complete weeks that have any watch data (weeks without the watch are skipped). With <2 such weeks: daily mode × training days | Days off the watch don't drag it down |
| Destination | Aim N km/day → 7N/week. Event of X km → X / 0.33 (a long walk is ~1/3 of a peak week); multi-day trek → ×1.15. No goal → +25% over the start | `destinationKm` |
| Growth | Max +10% a week (the classic safe rule). With an event, just enough to peak 2 weeks before it. If last week you did <80% of the plan: hold; <60%: −10%. The first planned week doesn't grow | `planVolume` |
| Light week | **The Mon–Sun week holding most of your (predicted) period**: −25% km and no pace push on the brisk walk; heart-rate goals stay in Zone 2; no boss day. Without cycle data: every 4th week, as before. Events win over periods (pre-event and event weeks aren't "light" weeks) | `src/domain/cycle.ts` |
| Cycle data | Health Connect MenstruationPeriod (optional permission, requested only from the Week tab, never at onboarding) + "My period started today" taps. Cycle length = median of 2+ recorded gaps (18–45 days), else your setting (28). Data stays on the phone | Week tab → 🌸 card |
| Before an event | The week before the event week: −25%. The event week: the event (km × days) + 30% of a normal week | |
| Multi-day trek | `days` on the goal; date = first trek day. In the last 8 weeks before the pre-event week, the long walk is a **back-to-back pair** (30% + 20% of the week, consecutive days). In the trek week every trek day is a fixed long walk of the daily km | Owner's goal: Sierra Norte |
| Reachability | If growing at ≤10%/week can't get the long walk to ~95% of the goal distance by then, the plan says what's reachable (and suggests a later date or shorter goal) | Honesty over pressure |
| Weekly split | Long walk 30%, brisk walk 15%, back-to-back day 20%, the rest spread over your other training days (7 − rest days − key sessions) | `weekSplit` |
| Mid-week rebalancing | A regular day's km = (week km − done so far − key sessions still ahead) / (days left − key days left − rest days left), kept within 70–130% of the plan. Set when the day's goal is made, in the morning | Big kayak day → lighter days after |
| Time and heart-rate goals | Converted from the day's km with your walking pace (time) and half that time in the zone (heart rate) | Everything adds up to the week |
| Removed | The "lighter after a big day" tweak and the 80–150% clamp around your typical day (the weekly engine covers both); the fixed every-4th recovery week when cycle data exists | |
| Not trained | Altitude (can't be trained from the app). Elevation gain: added the same day, see below | |
| Rules version | `PLAN_VERSION` 7 | |

## 2026-11-20: weekly plan (Runna-style)

The owner chose **long walk + brisk walk** as key sessions, **move missed sessions forward**, **next week's plan on Sunday evening**, and **no dated goal yet**, but asked for the feature to be built. Intervals wait for the watch app. Decisions made without asking:

| Topic | Decision | Why / how to change |
|---|---|---|
| Sessions per week | 1 long walk + 1 brisk walk; all other days keep the daily goal (any sport) | Two key sessions fit a variable schedule. `planWeek` in `src/domain/plan.ts` |
| Which days | Long walk on the weekday with the most walking km over the last 90 days (Saturday with no history); brisk walk on the next-best weekday at least 2 days away; ties prefer Sat → Sun → Wed | Uses your real habits; you can move both. `planWeek` |
| Plan made mid-week | Only the days left are used; the brisk walk is skipped if it can't be 2 days from the long walk | Avoids back-to-back hard days |
| Moving | Any day this week from today (today only if not done yet), not onto the other key session | `freeDays` / `moveSession` |
| Missed key session | Slides to the next free day this week (today if not done yet); dropped when the week runs out. The skipped day counts as a flexible rest day as before | Owner's choice. `forwardMissed` |
| Picking another goal type on a key-session day | The key session moves to the next free day | Keeps the session instead of losing it |
| Long walk size | First: max(75th percentile of your single walks, 1.3 × a training day's distance). Then +10% after a completed long walk, same after one miss, −10% after two misses in a row. Recovery weeks −20%. 3–42 km | `generateKeySession` in `src/domain/sessions.ts` |
| Long walk counting | The single longest walk/hike/run of the day (not several added up) | That's what a long walk is |
| Brisk walk | 60% of a training day's distance (2–10 km) at 8% faster than your usual pace (median pace of 15+ min walks). After a completed one: +5% distance and 2% faster. Never more than 20% faster than usual. Unknown pace → 11:00 min/km starter | Walks at that pace or faster add up |
| Dated goal | One "long walk / hike" goal: name, km, date. The long walk ramps evenly to the event distance by the week before, never goes over it, is 60% in the taper week, and is the full distance on the day | Edit in the Week tab |
| Targets | Fixed on the day from your latest data (Week tab shows an "about" estimate for upcoming ones) | Same as daily goals: never rewritten once set |
| Boss days | Only on regular days (a key session that week takes precedence) | Avoids stacking two hard tweaks |
| Rules version | `PLAN_VERSION` 6: today's goal is redone on update unless already completed | |

## Earlier (decided with the owner)

- Health Connect instead of Strava; Android only; React Native + Expo.
- Flexible rest days per week instead of fixed weekdays.
- Baseline = mode of total exercise per day (all sports added up; days with 15+ min).
- Optional aim (average km/day over every day); goals step up 10% per completed goal until reaching it; Today offers to raise the aim once reached.
- Every sport counts for time and heart-rate goals; running counts as walking distance.
- Intervals: later, together with the watch app.
