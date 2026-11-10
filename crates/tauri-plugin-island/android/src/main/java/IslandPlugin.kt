package app.getminus.island

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class FaceArg {
    var color: String = "#5fcfa6"
    var name: String = ""
}

@InvokeArg
class ShowArgs {
    var title: String = ""
    var sub: String = ""
    var faces: List<FaceArg> = listOf()
    var progress: Double = -1.0
    var ask: String? = null
    var askId: String? = null
    var agent: String? = null
    var options: List<String> = listOf()
}

@InvokeArg
class ListenArgs {
    lateinit var handler: Channel
}

/**
 * The island: Minus's agents in a small floating pill over other apps. It shows while Minus
 * is in the background and hides when you open Minus (you're already looking at it then).
 */
@TauriPlugin
class IslandPlugin(private val activity: Activity) : Plugin(activity) {
    private var island: Island? = null
    private var channel: Channel? = null
    private var inFront = true

    private fun canDraw(): Boolean = Settings.canDrawOverlays(activity)

    private fun island(): Island {
        val i = island ?: Island(activity.applicationContext) { data -> channel?.send(data) }
        island = i
        return i
    }

    @Command
    fun status(invoke: Invoke) {
        val r = JSObject()
        r.put("granted", canDraw())
        r.put("supported", true)
        invoke.resolve(r)
    }

    /** Opens Android's "Display over other apps" page for Minus. */
    @Command
    fun ask(invoke: Invoke) {
        if (!canDraw()) {
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + activity.packageName)))
            } catch (e: Exception) {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION))
            }
        }
        val r = JSObject()
        r.put("granted", canDraw())
        invoke.resolve(r)
    }

    @Command
    fun show(invoke: Invoke) {
        val args = invoke.parseArgs(ShowArgs::class.java)
        activity.runOnUiThread {
            val i = island()
            i.update(args)
            i.setVisible(!inFront && canDraw())
        }
        val r = JSObject()
        r.put("granted", canDraw())
        invoke.resolve(r)
    }

    @Command
    fun hide(invoke: Invoke) {
        activity.runOnUiThread { island?.clear() }
        invoke.resolve()
    }

    // used by the Rust side only: where taps on the island are sent
    @Command
    fun listen(invoke: Invoke) {
        channel = invoke.parseArgs(ListenArgs::class.java).handler
        invoke.resolve()
    }

    override fun onPause(activity: AppCompatActivity) {
        inFront = false
        island?.setVisible(canDraw())
    }

    override fun onResume(activity: AppCompatActivity) {
        inFront = true
        island?.setVisible(false)
    }
}
