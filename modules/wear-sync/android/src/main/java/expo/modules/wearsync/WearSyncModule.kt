package expo.modules.wearsync

import android.net.Uri
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Puts the widget state (JSON) in the Wear OS Data Layer at /widget-state.
 * The watch app listens for it and refreshes its Tile. With no watch paired,
 * the item just waits; nothing fails.
 */
class WearSyncModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WearSync")

    AsyncFunction("sendState") { json: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val request = PutDataMapRequest.create(PATH).apply {
        dataMap.putString("json", json)
        // A new timestamp makes every sync a change, so the watch always hears about it.
        dataMap.putLong("at", System.currentTimeMillis())
      }.asPutDataRequest().setUrgent()
      Wearable.getDataClient(context)
        .putDataItem(request)
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { promise.resolve(false) }
    }

    // Days the watch's guided strength session was finished (JSON array of "YYYY-MM-DD").
    AsyncFunction("getStrengthDone") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve("[]")
        return@AsyncFunction
      }
      Wearable.getDataClient(context)
        .getDataItems(Uri.parse("wear://*$STRENGTH_PATH"))
        .addOnSuccessListener { items ->
          val dates = linkedSetOf<String>()
          for (item in items) {
            val raw = DataMapItem.fromDataItem(item).dataMap.getString("dates") ?: continue
            try {
              val arr = org.json.JSONArray(raw)
              for (i in 0 until arr.length()) dates.add(arr.getString(i))
            } catch (e: Exception) {
              // Ignore a malformed item.
            }
          }
          items.release()
          promise.resolve(org.json.JSONArray(dates.toList()).toString())
        }
        .addOnFailureListener { promise.resolve("[]") }
    }
  }

  companion object {
    const val PATH = "/widget-state"
    const val STRENGTH_PATH = "/strength-done"
  }
}
