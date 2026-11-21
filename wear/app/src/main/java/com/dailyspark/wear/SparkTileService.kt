package com.dailyspark.wear

import android.content.Context
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.CircularProgressIndicator
import androidx.wear.protolayout.material.ProgressIndicatorColors
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.protolayout.material.layouts.EdgeContentLayout
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

private const val RESOURCES_VERSION = "1"

// Same palette as the phone app.
private const val BG_TRACK = 0xFF332B26.toInt()
private const val TEXT = 0xFFF7F1EC.toInt()
private const val MUTED = 0xFFA89C93.toInt()
private const val ACCENT = 0xFFFF7A1A.toInt()
private const val DONE = 0xFF3DBE6E.toInt()
private val DOT = mapOf(
    "done" to DONE,
    "missed" to 0xFFD9534F.toInt(),
    "frozen" to 0xFF5BB8E8.toInt(),
    "rest" to 0xFF4B4440.toInt(),
    "pending" to 0xFFFFB547.toInt(),
    "none" to 0xFF14110F.toInt(),
    "future" to BG_TRACK,
)

/**
 * The Daily Spark Tile: progress ring around the edge; streak, today's goal and
 * progress in the middle; the week as dots. Tap opens the watch app.
 */
class SparkTileService : TileService() {

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val state = StateStore.load(this)
        if (state == null) StateStore.refreshFromPhone(this)
        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            .setFreshnessIntervalMillis(30 * 60 * 1000L)
            .setTileTimeline(
                TimelineBuilders.Timeline.fromLayoutElement(layout(this, state, requestParams.deviceConfiguration)),
            )
            .build()
        return Futures.immediateFuture(tile)
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> =
        Futures.immediateFuture(ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION).build())
}

internal fun layout(context: Context, state: SparkState?, device: DeviceParameters): LayoutElementBuilders.LayoutElement {
    val content = LayoutElementBuilders.Column.Builder()
        .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
        .setModifiers(openApp(context))

    if (state == null || state.isStale) {
        content.addContent(text(context, if (state == null) "🔥 Daily Spark" else "🔥 ${state.streak}", Typography.TYPOGRAPHY_CAPTION1, MUTED))
        content.addContent(text(context, "Open Daily Spark on your phone for today’s goal", Typography.TYPOGRAPHY_BODY2, TEXT, 3))
    } else {
        content.addContent(text(context, "🔥 ${state.streak} · ⭐ ${state.level}", Typography.TYPOGRAPHY_CAPTION1, MUTED))
        content.addContent(text(context, "${state.emoji} ${state.title}", Typography.TYPOGRAPHY_BODY1, TEXT, 2))
        content.addContent(
            text(context, if (state.done) "✅ ${state.detail}" else state.detail, Typography.TYPOGRAPHY_CAPTION1, if (state.done) DONE else TEXT),
        )
        state.climb?.let { content.addContent(text(context, it, Typography.TYPOGRAPHY_CAPTION2, MUTED)) }
        content.addContent(dots(state))
    }

    val ring = CircularProgressIndicator.Builder()
        .setProgress(if (state == null || state.isStale) 0f else state.fraction)
        .setCircularProgressIndicatorColors(
            ProgressIndicatorColors(if (state?.done == true) DONE else ACCENT, BG_TRACK),
        )
        .build()

    return EdgeContentLayout.Builder(device)
        .setEdgeContent(ring)
        .setContent(content.build())
        .build()
}

private fun text(context: Context, value: String, typography: Int, color: Int, maxLines: Int = 1) =
    Text.Builder(context, value)
        .setTypography(typography)
        .setColor(argb(color))
        .setMaxLines(maxLines)
        .build()

/** Monday … Sunday, today outlined. */
private fun dots(state: SparkState): LayoutElementBuilders.LayoutElement {
    val row = LayoutElementBuilders.Row.Builder()
    state.dots.forEachIndexed { i, status ->
        if (i > 0) row.addContent(LayoutElementBuilders.Spacer.Builder().setWidth(dp(3f)).build())
        val background = ModifiersBuilders.Background.Builder()
            .setColor(argb(DOT[status] ?: BG_TRACK))
            .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(4f)).build())
            .build()
        val modifiers = ModifiersBuilders.Modifiers.Builder().setBackground(background)
        if (i == state.todayIndex) {
            modifiers.setBorder(ModifiersBuilders.Border.Builder().setWidth(dp(1f)).setColor(argb(TEXT)).build())
        }
        row.addContent(
            LayoutElementBuilders.Box.Builder()
                .setWidth(dp(8f))
                .setHeight(dp(8f))
                .setModifiers(modifiers.build())
                .build(),
        )
    }
    return LayoutElementBuilders.Box.Builder()
        .setModifiers(
            ModifiersBuilders.Modifiers.Builder()
                .setPadding(ModifiersBuilders.Padding.Builder().setTop(dp(6f)).build())
                .build(),
        )
        .addContent(row.build())
        .build()
}

private fun openApp(context: Context): ModifiersBuilders.Modifiers =
    ModifiersBuilders.Modifiers.Builder()
        .setClickable(
            ModifiersBuilders.Clickable.Builder()
                .setId("open")
                .setOnClick(
                    ActionBuilders.LaunchAction.Builder()
                        .setAndroidActivity(
                            ActionBuilders.AndroidActivity.Builder()
                                .setPackageName(context.packageName)
                                .setClassName(MainActivity::class.java.name)
                                .build(),
                        )
                        .build(),
                )
                .build(),
        )
        .build()
