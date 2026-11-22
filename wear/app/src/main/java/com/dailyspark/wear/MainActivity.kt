package com.dailyspark.wear

import android.app.Activity
import android.content.Intent
import android.widget.Button
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Opened from the Tile: today's goal in more detail. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        render()
    }

    override fun onResume() {
        super.onResume()
        StateStore.refreshFromPhone(this) { runOnUiThread { render() } }
    }

    private fun render() {
        val state = StateStore.load(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(24, 36, 24, 48)
            setBackgroundColor(Color.parseColor("#14110F"))
        }
        fun line(text: String, size: Float, color: String) {
            column.addView(TextView(this).apply {
                this.text = text
                textSize = size
                setTextColor(Color.parseColor(color))
                gravity = Gravity.CENTER
                setPadding(0, 6, 0, 6)
            })
        }
        if (state == null) {
            line("🔥 Daily Spark", 16f, "#F7F1EC")
            line("Open Daily Spark on your phone: your goal shows up here after its next sync.", 13f, "#A89C93")
        } else {
            line("🔥 ${state.streak}-day streak · ⭐ ${state.level}", 13f, "#A89C93")
            line("${state.emoji} ${state.title}", 16f, "#F7F1EC")
            line(if (state.done) "✅ ${state.detail}" else state.detail, 14f, if (state.done) "#3DBE6E" else "#F7F1EC")
            state.climb?.let { line(it, 13f, "#A89C93") }
            line(state.weekLine, 12f, "#A89C93")
            if (state.isStale) line("From ${state.date}: open the phone app to update.", 12f, "#FFB547")
        }
        // Guided strength & mobility (the routine comes from the phone).
        if (state != null && state.routine.isNotEmpty()) {
            column.addView(Button(this).apply {
                text = if (state.strengthDone) "🦵 Fuerza ✓ (hecha hoy)" else "🦵 Fuerza guiada · ${state.strengthThisWeek} de 2"
                setOnClickListener { startActivity(Intent(this@MainActivity, StrengthActivity::class.java)) }
            })
        }
        // The pace guide: today's brisk walk target, or just your pace.
        column.addView(Button(this).apply {
            text = if (state?.paceTarget != null && !state.isStale) "⚡ Pace guide" else "Pace guide"
            setOnClickListener { startActivity(Intent(this@MainActivity, PaceActivity::class.java)) }
        })
        setContentView(ScrollView(this).apply { addView(column) })
    }
}
