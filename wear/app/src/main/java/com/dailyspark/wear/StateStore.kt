package com.dailyspark.wear

import android.content.Context
import android.net.Uri
import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable

/** The last state received from the phone, kept on the watch. */
object StateStore {
    private const val PREFS = "spark"
    private const val KEY = "state"
    const val PATH = "/widget-state"

    fun save(context: Context, json: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
    }

    fun load(context: Context): SparkState? =
        SparkState.parse(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null))

    /** Ask the Data Layer for the phone's latest state (e.g. right after installing the watch app). */
    fun refreshFromPhone(context: Context, then: () -> Unit = {}) {
        Wearable.getDataClient(context)
            .getDataItems(Uri.parse("wear://*$PATH"))
            .addOnSuccessListener { items ->
                var latest: Pair<Long, String>? = null
                for (item in items) {
                    val map = DataMapItem.fromDataItem(item).dataMap
                    val json = map.getString("json") ?: continue
                    val at = map.getLong("at")
                    if (latest == null || at > latest.first) latest = at to json
                }
                items.release()
                latest?.let {
                    save(context, it.second)
                    TileService.getUpdater(context).requestUpdate(SparkTileService::class.java)
                }
                then()
            }
            .addOnFailureListener { then() }
    }
}
