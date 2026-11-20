# Decisions log

Product decisions made while the owner was away, so they can be reviewed and changed. Newest first.

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
