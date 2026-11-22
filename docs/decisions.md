# Decisions log

Product decisions made while the owner was away, so they can be reviewed and changed. Newest first.

## 2026-11-22: unrecorded walking counts for time goals; duplicate sessions count once

From the owner's screenshots (22 Nov): Samsung showed 2.04 km and 15 active minutes, Daily Spark's 20-minute recovery goal showed 0 min; the week showed 22.6 km but today's goal note said "41.2 done so far".

| Topic | Decision | Why / how to change |
|---|---|---|
| Time goals | The day's distance outside recorded workouts now also counts as time, at your walking pace (≈12 min/km until known) | Weekly km (and so time goals) already include that distance; the time should count too. `withAllDayWalking` |
| Duplicates | Sessions of the same sport that overlap for more than half of the shorter one count once (the one with more distance) | Most likely cause of 41.2 km: Samsung's parts of a walk and the merged walk present at the same time while it re-syncs. `withoutOverlaps` |
| Your pace | Ignores that estimated time (and habits ignore it too) | Otherwise the estimate would feed itself |
| Wording | "5.8× a regular day of your plan (2.6 km)" instead of "a usual day" | It's the plan's share for a regular day, not your history |
| Stored notes | Today's "Why this goal" note keeps the 41.2 km it was made with (goals are never rewritten); the numbers on the cards are recomputed every sync | |

## 2026-11-22: guided strength session on the watch

| Topic | Decision | Why / how to change |
|---|---|---|
| Flow | Watch app → "🦵 Fuerza guiada": one exercise at a time with sets and sides (derecha / izquierda), the main safety cue and the easier version on screen. Reps: tap "✓ Listo". Holds (balance, plank, stretches): a countdown. 30 s rest after each set, with a countdown that moves on by itself. A buzz at the end of every timer; "Saltar ejercicio" skips the rest of one | `StrengthActivity`, `StrengthPlan` in `wear/` |
| Content | The same routine as the phone (sent with the Tile data), in Spanish | `watchRoutine()` |
| Marked done | Finishing marks it done for today on the phone (+5 XP) at its next sync: the watch keeps the days in the Data Layer (`/strength-done`), the phone reads them before each sync. A day you untick on the phone isn't ticked again | `importWatchStrength` |
| Health Connect | Not written yet (step 3 of the plan) | Next, if wanted |

## 2026-11-22: how to do each strength exercise

| Topic | Decision | Why / how to change |
|---|---|---|
| Content | Each exercise (tap it on the Strength & mobility card): what it's for, steps, "Cuidado" cues, an easier version to start, and "▶ Ver cómo se hace" | The owner doesn't know some exercises and wants to avoid injury. `STRENGTH_ROUTINE` in `src/domain/strength.ts` |
| Language | Spanish for the instructions (the rest of the app stays English) | Technique cues are about safety |
| Videos | A YouTube search for the exercise, not a fixed video | Fixed links break or can't be checked from here; a search always works and lets the owner pick a teacher (ideally a physio or certified trainer) |
| Easier versions | Sit-to-stand on a chair, low step with the rail, lunges holding a wall, calf raises on flat ground, balance with a finger on the wall, side plank on the knees | Start safe, progress later |
| Safety | Stop with sharp, joint or next-day pain; see a physio with a previous injury; the coach can explain technique | |
| Illustrations | Not drawn: a wrong drawing teaches wrong form | Videos instead |

## 2026-11-22: pace guide on the watch

| Topic | Decision | Why / how to change |
|---|---|---|
| What | Watch app → "⚡ Pace guide": your pace over the last minute against today's brisk-walk target (sent by the phone with the Tile data), distance and time; works with the screen off | `PaceActivity`, `PaceGuideService`, `PaceCoach` in `wear/` |
| Cues | Two long buzzes: slower than the target by more than 5%. One short: back on pace after a nudge. Three short: target distance done. No cues in the first 2 minutes, at most one every 45 s | Over the last minute, so a red light doesn't trigger it. Faster than the target is fine (the goal is "or faster") |
| GPS | The watch's own GPS (fixes worse than 25 m and jumps faster than ~25 km/h are ignored). Needs location permission on the watch | |
| Recording | It does **not** record a workout: record the walk with Samsung Health as usual, so it reaches Health Connect and counts for the goal. The guide runs alongside | Health Services workouts from our app wouldn't reach Samsung Health, so the walk wouldn't count |
| No brisk walk today | The guide still shows your pace, without cues | |

## 2026-11-22: watch complication

| Topic | Decision | Why / how to change |
|---|---|---|
| Types | Ranged value (progress ring 0–100% with "62%" or "✓" and 🔥streak), short text ("62%" / "✓" with 🔥streak), long text (goal · progress, streak) | The common slots on Galaxy Watch faces. `SparkComplicationService.kt` |
| Data | The same state the Tile uses (sent by the phone after every sync); refreshed when it arrives, and every 30 minutes by the system. From another day: shows "—" / "New day: sync on the phone" instead of old numbers | |
| Tap | Opens the watch app's detail screen | |
| Live pace | Not in a complication: it can't follow a walk in real time. That's the pace guide (next) | |

## 2026-11-22: coach request fixes and debug info

| Topic | Decision | Why / how to change |
|---|---|---|
| 400 from the API | The answer schemas used `type: ["string","null"]` for optional fields; now `anyOf`. If a request is still rejected with a 400, it's retried once without schema enforcement or fallback, with the schema in the instructions, and the JSON is read leniently | First real chat message failed with a 400. `askClaude` in `src/services/coach.ts` |
| Errors | The error bubble shows the API's own message, and has "↻ Try again" | |
| Debug | Tap the Coach title (🐞), or Settings → Diagnostics: build, model, key saved (last 4 chars), coach switches, and the last 30 requests with purpose, strict/lenient, status, time, model, stop reason, tokens, error and request id. Selectable text | `src/ui/CoachDebug.tsx` |

## 2026-11-22: backup without remembering anything

The owner will forget manual backups.

| Topic | Decision | Why / how to change |
|---|---|---|
| Main backup | **Android Auto Backup** to the owner's Google account: automatic, about daily (charging, Wi-Fi), restored when the app is installed again on any phone with the same account (also for installed APKs) | No sign-in or server needed |
| Bug fixed | expo-secure-store's backup rules list only shared preferences, which silently left the SQLite history **out** of the backup since the coach was added. Our own rules (`plugins/withBackupRules.js`) include `files/SQLite/` and keep the key store excluded | Keys can't be restored on another phone anyway |
| Not included | The Claude API key (encrypted on the device); added again after a restore | |
| Folder copy | Stays as an optional extra (weekly, last 8) | |
| Check | Samsung: Settings → Accounts and backup → Back up data (Google Drive) must be on | |

## 2026-11-22: automatic weekly backup

| Topic | Decision | Why / how to change |
|---|---|---|
| Where | A folder you pick once with Android's folder picker (Settings → Backup → Automatic weekly backup) | Writing straight to Google Drive would need a Google sign-in and a Google Cloud app; Android's picker doesn't offer Drive folders. A phone folder you copy or sync to Drive is the honest option |
| When | Once a week, after a sync (background or app); after a failure, tries again the next day. "Back up now" any time | `backupDue` / `runAutoBackup` in `src/services/autoBackup.ts` |
| What | The same JSON as "Export history" (goals, how it felt, strength sessions, preferences); the newest 8 files are kept | Import works with any of them |
| Status | Settings shows the folder, the last backup, or the last error | |

## 2026-11-22: weather

| Topic | Decision | Why / how to change |
|---|---|---|
| Source | Open-Meteo (free, no account or key). You set your town in Settings → Weather (search by name); only its coordinates (rounded to ~1 km) are sent. Forecast cached 3 hours | No location permission needed. `src/services/weather.ts` |
| Bad weather | 70%+ chance of rain with 2+ mm, 33 °C or more, or 50+ km/h wind | `weatherIssue` |
| Suggestion | A long or brisk walk on a bad-weather day (from today, within the 10-day forecast): move it to the nearest free day of the same week with fine weather, not a work day, 2+ days from the other sessions if possible. "Move to …" or "Not now" (remembered). Back-to-back weeks and trek days are left alone | It's a suggestion, not automatic: forecasts change. `weatherSuggestions` |
| Week tab | A weather emoji next to each forecast day | |
| Coach | Sees the next 8 days' forecast | |

## 2026-11-22: work shifts from the phone's calendar

| Topic | Decision | Why / how to change |
|---|---|---|
| Source | The calendars you pick in Settings → Work shifts (read-only; write permission blocked in `app.json`) | expo-calendar. `src/services/calendar.ts` |
| Work day | 6+ hours of events that day in those calendars (an overnight shift counts its hours on each day), or an all-day event | `busyDaysFrom` in `src/domain/shifts.ts` |
| Key sessions | New plans avoid work days. Sessions already planned on a day that becomes a work day move to a free non-work day of the same week: 2+ days from the other sessions if possible, else the nearest. Sessions you moved yourself (or the coach did, with your OK) are pinned and stay. No better day: it stays | `planWeek`, `avoidBusyDays` |
| Regular goals | 30% lighter on a work day; the rest of the week rebalances | `WORK_DAY` in `sync.ts` |
| Week tab | 💼 next to work days; "Moved from Sat (work day)" | |
| Coach | Sees upcoming work days (chat, check-in, Sunday review) | |

## 2026-11-22: how it felt (1–10) and strength & mobility

| Topic | Decision | Why / how to change |
|---|---|---|
| When it asks | On Today, after a key session (long walk, brisk walk, back-to-back day, trek day) is done, today or yesterday: one tap, 1–10. Only key sessions, so it doesn't nag every day | `sessionToRate` in `src/domain/effort.ts` |
| What 9–10 changes | Next week's km **hold** instead of growing ("A key walk last week felt 9/10: holding steady"); the next brisk walk keeps the same pace. The morning check-in fires the day after a 9–10 | `planVolume`, `generateKeySession`, `checkinReasons`. Rules version 10 |
| The coach | Sees each day's rating and the strength sessions this week | |
| Strength & mobility | 10 minutes, any 2 days a week, ticked off on Today (the watch can't see it). Routine for trail legs: squats, step-ups, reverse lunges, calf raises, single-leg balance, side plank, stretches. +5 XP each; never affects the streak or goals. The card hides once 2 are done that week | `src/domain/strength.ts` |
| Storage | New tables `feelings` and `extras` (DB v6), included in the history export/import | |
| Watch | Rating from the watch: later, with the next watch update | |

## 2026-11-22: smaller APK

| Topic | Decision | Why / how to change |
|---|---|---|
| One APK per CPU type | ABI splits (config plugin `plugins/withAbiSplits.js`): the release has an arm64 APK for phones; an x86_64 APK is built only for the emulator smoke test and isn't published | The universal APK carried both sets of native libraries (66 MB) |
| Not done | R8 minification stays off | It stripped WorkManager's database class and crashed the app at launch |

## 2026-11-22: AI coach, step 3: morning check-in

| Topic | Decision | Why / how to change |
|---|---|---|
| When | Once a day, from your morning reminder until noon, **only if something stands out**: today is a recovery day; readiness is low; the last 2 days went without the goal (a rested recovery day doesn't count); from Thursday, under 60% of where the week should be; no rest days left with a 3+ day streak; or you wrote to the coach in the last 36 hours. Ordinary days: no request at all. Not when today's goal is already done | `checkinReasons` / `checkinDue` in `src/domain/checkin.ts` |
| Worth sending | The coach can still decide there's nothing useful to say (`worth_sending: false`): then nothing is sent | Keeps it from becoming noise |
| What you get | A notification ("☀️ A note from your coach" / "…has a suggestion for today") and a card on Today; the note is saved in the chat with Apply buttons, same changes and rules as the chat | `runDailyCheckin` in `src/services/coachChat.ts` |
| Background vs app | Runs in the background sync, or when you open the app in that window (without holding up the sync) | `afterSync` |
| Switch | Settings → AI coach → Morning check-in (on by default; needs the coach on and a key) | |
| Cost | Only on days with a reason: a few cents a month | |

## 2026-11-22: CI builds only the last of quick pushes

The owner asked: when builds are less than 5 minutes apart, cancel all but the last.

| Topic | Decision | Why / how to change |
|---|---|---|
| Rule | Each run first cancels this branch's unfinished runs that started less than 5 minutes before it. Older runs keep going | Quick fix-ups don't queue a build each; a build that's been running a while (maybe about to publish) isn't lost. `supersede` job in `.github/workflows/build-apk.yml` |
| Queue | Builds of a branch still run one at a time (job-level concurrency on `build`) | Same as before |

## 2026-11-22: AI coach, step 2: the chat

The owner chose rules as the base and AI for judgement and context ("hybrid"). The chat is where you tell the coach what the data can't show.

| Topic | Decision | Why / how to change |
|---|---|---|
| Where | "💬 Talk to the coach" on Today (with the coach on) and "💬 Chat" on the weekly review card. Starter chips for common situations | `src/app/coach.tsx` |
| What it can propose | Up to 2 per answer: **rest today**, **switch today's goal type**, **move a key session** (this week from today on, or next week from Sunday evening), **scale a week** (this week: only lighter; next week: Sunday-review rules) | `checkChatAction` in `src/domain/coachChat.ts`. Rest-day counts, aim and trek goal stay manual |
| Rest today | Today becomes a "🛌 Rest day, agreed with the coach", like a recovery day: resting doesn't use a rest day; a key session on today moves to the next free day. Stored as `settings.coachRestDay` (today only), so a later sync (e.g. sleep arriving) keeps it. Undo brings a normal goal back | `coachRestNotes`, sync |
| Contradictions | Rest today + another goal type today, or two changes to the same thing, in one answer: only the first is kept | `chatReplyFrom` |
| Context | Each message carries fresh data: now (day and time), today's goal and progress, this week so far, both plans with session ids and free days, recent weeks, streak and rest days left, aim, trek goal, cycle only if shared | `buildChatContext` |
| Memory | The conversation is kept on the phone; the last 20 messages go back to the model, with what happened to each proposal ("applied", "skipped"). Failed requests show as a red bubble and aren't sent back. "Clear" forgets the conversation (applied changes stay) | `historyText`, DB v5 `coach_chat` |
| Undo | Moves and week changes undo as in the review; rest today undoes; a goal-type switch is undone by picking another type on Today | |
| Model, key, language | Same as the Sunday review (Claude Opus 5.5, medium effort, your key in encrypted storage, Rioplatense Spanish, gender-neutral) | `src/services/coachChat.ts` |

## 2026-11-22: recovery day after a very big day

The owner expected the app to say "rest" the day after a huge walk.

| Topic | Decision | Why / how to change |
|---|---|---|
| When | The day after a day with at least 1.75× a regular day's share of the week **and** at least 6 km (all walking of the day, workouts or not). Only on regular days: a key session planned for today stays | `recoveryAfter` in `src/domain/recovery.ts` |
| What it says | "🛌 Recovery day": rest, or an easy 20-minute stroll if you feel like moving. The goal shown is the 20 minutes | |
| Streak | Resting on a recovery day is a rest day that **doesn't use** one of the week's rest days | Rest after a big effort is part of training, not a skip. `computeStreak` |
| Picking a goal type | If you pick Distance / Time / Heart rate on a recovery day, you get a normal goal | You want to move |
| A session that slid onto today | A missed key session that slid onto a recovery day slides on to the next free day (or is dropped on Sunday) | A brisk walk the day after a huge walk isn't wise |
| Rules version | `PLAN_VERSION` 9: today's goal is redone on update unless already completed | |

## 2026-11-21: cycle details on the Week tab

| Topic | Decision | Why / how to change |
|---|---|---|
| What's shown | Cycle length and where it comes from (the median of your last cycles, listed, or your setting), period length (from records or the 5-day default), the last recorded period and how many are known, and the next predicted period with "in N days" | The owner asked to see what the app reads and predicts. `CycleSummary` in `src/app/(tabs)/week.tsx` |
| Day-by-day flow | Health Connect "menstruation flow" days are read too and grouped into periods (days up to 2 apart = one period), alongside "menstruation period" records | Some apps (e.g. Samsung Health) log flow per day instead of whole periods. Same Android permission. `periodsFromDays` |

## 2026-11-21: AI coach, step 1: the Sunday review

The owner agreed: the AI only *proposes*, as concrete changes the plan's rules check, and nothing changes until they tap Apply. First step: the weekly review on Sunday evening; a chat comes later.

| Topic | Decision | Why / how to change |
|---|---|---|
| What it can propose | Up to 2 per week: **move a key session** of next week to a free day, or **scale next week's km** (one per week). Plus a summary of the week and one tip | The same changes you can make by hand. Rest days, aim and the trek goal stay your decisions: changing rest days would also re-judge past days. `CoachAction` in `src/domain/coach.ts` |
| Safety rules | Lighter: down to 60% at most. Harder: never in a light, pre-event or event week, and never past +10% of what you actually walked this week (usually that leaves no room, since the plan already grows). Changes under ±3% are dropped. Invalid ideas (taken day, trek day, other week) are dropped silently; a capped one says so ("⚖️ Capped at …") | `checkAction` |
| Applying | Apply / Not now per suggestion; Undo afterwards (moves back if that day is still free, km restored). A week change you applied **survives Monday's recompute** (stored as `plan.coach.factor`) | `applyProposal` / `undoProposal` / `withCoachFactor` |
| When | In the background, once next week's plan appears (Sunday from 18:00), with a notification "🧠 Your weekly review…"; or with "Get my weekly review" on the Week tab. A failed try is retried up to 3 times, 2 hours apart | `shouldAutoReview` |
| What it sees | A summary: this week's days (goal, result, done, key session, how rested you were), km this week and the 4 before, next week's plan (km, type, sessions, free days, the most it may grow to), streak, rest days, aim, trek goal. **No** raw workouts, heart rate or sleep times | `buildReviewInput` |
| Your cycle | Off by default: the coach only sees "light week". With **Share my cycle with the coach** on, it also sees that it's for your period and the next predicted start | Settings → AI coach |
| Model | Claude Opus 5.5 at medium effort, JSON answer checked against a schema. The server-side fallback is on: if the model declines, another model answers in the same call | `src/services/coach.ts`. About 2–4 US cents per review |
| API key | Your own Anthropic key, in Android's encrypted storage (expo-secure-store). Not in the database, not in backups. No server | Settings → AI coach |
| Language | The coach writes in Rioplatense Spanish (voseo), gender-neutral; the rest of the app stays English | Change the prompt in `src/services/coach.ts` |
| App start | The Claude SDK loads only when the coach runs | So the coach can never break or slow app start |

## 2026-11-21: watch Tile (Galaxy Watch5 Pro, Wear OS)

| Topic | Decision | Why / how to change |
|---|---|---|
| Content | Exactly the widget's content (`WidgetState` JSON), so phone widget and Tile always agree | `src/widget/state.ts` ↔ `wear/.../SparkState.kt` |
| Transport | Wear OS Data Layer: after every sync the phone puts the JSON at `/widget-state` (local Expo module `modules/wear-sync`); the watch's listener stores it and refreshes the Tile | No server, works over Bluetooth |
| Watch app | Separate native Kotlin project in `wear/` (Tiles + ProtoLayout Material): progress ring on the edge, streak/level, goal, "X of Y", climb, week dots; tap opens a small detail screen | Tiles are native-only; React Native doesn't run on the Tile |
| Same app id + key | `com.dailyspark.app`, signed with the phone app's key (from `expo prebuild`) | Required for the Data Layer to pair phone and watch apps |
| CI | Watch APK built after the phone APK (Gradle 8.11.1, AGP 8.7.3) and published in the same release; a watch build failure only warns | Phone updates keep flowing while the watch app is tuned |
| Not yet | Complication, interval guidance, recording workouts on the watch | Next steps once the Tile looks right |

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
