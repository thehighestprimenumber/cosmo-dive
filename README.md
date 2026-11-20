# 🔥 Daily Spark

A new walking or riding goal every day. Hit it to keep your streak alive.

Daily Spark reads the walks and rides your Galaxy Watch records (Samsung Health → **Health Connect**) and turns them into a daily goal plus a streak. Everything stays on your phone: there is no account and no server.

## How it works

- **A goal every day.** Goal types rotate through the week:
  - 📏 **Distance**: "Walk 5 km (or ride 15 km)". Rides count at 1/3 of their distance by default.
  - ⏱️ **Time**: "Move for 40 min". Walks and rides both count.
  - ❤️ **Heart rate zone**: "20 min in Zone 2". Only used once you have heart rate data.
- **Weekly plan (Week tab)**: each week has two key sessions, a 🥾 **long walk** (one outing) and a ⚡ **brisk walk** (walking at a target pace). Other days keep the daily goal. Sessions are placed on your usual big days and can be moved to any free day. A missed one slides to the next free day. Next week's plan appears on Sunday evening. Optional 🎯 **goal with a date** (e.g. a 15 km hike): the long walk builds up to it and tapers the week before. Decisions behind the details: [`docs/decisions.md`](docs/decisions.md).
- **Every sport counts**: any exercise your watch records (kayak, swimming, gym…) counts for time and heart rate goals. Walks, hikes and runs count for distance 1:1, rides at 1/3. Doing something different today? Switch today's goal to **Distance**, **Time** or **Heart rate** on the Today screen (until you've completed it).
- **Flexible rest days**: no fixed days. Every day has a goal, and you choose how many rest days you get per week (2 by default). Any day you don't hit the goal uses one of them, without breaking your streak. Train on a day you meant to rest and the rest day stays available for later that week. Only days beyond your rest days break the streak.
- **Streak freezes**: you earn one 🧊 for every 7 days completed, up to 2. A missed day uses a freeze instead of resetting your streak.
- **Progression**: there's no AI, just plain rules in [`src/domain/generator.ts`](src/domain/generator.ts):
  - Your starting level is **your typical day**: the *mode* (most common value) of your **total exercise per day** over the last 90 days. All walks and rides of a day are added up (rides count at 1/3 for distance), and only days with 15+ minutes of exercise count. It's not an average of individual workouts. **Settings → Diagnostics** shows these numbers.
  - **Aim (optional, Settings)**: an average of N km a day over *every* day, rest days included. A training day then needs N × 7 ÷ training days (with 2 rest days, 5 km/day → 7 km). Goals start at 60% of that at least, go up 10% each time you complete one of the same type, and stop at the aim. Time goals use your walking pace. The monthly challenge becomes at least N × days in the month. Today shows your real 14-day average next to the aim. Once that average reaches the aim, Today offers to raise it (+10%, rounded to 0.5 km). "Not now" asks again in a week, and the background sync notifies you once per aim.
  - Each goal type goes up at most +7% a week, when you've been hitting it.
  - Missing two training days in a row (beyond your rest days) eases the next goal by 15%.
  - The day after a big effort (150%+ of the goal), the goal is 10% lighter.
  - Every 4th week is a recovery week at 80%.
  - Goals stay between 80% and 150% of your typical day.
  - **Readiness** (optional sleep permission): after a short night (under 5.5 h, or 20% below your usual) or a resting heart rate 5+ bpm above your 2-week usual, today's goal is 15% lighter. Well rested with a low resting heart rate: 5% harder. A goal made before you woke up is redone once last night's sleep syncs (unless you've already done it). These tweaks apply to today only and never lower the plan.
  - Each goal lists *why* it is what it is under **Why this goal**.
- **Game**:
  - ⚔️ **Boss day**: one random day each week, the goal is 25% harder and worth 30 XP.
  - **XP and levels**: 10 XP per goal plus a streak bonus (up to +10), and +25 for a perfect week. Levels at 100, 300, 600, 1000 XP…
  - **Monthly challenge**: walking km this month vs. last month + 10%. The target is fixed when the month starts.
  - 🏆 **Achievements** (streaks, bosses, perfect week, all-rounder, comeback, monthly champion, 100 km month, level 5). Once unlocked, they stay unlocked.
- **Reminders**: a morning reminder, an evening "save your streak" reminder, and (optional) a nudge 30 minutes before the time you usually start moving, learned from the last 4 weeks. The last two only fire while today's goal isn't done.
- **Background sync**: about every 30 minutes (Android decides exactly when), the app reads Health Connect, notifies you once when today's goal is done, and keeps the evening reminder up to date.
- **Backup**: **Settings → Export history** saves your goal history to a JSON file (e.g. to Google Drive). **Import history** merges it on a new phone and recalculates your streak.
- **History**: each day's goal is saved once, in SQLite, and never changed. The one exception is today's goal: it's recalculated when you change settings or the rules change in an update, unless you've already completed it. Completion, streaks and the calendar are always *recalculated* from those goals plus Health Connect. If you edit or delete a workout, use **Settings → Rebuild history**.

## Install on your phone

**From your phone (easiest):** every push is built by GitHub Actions ([`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)) and published under **Releases**. Open the newest "Daily Spark build N", download the `.apk`, and allow "install unknown apps" when Android asks. Each build installs over the previous one and keeps your data.

Before a build is published, CI opens it on an Android 14 emulator. If the app crashes or the welcome screen doesn't show, the build is not published. CI then walks through onboarding with demo data, Today, Calendar, Settings and Diagnostics, taking a screenshot of each. A failed walkthrough only raises a warning. The logs and screenshots are in the run's `smoke-test-logs` artifact.

**Alternative: an EAS cloud build.** You need a free [expo.dev](https://expo.dev/signup) account. You don't need Android Studio.

```bash
npm install
npx eas-cli@latest login
npm run build:apk          # = eas build --platform android --profile preview
```

The first build asks to create an EAS project and an Android signing key. Answer **yes** to both. When it finishes (about 10–15 min), EAS shows a link and QR code. Open it on your phone, download the APK, and allow "install unknown apps" when Android asks.

### Before the first run
1. Open **Samsung Health → Settings → Health Connect** and turn on sharing for **exercise**, **heart rate** and **distance**.
2. Record a short walk with the watch, then check it appears in **Settings → Health Connect → Data and access**.
3. Open Daily Spark, tap **Connect Health Connect**, and allow every permission it asks for, including "Access past data".
4. In **Settings → Apps → Daily Spark → Battery**, choose **Unrestricted** so reminders and background sync run on time.

If a walk doesn't show up, open **Settings → Diagnostics**. It lists every exercise session Health Connect has from the last 14 days, whether it counts, its distance and heart rate samples, the granted permissions, and when the background sync last ran.

No watch data yet? Tap **Try with demo data** to explore the app. You can switch to Health Connect later in Settings.

## Develop

```bash
npm test             # unit tests for goals, streaks, zones, sync
npm run typecheck
npx expo start       # needs a development build, not Expo Go (Health Connect is a native module)
```

| Path | What |
|---|---|
| `src/domain/` | Pure TypeScript: goal generator, progress, heart rate zones, streaks, formatting |
| `src/sources/` | `ActivitySource` interface, the Health Connect source and the demo source |
| `src/data/db.ts` | SQLite schema and queries (`goals`, `day_results` cache, `settings`) |
| `src/services/sync.ts` | Fills in goals for days without one, re-checks recent days, replays the streak |
| `src/services/notifications.ts` | Morning reminder, evening "save your streak" reminder, goal-complete notification |
| `src/services/backgroundSync.ts` | Background task that syncs while the app is closed |
| `src/data/backup.ts` | Export and import of goal history |
| `src/app/` | Screens (Expo Router): onboarding, Today, Calendar, Settings, Diagnostics |

## Not in the MVP yet
- Galaxy Watch Tile or complication
- More sports, more goal types, Strava as a second data source
- Automatic backups (export is manual for now)
