package com.dailyspark.wear

/**
 * The pace guide's brain, without Android: distance over time in, pace and
 * cues out. Pace is measured over the last minute, so a traffic light or a
 * photo stop doesn't trigger a cue by itself.
 */
class PaceCoach(
    /** Target pace in seconds per km, or null for "just show my pace". */
    private val targetSPerKm: Int?,
    /** Target distance in metres, or null. */
    private val targetMeters: Int?,
) {
    enum class Cue { SPEED_UP, ON_PACE, DISTANCE_DONE }

    private data class Point(val atMs: Long, val meters: Double)

    private val points = ArrayDeque<Point>()
    private var startMs: Long? = null
    private var lastCueMs = 0L
    private var wasSlow = false
    private var distanceDone = false

    var meters = 0.0
        private set

    fun elapsedMs(nowMs: Long): Long = startMs?.let { nowMs - it } ?: 0L

    /** Pace over the last minute (s/km), or null until there's enough to say. */
    fun currentPace(nowMs: Long): Int? {
        val first = points.firstOrNull { nowMs - it.atMs <= WINDOW_MS } ?: return null
        val span = nowMs - first.atMs
        val dist = meters - first.meters
        if (span < 20_000 || dist < 20) return null
        return ((span / 1000.0) / (dist / 1000.0)).toInt()
    }

    /** Is the last minute slower than the target (with 5% leeway)? */
    fun isSlow(nowMs: Long): Boolean {
        val pace = currentPace(nowMs) ?: return false
        val target = targetSPerKm ?: return false
        return pace > target * SLOW_LEEWAY
    }

    /** Add the distance covered since the last call. Returns a cue to vibrate for, if any. */
    fun add(deltaMeters: Double, nowMs: Long): Cue? {
        if (startMs == null) startMs = nowMs
        meters += deltaMeters
        points.addLast(Point(nowMs, meters))
        while (points.size > 2 && nowMs - points.first().atMs > WINDOW_MS * 2) points.removeFirst()

        if (!distanceDone && targetMeters != null && meters >= targetMeters) {
            distanceDone = true
            return Cue.DISTANCE_DONE
        }
        if (targetSPerKm == null || elapsedMs(nowMs) < WARMUP_MS || nowMs - lastCueMs < CUE_EVERY_MS) return null
        val slow = isSlow(nowMs)
        val cue = when {
            slow -> Cue.SPEED_UP
            wasSlow -> Cue.ON_PACE // back on pace after a nudge
            else -> null
        }
        if (cue != null) lastCueMs = nowMs
        wasSlow = slow
        return cue
    }

    companion object {
        const val WINDOW_MS = 60_000L
        /** No cues in the first 2 minutes: time to get going. */
        const val WARMUP_MS = 120_000L
        /** At most one cue every 45 seconds. */
        const val CUE_EVERY_MS = 45_000L
        const val SLOW_LEEWAY = 1.05

        fun format(sPerKm: Int?): String = if (sPerKm == null || sPerKm <= 0 || sPerKm > 3600) "--:--"
        else "%d:%02d".format(sPerKm / 60, sPerKm % 60)
    }
}
