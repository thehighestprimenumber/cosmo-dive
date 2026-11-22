package com.dailyspark.wear

import android.content.Context
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONArray
import java.time.LocalDate

/** One exercise of the strength & mobility routine, as the phone sends it. */
data class Exercise(
    val id: String,
    val name: String,
    val cue: String,
    val easier: String,
    val sets: Int,
    val reps: Int?,
    val seconds: Int?,
    val sides: Boolean,
) {
    companion object {
        fun parseList(arr: JSONArray?): List<Exercise> {
            if (arr == null) return emptyList()
            return List(arr.length()) { i -> arr.optJSONObject(i) }.mapNotNull { o ->
                o ?: return@mapNotNull null
                Exercise(
                    id = o.optString("id"),
                    name = o.optString("name"),
                    cue = o.optString("cue"),
                    easier = o.optString("easier"),
                    sets = o.optInt("sets", 1).coerceIn(1, 5),
                    reps = o.optInt("reps", 0).takeIf { it > 0 },
                    seconds = o.optInt("seconds", 0).takeIf { it > 0 },
                    sides = o.optBoolean("sides"),
                )
            }
        }
    }
}

/** One screen of the guided session: an exercise set (per side), or a rest. */
data class Step(
    val exercise: Exercise,
    val index: Int, // exercise number, 0-based
    val set: Int, // 1-based
    val side: String?, // "derecha" / "izquierda", or null
    val rest: Boolean,
    val seconds: Int?, // timed work or rest; null = reps, tap when done
)

object StrengthPlan {
    const val REST_SECONDS = 30

    /** Exercise by exercise, set by set, side by side, with a rest after each (not after the last). */
    fun steps(routine: List<Exercise>): List<Step> {
        val out = mutableListOf<Step>()
        routine.forEachIndexed { i, e ->
            for (set in 1..e.sets) {
                val sides = if (e.sides) listOf("derecha", "izquierda") else listOf(null)
                for (side in sides) {
                    out += Step(e, i, set, side, rest = false, seconds = e.seconds)
                    out += Step(e, i, set, side, rest = true, seconds = REST_SECONDS)
                }
            }
        }
        if (out.isNotEmpty() && out.last().rest) out.removeAt(out.size - 1)
        return out
    }
}

/** Days the session was finished on the watch, shared with the phone through the Data Layer. */
object StrengthStore {
    private const val PREFS = "spark"
    private const val KEY = "strengthDone"
    const val PATH = "/strength-done"

    fun markDoneToday(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val dates = (prefs.getString(KEY, null)?.split(",")?.filter { it.isNotBlank() } ?: emptyList()).toMutableList()
        val today = LocalDate.now().toString()
        if (today !in dates) dates += today
        val recent = dates.sorted().takeLast(30)
        prefs.edit().putString(KEY, recent.joinToString(",")).apply()
        val request = PutDataMapRequest.create(PATH).apply {
            dataMap.putString("dates", JSONArray(recent).toString())
            dataMap.putLong("at", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        Wearable.getDataClient(context).putDataItem(request)
    }
}
