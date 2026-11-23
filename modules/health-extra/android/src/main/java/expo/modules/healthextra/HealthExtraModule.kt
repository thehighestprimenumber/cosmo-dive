package expo.modules.healthextra

import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.runBlocking
import java.time.Instant
import kotlin.reflect.KClass

/**
 * Activity intensity (Google Fit's "move minutes": moderate / vigorous
 * intervals) from Health Connect. The record type is newer than the
 * react-native-health-connect library, so it's read here, by reflection.
 */
class HealthExtraModule : Module() {
  private val recordClassName = "androidx.health.connect.client.records.ActivityIntensityRecord"
  private val permission = "android.permission.health.READ_ACTIVITY_INTENSITY"

  @Suppress("UNCHECKED_CAST")
  private fun recordClass(): KClass<Record>? =
    try {
      (Class.forName(recordClassName) as Class<Record>).kotlin
    } catch (e: Throwable) {
      null
    }

  private fun client(): HealthConnectClient? {
    val context = appContext.reactContext ?: return null
    return try {
      HealthConnectClient.getOrCreate(context)
    } catch (e: Throwable) {
      null
    }
  }

  override fun definition() = ModuleDefinition {
    Name("HealthExtra")

    // "unsupported" (no such record type in this Health Connect client), "denied" or "granted".
    AsyncFunction("activityIntensityStatus") { promise: Promise ->
      if (recordClass() == null) return@AsyncFunction promise.resolve("unsupported")
      val c = client() ?: return@AsyncFunction promise.resolve("unsupported")
      val granted = runBlocking { c.permissionController.getGrantedPermissions() }
      promise.resolve(if (granted.contains(permission)) "granted" else "denied")
    }

    // Shows Health Connect's permission screen for activity intensity. Resolves true if granted.
    AsyncFunction("requestActivityIntensity") { promise: Promise ->
      val activity = appContext.currentActivity as? ComponentActivity
      if (activity == null || recordClass() == null) return@AsyncFunction promise.resolve(false)
      val contract = PermissionController.createRequestPermissionResultContract()
      var launcher: androidx.activity.result.ActivityResultLauncher<Set<String>>? = null
      launcher = activity.activityResultRegistry.register("health-extra-${System.nanoTime()}", contract) { granted ->
        launcher?.unregister()
        promise.resolve(granted.contains(permission))
      }
      launcher.launch(setOf(permission))
    }.runOnQueue(Queues.MAIN)

    // Intervals in [startIso, endIso): {start, end (epoch ms), type: 0 moderate / 1 vigorous, origin}.
    AsyncFunction("readActivityIntensity") { startIso: String, endIso: String, promise: Promise ->
      val kclass = recordClass() ?: return@AsyncFunction promise.resolve(emptyList<Map<String, Any>>())
      val c = client() ?: return@AsyncFunction promise.resolve(emptyList<Map<String, Any>>())
      try {
        val out = mutableListOf<Map<String, Any>>()
        runBlocking {
          var token: String? = null
          do {
            val response = c.readRecords(
              ReadRecordsRequest(
                recordType = kclass,
                timeRangeFilter = TimeRangeFilter.between(Instant.parse(startIso), Instant.parse(endIso)),
                pageToken = token,
              ),
            )
            for (r in response.records) {
              val cls = r.javaClass
              val start = cls.getMethod("getStartTime").invoke(r) as Instant
              val end = cls.getMethod("getEndTime").invoke(r) as Instant
              val type = (cls.getMethod("getActivityIntensityType").invoke(r) as Number).toInt()
              out += mapOf(
                "start" to start.toEpochMilli().toDouble(),
                "end" to end.toEpochMilli().toDouble(),
                "type" to type,
                "origin" to r.metadata.dataOrigin.packageName,
              )
            }
            token = response.pageToken
          } while (token != null)
        }
        promise.resolve(out)
      } catch (e: SecurityException) {
        promise.resolve(emptyList<Map<String, Any>>())
      }
    }
  }
}
