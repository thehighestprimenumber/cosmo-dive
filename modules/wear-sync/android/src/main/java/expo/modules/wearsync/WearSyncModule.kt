package expo.modules.wearsync

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
  }

  companion object {
    const val PATH = "/widget-state"
  }
}
