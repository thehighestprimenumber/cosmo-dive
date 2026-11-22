package com.dailyspark.wear

import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/** Woken by the Data Layer when the phone syncs; stores the state and refreshes the Tile. */
class StateListenerService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED || event.dataItem.uri.path != StateStore.PATH) continue
            val json = DataMapItem.fromDataItem(event.dataItem).dataMap.getString("json") ?: continue
            StateStore.save(this, json)
        }
        TileService.getUpdater(this).requestUpdate(SparkTileService::class.java)
        SparkComplicationService.requestUpdate(this)
    }
}
