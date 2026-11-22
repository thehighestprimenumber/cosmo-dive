package com.dailyspark.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator

/**
 * Runs the pace guide while you walk, also with the screen off: reads GPS
 * from the watch, keeps the pace over the last minute and vibrates:
 * two long buzzes = speed up, one short = back on pace, three short = distance done.
 * It doesn't record a workout: record your walk with Samsung Health as usual,
 * so it reaches Health Connect and counts for your goal.
 */
class PaceGuideService : Service(), LocationListener {

    private var last: Location? = null
    private lateinit var coach: PaceCoach

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val target = intent?.getIntExtra(EXTRA_TARGET, 0)?.takeIf { it > 0 }
        val meters = intent?.getIntExtra(EXTRA_METERS, 0)?.takeIf { it > 0 }
        coach = PaceCoach(target, meters)
        startedAt = SystemClock.elapsedRealtime()
        targetPace = target
        targetMeters = meters
        running = true
        startInForeground()
        try {
            val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper())
        } catch (e: SecurityException) {
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onLocationChanged(location: Location) {
        if (location.hasAccuracy() && location.accuracy > 25f) return // too fuzzy to count
        val now = SystemClock.elapsedRealtime()
        val prev = last
        last = location
        val delta = if (prev == null) 0.0 else prev.distanceTo(location).toDouble()
        // GPS jumps (more than ~25 km/h on foot) are ignored.
        if (prev != null && delta > 7.0 * ((location.elapsedRealtimeNanos - prev.elapsedRealtimeNanos) / 1e9).coerceAtLeast(1.0)) return
        when (coach.add(delta, now)) {
            PaceCoach.Cue.SPEED_UP -> buzz(longArrayOf(0, 500, 250, 500))
            PaceCoach.Cue.ON_PACE -> buzz(longArrayOf(0, 150))
            PaceCoach.Cue.DISTANCE_DONE -> buzz(longArrayOf(0, 150, 120, 150, 120, 150))
            null -> {}
        }
        meters = coach.meters
        pace = coach.currentPace(now)
        slow = coach.isSlow(now)
    }

    @Suppress("DEPRECATION")
    private fun buzz(pattern: LongArray) {
        val v = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
        v.vibrate(VibrationEffect.createWaveform(pattern, -1))
    }

    private fun startInForeground() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Pace guide", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, PaceActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = Notification.Builder(this, CHANNEL)
            .setContentTitle("Pace guide")
            .setContentText(targetPace?.let { "Target ${PaceCoach.format(it)} min/km" } ?: "Showing your pace")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        else startForeground(NOTIFICATION_ID, n)
    }

    override fun onDestroy() {
        (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(this)
        running = false
        super.onDestroy()
    }

    companion object {
        const val EXTRA_TARGET = "target"
        const val EXTRA_METERS = "meters"
        private const val CHANNEL = "pace"
        private const val NOTIFICATION_ID = 7

        // Read by the screen once a second.
        @Volatile var running = false
        @Volatile var startedAt = 0L
        @Volatile var meters = 0.0
        @Volatile var pace: Int? = null
        @Volatile var slow = false
        @Volatile var targetPace: Int? = null
        @Volatile var targetMeters: Int? = null

        fun start(context: Context, target: Int?, meters: Int?) {
            this.meters = 0.0
            pace = null
            slow = false
            val i = Intent(context, PaceGuideService::class.java)
                .putExtra(EXTRA_TARGET, target ?: 0)
                .putExtra(EXTRA_METERS, meters ?: 0)
            context.startForegroundService(i)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, PaceGuideService::class.java))
        }
    }
}
