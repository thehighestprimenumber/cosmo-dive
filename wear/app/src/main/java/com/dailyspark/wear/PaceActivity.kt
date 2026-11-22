package com.dailyspark.wear

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** The pace guide screen: your pace over the last minute against today's brisk-walk target. */
class PaceActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var paceView: TextView
    private lateinit var targetView: TextView
    private lateinit var distanceView: TextView
    private lateinit var timeView: TextView
    private lateinit var button: Button

    private val tick = object : Runnable {
        override fun run() {
            update()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(20, 32, 20, 40)
            setBackgroundColor(Color.parseColor("#14110F"))
        }
        fun text(size: Float, color: String) = TextView(this).apply {
            textSize = size
            setTextColor(Color.parseColor(color))
            gravity = Gravity.CENTER
            setPadding(0, 4, 0, 4)
            column.addView(this)
        }
        targetView = text(13f, "#A89C93")
        paceView = text(34f, "#F7F1EC")
        distanceView = text(14f, "#F7F1EC")
        timeView = text(13f, "#A89C93")
        button = Button(this).apply {
            setOnClickListener { toggle() }
            column.addView(this)
        }
        text(11f, "#A89C93").text = "Two long buzzes: speed up. One short: back on pace. Three: distance done. Record the walk in Samsung Health as usual."
        setContentView(ScrollView(this).apply { addView(column) })
    }

    override fun onResume() {
        super.onResume()
        handler.post(tick)
    }

    override fun onPause() {
        handler.removeCallbacks(tick)
        super.onPause()
    }

    private fun toggle() {
        if (PaceGuideService.running) {
            PaceGuideService.stop(this)
            update()
            return
        }
        val missing = mutableListOf<String>()
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            missing += Manifest.permission.ACCESS_FINE_LOCATION
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing += Manifest.permission.POST_NOTIFICATIONS
        }
        if (missing.isNotEmpty()) {
            requestPermissions(missing.toTypedArray(), 1)
            return
        }
        val state = StateStore.load(this)
        PaceGuideService.start(this, state?.paceTarget?.takeIf { state?.isStale == false }, state?.paceMeters?.takeIf { state?.isStale == false })
        update()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) toggle()
        else targetView.text = "The pace guide needs location (GPS) to measure your pace."
    }

    private fun update() {
        val running = PaceGuideService.running
        val state = StateStore.load(this)
        val target = if (running) PaceGuideService.targetPace else state?.paceTarget?.takeIf { state?.isStale == false }
        val goalMeters = if (running) PaceGuideService.targetMeters else state?.paceMeters?.takeIf { state?.isStale == false }
        targetView.text = target?.let { "⚡ Target ${PaceCoach.format(it)} min/km or faster" } ?: "No brisk walk today: just your pace"
        if (running) {
            val pace = PaceGuideService.pace
            paceView.text = PaceCoach.format(pace)
            paceView.setTextColor(Color.parseColor(if (pace == null) "#F7F1EC" else if (PaceGuideService.slow) "#FFB547" else "#3DBE6E"))
            val km = PaceGuideService.meters / 1000
            distanceView.text = goalMeters?.let { "%.2f of %.1f km".format(km, it / 1000.0) } ?: "%.2f km".format(km)
            val s = (SystemClock.elapsedRealtime() - PaceGuideService.startedAt) / 1000
            timeView.text = "%d:%02d · last minute's pace".format(s / 60, s % 60)
            button.text = "■ Stop"
        } else {
            paceView.text = "--:--"
            paceView.setTextColor(Color.parseColor("#F7F1EC"))
            distanceView.text = goalMeters?.let { "%.1f km at that pace".format(it / 1000.0) } ?: ""
            timeView.text = "Start when you start walking"
            button.text = "▶ Start"
        }
    }
}
