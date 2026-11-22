package com.dailyspark.wear

import org.json.JSONObject
import java.time.LocalDate

/**
 * What the phone sends after every sync: the same content as the home-screen
 * widget (src/widget/state.ts → WidgetState). Keep the two in step.
 */
data class SparkState(
    val date: String,
    val streak: Int,
    val level: Int,
    val emoji: String,
    val title: String,
    val detail: String,
    val fraction: Float,
    val done: Boolean,
    val climb: String?,
    val weekLine: String,
    val dots: List<String>,
    val todayIndex: Int,
    /** Brisk walk today: target pace (seconds per km) and distance (m), for the pace guide. */
    val paceTarget: Int? = null,
    val paceMeters: Int? = null,
    /** Strength & mobility: done today, sessions this week, and the routine for the guided session. */
    val strengthDone: Boolean = false,
    val strengthThisWeek: Int = 0,
    val routine: List<Exercise> = emptyList(),
) {
    /** Built for an earlier day: the phone hasn't synced today yet. */
    val isStale: Boolean get() = date != LocalDate.now().toString()

    companion object {
        fun parse(json: String?): SparkState? {
            if (json.isNullOrBlank()) return null
            return try {
                val o = JSONObject(json)
                val dots = o.optJSONArray("dots")
                SparkState(
                    date = o.optString("date"),
                    streak = o.optInt("streak"),
                    level = o.optInt("level", 1),
                    emoji = o.optString("emoji"),
                    title = o.optString("title"),
                    detail = o.optString("detail"),
                    fraction = o.optDouble("fraction", 0.0).toFloat().coerceIn(0f, 1f),
                    done = o.optBoolean("done"),
                    climb = if (o.isNull("climb")) null else o.optString("climb"),
                    weekLine = o.optString("weekLine"),
                    dots = List(dots?.length() ?: 0) { i -> dots!!.optString(i) },
                    todayIndex = o.optInt("todayIndex", -1),
                    paceTarget = o.optJSONObject("pace")?.optInt("targetSPerKm")?.takeIf { it > 0 },
                    paceMeters = o.optJSONObject("pace")?.optInt("meters")?.takeIf { it > 0 },
                    strengthDone = o.optJSONObject("strength")?.optBoolean("done") ?: false,
                    strengthThisWeek = o.optJSONObject("strength")?.optInt("doneThisWeek") ?: 0,
                    routine = Exercise.parseList(o.optJSONObject("strength")?.optJSONArray("routine")),
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}
