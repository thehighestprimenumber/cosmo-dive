package com.dailyspark.wear

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationText
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService

/**
 * Watch-face complication: today's progress as a ring (ranged value), a short
 * "62%" / "✓", or the goal as long text. Same data as the Tile, refreshed
 * whenever the phone syncs (and every 30 minutes by the system).
 */
class SparkComplicationService : SuspendingComplicationDataSourceService() {

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        build(this, type, SAMPLE)

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? =
        build(this, request.complicationType, StateStore.load(this))

    companion object {
        private val SAMPLE = SparkState(
            date = "", streak = 12, level = 4, emoji = "🥾", title = "Walk 5 km", detail = "3.1 of 5 km",
            fraction = 0.62f, done = false, climb = null, weekLine = "", dots = emptyList(), todayIndex = -1,
        )

        private fun text(s: String): ComplicationText = PlainComplicationText.Builder(s).build()

        fun build(context: Context, type: ComplicationType, state: SparkState?): ComplicationData? {
            val tap = PendingIntent.getActivity(
                context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
            )
            // Nothing from the phone yet, or from another day: say so instead of old numbers.
            if (state == null || (state.date.isNotEmpty() && state.isStale)) {
                return when (type) {
                    ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(text("🔥 —"), text("Daily Spark: open the phone app to sync"))
                        .setTapAction(tap).build()
                    ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(text("New day: sync on the phone"), text("Daily Spark: open the phone app to sync"))
                        .setTitle(text("🔥 Daily Spark")).setTapAction(tap).build()
                    ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(0f, 0f, 100f, text("Daily Spark: no data for today yet"))
                        .setText(text("—")).setTapAction(tap).build()
                    else -> NoDataComplicationData()
                }
            }
            val pct = (state.fraction * 100).toInt()
            val short = if (state.done) "✓" else "$pct%"
            val description = text("Daily Spark: ${state.title}, ${state.detail}, streak ${state.streak}")
            return when (type) {
                ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(pct.toFloat(), 0f, 100f, description)
                    .setText(text(short))
                    .setTitle(text("🔥${state.streak}"))
                    .setTapAction(tap)
                    .build()
                ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(text(short), description)
                    .setTitle(text("🔥${state.streak}"))
                    .setTapAction(tap)
                    .build()
                ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(text("${state.emoji} ${state.title} · ${state.detail}"), description)
                    .setTitle(text(if (state.done) "✓ Done · 🔥${state.streak}" else "🔥 ${state.streak}-day streak"))
                    .setTapAction(tap)
                    .build()
                else -> null
            }
        }

        /** Ask watch faces using the complication to redraw it (after the phone syncs). */
        fun requestUpdate(context: Context) {
            ComplicationDataSourceUpdateRequester
                .create(context, ComponentName(context, SparkComplicationService::class.java))
                .requestUpdateAll()
        }
    }
}
