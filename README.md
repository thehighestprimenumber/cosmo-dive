# 🔥 Daily Spark

A new walking or riding goal every day. Hit it to keep your streak alive.

Daily Spark reads the walks and rides your Galaxy Watch records (Samsung Health → **Health Connect**) and turns them into a daily goal plus a streak. Everything stays on your phone: there is no account and no server.

## How it works

- **A goal every day.** Goal types rotate through the week:
  - 📏 **Distance**: "Walk 5 km (or ride 15 km)". Rides count at 1/3 of their distance by default.
  - ⏱️ **Time**: "Move for 40 min". Walks and rides both count.
  - ❤️ **Heart rate zone**: "20 min in Zone 2". Only used once you have heart rate data.
- **Rest days** (Tue and Fri by default) never break your streak.
- **Streak freezes**: you earn one 🧊 for every 7 days completed, up to 2. A missed day uses a freeze instead of resetting your streak.
- **Progression**: there's no AI, just plain rules in [`src/domain/generator.ts`](src/domain/generator.ts):
  - Your starting level is the median daily amount from the last 28 days.
  - Each goal type goes up at most +7% a week, when you've been hitting it.
  - Missing two training days in a row eases the next goal by 15%.
  - Every 4th week is a recovery week at 75%.
  - Goals stay between 50% and 160% of what you actually do.
- **Background sync**: about every 30 minutes (Android decides exactly when), the app reads Health Connect, notifies you once when today's goal is done, and keeps the evening reminder up to date.
- **Backup**: **Settings → Export history** saves your goal history to a JSON file (e.g. to Google Drive). **Import history** merges it on a new phone and recalculates your streak.
- **History**: each day's goal is saved once, in SQLite, and never changed. Completion, streaks and the calendar are always *recalculated* from those goals plus Health Connect. If you edit or delete a workout, use **Settings → Rebuild history**.

## Install on your phone

**From your phone (easiest):** every push is built by GitHub Actions ([`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)) and published under **Releases**. Open the newest "Daily Spark build N", download the `.apk`, and allow "install unknown apps" when Android asks. Each build installs over the previous one and keeps your data.

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
