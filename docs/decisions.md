# Decisions log

Product decisions made while the owner was away, so they can be reviewed and changed. Newest first.

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
| Not trained yet | **Elevation gain** (Sierra Norte is mountainous) and altitude. Possible next step: Health Connect ElevationGained for hill goals | |
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
