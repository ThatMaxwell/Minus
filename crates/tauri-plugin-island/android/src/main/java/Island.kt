package app.getminus.island

import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.TextUtils
import android.transition.AutoTransition
import android.transition.TransitionManager
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.widget.LinearLayout
import android.widget.TextView
import app.tauri.plugin.JSObject
import kotlin.math.abs
import kotlin.math.max

/**
 * The floating island, drawn with plain Android views (it lives outside the app's web view).
 *   collapsed: the faces of the agents at work, who's doing what, and progress
 *   opened (tap, or when an agent asks you something): the question and its answers
 * Drag it anywhere; it stays out of the way of whatever you're doing.
 */
class Island(private val ctx: Context, private val send: (JSObject) -> Unit) {
    private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val density = ctx.resources.displayMetrics.density
    private fun dp(v: Float): Int = (v * density + 0.5f).toInt()

    private val box = LinearLayout(ctx)
    private val pill = LinearLayout(ctx)
    private val faces = FacesView(ctx)
    private val texts = LinearLayout(ctx)
    private val title = TextView(ctx)
    private val sub = TextView(ctx)
    private val ring = RingView(ctx)
    private val ping = View(ctx)
    private val more = LinearLayout(ctx)
    private val question = TextView(ctx)
    private val buttons = LinearLayout(ctx)

    private var state: ShowArgs? = null
    private var added = false
    private var wanted = false
    private var open = false
    private var lastAsk: String? = null

    private val params = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT
    ).apply {
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        y = dp(8f)
    }

    init {
        box.orientation = LinearLayout.VERTICAL
        box.background = GradientDrawable().apply {
            setColor(Color.BLACK)
            cornerRadius = dp(24f).toFloat()
            setStroke(max(1, dp(0.6f)), Color.argb(34, 255, 255, 255))
        }
        box.setPadding(dp(6f), dp(6f), dp(14f), dp(6f))

        pill.orientation = LinearLayout.HORIZONTAL
        pill.gravity = Gravity.CENTER_VERTICAL
        pill.addView(faces)

        texts.orientation = LinearLayout.VERTICAL
        texts.setPadding(dp(8f), 0, dp(8f), 0)
        title.setTextColor(Color.rgb(242, 242, 239))
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
        title.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        title.maxWidth = dp(210f)
        title.setSingleLine(true)
        title.ellipsize = TextUtils.TruncateAt.END
        sub.setTextColor(Color.rgb(166, 166, 171))
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        sub.maxWidth = dp(210f)
        sub.setSingleLine(true)
        sub.ellipsize = TextUtils.TruncateAt.END
        texts.addView(title)
        texts.addView(sub)
        pill.addView(texts)

        pill.addView(ring, LinearLayout.LayoutParams(dp(18f), dp(18f)))
        ping.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.rgb(245, 169, 79)) }
        pill.addView(ping, LinearLayout.LayoutParams(dp(9f), dp(9f)).apply { leftMargin = dp(6f) })
        box.addView(pill)

        more.orientation = LinearLayout.VERTICAL
        more.setPadding(dp(6f), dp(10f), 0, dp(6f))
        question.setTextColor(Color.rgb(242, 242, 239))
        question.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
        question.maxWidth = dp(290f)
        question.setLineSpacing(0f, 1.15f)
        more.addView(question)
        buttons.orientation = LinearLayout.HORIZONTAL
        buttons.gravity = Gravity.END
        more.addView(buttons, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12f) })
        more.visibility = View.GONE
        box.addView(more)

        dragAndTap()
    }

    /** New content from the app. */
    fun update(s: ShowArgs) {
        state = s
        TransitionManager.beginDelayedTransition(box, AutoTransition().setDuration(220))
        title.text = s.title
        sub.text = s.sub
        sub.visibility = if (s.sub.isEmpty()) View.GONE else View.VISIBLE
        faces.set(s.faces.take(3).map { parse(it.color) })
        ring.visibility = if (s.progress in 0.0..1.0 && s.ask == null) View.VISIBLE else View.GONE
        ring.progress = s.progress.toFloat()
        ping.visibility = if (s.ask != null) View.VISIBLE else View.GONE
        // someone needs you: open by itself, with a little hop
        if (s.ask != null && s.askId != lastAsk) {
            lastAsk = s.askId
            open = true
            if (added) hop()
        }
        if (s.ask == null && lastAsk != null) {
            lastAsk = null
            open = false
        }
        fillMore()
        if (wanted) attach()
    }

    fun setVisible(v: Boolean) {
        wanted = v
        if (v) attach() else detach()
    }

    fun clear() {
        state = null
        detach()
    }

    private fun attach() {
        if (added || state == null || state!!.title.isEmpty()) {
            if (state == null || state!!.title.isEmpty()) detach()
            return
        }
        try {
            wm.addView(box, params)
            added = true
            box.alpha = 0f
            box.scaleX = 0.85f
            box.scaleY = 0.85f
            box.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(OvershootInterpolator(1.6f)).start()
        } catch (e: Exception) {
            added = false
        }
    }

    private fun detach() {
        if (!added) return
        try {
            wm.removeView(box)
        } catch (e: Exception) {
        }
        added = false
    }

    private fun hop() {
        box.animate().scaleX(1.06f).scaleY(1.06f).setDuration(120).withEndAction {
            box.animate().scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(OvershootInterpolator(2f)).start()
        }.start()
    }

    private fun fillMore() {
        val s = state ?: return
        buttons.removeAllViews()
        if (!open) {
            more.visibility = View.GONE
            return
        }
        more.visibility = View.VISIBLE
        question.text = s.ask ?: "Open Minus to see everyone"
        val opts = s.options
        if (s.ask != null && opts.isNotEmpty()) {
            opts.forEachIndexed { i, o ->
                buttons.addView(button(o, i == opts.size - 1) {
                    val d = JSObject()
                    d.put("kind", "choice")
                    d.put("askId", s.askId)
                    d.put("agent", s.agent)
                    d.put("value", o)
                    send(d)
                    sub.text = "Sent"
                    open = false
                    fillMore()
                })
            }
        } else if (s.ask != null) {
            buttons.addView(button("Answer", true) { openApp(s.agent) })
        } else {
            buttons.addView(button("Open Minus", true) { openApp(null) })
        }
    }

    private fun button(text: String, solid: Boolean, onTap: () -> Unit): TextView {
        val b = TextView(ctx)
        b.text = text
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
        b.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        b.setTextColor(if (solid) Color.rgb(11, 11, 12) else Color.rgb(242, 242, 239))
        b.background = GradientDrawable().apply {
            setColor(if (solid) Color.rgb(243, 242, 238) else Color.argb(26, 255, 255, 255))
            cornerRadius = dp(18f).toFloat()
        }
        b.setPadding(dp(16f), dp(9f), dp(16f), dp(9f))
        b.setOnClickListener { onTap() }
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        lp.leftMargin = dp(8f)
        b.layoutParams = lp
        return b
    }

    private fun openApp(agent: String?) {
        val d = JSObject()
        d.put("kind", "open")
        d.put("agent", agent)
        send(d)
        val i = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        ctx.startActivity(i)
        open = false
        fillMore()
    }

    // drag it around; a tap opens or closes it
    private fun dragAndTap() {
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var moved = false
        pill.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = params.x; startY = params.y; moved = false
                    box.animate().scaleX(0.96f).scaleY(0.96f).setDuration(90).start()
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (abs(dx) > dp(6f) || abs(dy) > dp(6f)) moved = true
                    if (moved && added) {
                        params.x = startX + dx.toInt()
                        params.y = max(0, startY + dy.toInt())
                        wm.updateViewLayout(box, params)
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    box.animate().scaleX(1f).scaleY(1f).setDuration(160).start()
                    if (!moved && e.action == MotionEvent.ACTION_UP) {
                        TransitionManager.beginDelayedTransition(box, AutoTransition().setDuration(220))
                        open = !open
                        fillMore()
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun parse(c: String): Int = try { Color.parseColor(c) } catch (e: Exception) { Color.rgb(95, 207, 166) }

    /** The agents' faces: their colors, with eyes that blink now and then. */
    inner class FacesView(c: Context) : View(c) {
        private var colors: List<Int> = listOf()
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        private val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; style = Paint.Style.STROKE }
        private val eye = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(20, 20, 24) }
        private val shine = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        private var blink = 1f
        private val blinker = object : Runnable {
            override fun run() {
                animateBlink()
                postDelayed(this, 2800L + (Math.random() * 3000).toLong())
            }
        }

        fun set(cs: List<Int>) {
            if (cs == colors) return
            colors = cs
            requestLayout()
            invalidate()
        }

        override fun onAttachedToWindow() {
            super.onAttachedToWindow()
            postDelayed(blinker, 1800)
        }

        override fun onDetachedFromWindow() {
            removeCallbacks(blinker)
            super.onDetachedFromWindow()
        }

        private fun animateBlink() {
            val start = System.currentTimeMillis()
            val step = object : Runnable {
                override fun run() {
                    val t = (System.currentTimeMillis() - start) / 160f
                    blink = if (t < 0.5f) 1f - t * 1.8f else if (t < 1f) 0.1f + (t - 0.5f) * 1.8f else 1f
                    invalidate()
                    if (t < 1f) postOnAnimation(this)
                }
            }
            postOnAnimation(step)
        }

        override fun onMeasure(w: Int, h: Int) {
            val n = max(1, colors.size)
            setMeasuredDimension(dp(30f) + (n - 1) * dp(20f), dp(30f))
        }

        override fun onDraw(canvas: Canvas) {
            val r = dp(14f).toFloat()
            val list = if (colors.isEmpty()) listOf(Color.rgb(230, 230, 228)) else colors
            edge.strokeWidth = dp(2f).toFloat()
            list.forEachIndexed { i, col ->
                val cx = r + dp(1f) + i * dp(20f)
                val cy = height / 2f
                fill.color = col
                canvas.drawCircle(cx, cy, r, fill)
                canvas.drawCircle(cx, cy, r, edge)
                // big dark eyes, like the mascots
                val ex = r * 0.4f
                val ew = r * 0.29f
                val eh = r * 0.38f * blink
                for (s in listOf(-1f, 1f)) {
                    canvas.drawOval(RectF(cx + s * ex - ew, cy - eh, cx + s * ex + ew, cy + eh), eye)
                    if (blink > 0.6f) canvas.drawCircle(cx + s * ex + ew * 0.35f, cy - eh * 0.45f, ew * 0.32f, shine)
                }
            }
        }
    }

    /** How far along the work is. */
    inner class RingView(c: Context) : View(c) {
        var progress: Float = 0f
            set(v) {
                field = v
                invalidate()
            }
        private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.argb(40, 255, 255, 255) }
        private val fg = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.rgb(95, 207, 166); strokeCap = Paint.Cap.ROUND }

        override fun onDraw(canvas: Canvas) {
            val sw = dp(2.6f).toFloat()
            bg.strokeWidth = sw
            fg.strokeWidth = sw
            val rect = RectF(sw, sw, width - sw, height - sw)
            canvas.drawOval(rect, bg)
            canvas.drawArc(rect, -90f, 360f * progress.coerceIn(0f, 1f), false, fg)
        }
    }
}
