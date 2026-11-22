package com.dailyspark.wear

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.os.CountDownTimer
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Guided strength & mobility: one exercise at a time, timers for holds and
 * rests, a buzz when it's time to move on. Finishing marks it done on the phone.
 */
class StrengthActivity : Activity() {
    private var steps: List<Step> = emptyList()
    private var at = 0
    private var timer: CountDownTimer? = null
    private var timerRunning = false

    private lateinit var progress: TextView
    private lateinit var title: TextView
    private lateinit var dose: TextView
    private lateinit var clock: TextView
    private lateinit var cue: TextView
    private lateinit var main: Button
    private lateinit var skip: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        steps = StrengthPlan.steps(StateStore.load(this)?.routine ?: emptyList())

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(22, 30, 22, 40)
            setBackgroundColor(Color.parseColor("#14110F"))
        }
        fun text(size: Float, color: String) = TextView(this).apply {
            textSize = size
            setTextColor(Color.parseColor(color))
            gravity = Gravity.CENTER
            setPadding(0, 3, 0, 3)
            column.addView(this)
        }
        progress = text(11f, "#A89C93")
        title = text(16f, "#F7F1EC")
        dose = text(13f, "#F7F1EC")
        clock = text(30f, "#FF7A1A")
        main = Button(this).apply { column.addView(this) }
        skip = Button(this).apply { column.addView(this) }
        cue = text(11f, "#A89C93")
        setContentView(ScrollView(this).apply { addView(column) })

        if (steps.isEmpty()) {
            title.text = "🦵 Fuerza y movilidad"
            dose.text = "Abrí Daily Spark en el celu para que mande la rutina."
            clock.text = ""
            main.text = "Cerrar"
            main.setOnClickListener { finish() }
            skip.visibility = Button.GONE
        } else {
            show()
        }
    }

    override fun onDestroy() {
        timer?.cancel()
        super.onDestroy()
    }

    private fun show() {
        timer?.cancel()
        timerRunning = false
        if (at >= steps.size) return finished()
        val s = steps[at]
        val e = s.exercise
        progress.text = "${s.index + 1} de ${steps.last().index + 1} · serie ${s.set} de ${e.sets}"
        if (s.rest) {
            val next = steps.getOrNull(at + 1)
            title.text = "Descanso"
            dose.text = next?.let { "Sigue: ${it.exercise.name}" + (it.side?.let { side -> " ($side)" } ?: "") } ?: ""
            cue.text = ""
            main.text = "Seguir ya"
            main.setOnClickListener { next() }
            skip.visibility = Button.GONE
            startTimer(s.seconds ?: StrengthPlan.REST_SECONDS, autoNext = true)
            return
        }
        title.text = e.name
        val side = s.side?.let { " · $it" } ?: ""
        dose.text = (if (e.reps != null) "${e.reps} repeticiones" else "${s.seconds} segundos") + side
        cue.text = "⚠️ ${e.cue}\nMás fácil: ${e.easier}"
        skip.visibility = Button.VISIBLE
        skip.text = "Saltar ejercicio"
        skip.setOnClickListener { skipExercise() }
        if (s.seconds != null) {
            clock.text = format(s.seconds)
            main.text = "▶ Empezar"
            main.setOnClickListener {
                if (!timerRunning) {
                    main.text = "✓ Listo"
                    startTimer(s.seconds, autoNext = true)
                } else {
                    next()
                }
            }
        } else {
            clock.text = ""
            main.text = "✓ Listo"
            main.setOnClickListener { next() }
        }
    }

    private fun startTimer(seconds: Int, autoNext: Boolean) {
        timerRunning = true
        clock.text = format(seconds)
        timer = object : CountDownTimer(seconds * 1000L, 250L) {
            override fun onTick(msLeft: Long) {
                clock.text = format(((msLeft + 999) / 1000).toInt())
            }

            override fun onFinish() {
                clock.text = format(0)
                buzz(longArrayOf(0, 300, 150, 300))
                if (autoNext) next()
            }
        }.start()
    }

    private fun next() {
        at++
        show()
    }

    /** Jump past every remaining set (and rest) of this exercise. */
    private fun skipExercise() {
        val current = steps[at].index
        while (at < steps.size && steps[at].index == current) at++
        show()
    }

    private fun finished() {
        StrengthStore.markDoneToday(this)
        buzz(longArrayOf(0, 150, 120, 150, 120, 150))
        progress.text = ""
        title.text = "¡Listo! 🦵"
        dose.text = "Queda marcada en Daily Spark (+5 XP) en la próxima sincronización."
        clock.text = ""
        cue.text = ""
        main.text = "Cerrar"
        main.setOnClickListener { finish() }
        skip.visibility = Button.GONE
    }

    @Suppress("DEPRECATION")
    private fun buzz(pattern: LongArray) {
        val v = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
        v.vibrate(VibrationEffect.createWaveform(pattern, -1))
    }

    private fun format(s: Int) = "%d:%02d".format(s / 60, s % 60)
}
