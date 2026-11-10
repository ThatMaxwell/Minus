//! The island on Android: your agents in a small floating pill over other apps, like the
//! dock on the computer. Tap it to open; when an agent asks something, the answers are right
//! there. Android calls this "Display over other apps"; Minus asks for it once, in Settings.
//! On other platforms these commands do nothing (the desktop has its own dock window).

use serde_json::{json, Value};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct Island<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
fn native<R: Runtime>(app: &AppHandle<R>, cmd: &str, args: Value) -> Result<Value, String> {
    app.state::<Island<R>>().0.run_mobile_plugin::<Value>(cmd, args).map_err(|e| e.to_string())
}
#[cfg(not(target_os = "android"))]
fn native<R: Runtime>(_app: &AppHandle<R>, _cmd: &str, _args: Value) -> Result<Value, String> {
    Ok(json!({ "granted": false, "supported": false }))
}

/// Whether the island can be shown ({ granted, supported }).
#[tauri::command]
fn status<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    native(&app, "status", json!({}))
}
/// Opens the system page where you allow "Display over other apps".
#[tauri::command]
fn ask<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    native(&app, "ask", json!({}))
}
/// What the island shows: { title, sub, faces: [{color, name}], progress, ask, askId, agent, options }.
/// It only appears while Minus itself is in the background.
#[tauri::command]
fn show<R: Runtime>(app: AppHandle<R>, state: Value) -> Result<Value, String> {
    native(&app, "show", state)
}
#[tauri::command]
fn hide<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    native(&app, "hide", json!({}))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("island")
        .invoke_handler(tauri::generate_handler![status, ask, show, hide])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::ipc::{Channel, InvokeResponseBody};
                use tauri::Emitter;
                let handle = api.register_android_plugin("app.getminus.island", "IslandPlugin")?;
                // taps on the island (an answer, "open") come back as the "island" event
                let app2 = app.clone();
                #[derive(serde::Serialize)]
                struct Listen {
                    handler: Channel,
                }
                handle.run_mobile_plugin::<()>(
                    "listen",
                    Listen {
                        handler: Channel::new(move |body| {
                            if let InvokeResponseBody::Json(s) = body {
                                let v: Value = serde_json::from_str(&s).unwrap_or(Value::Null);
                                let _ = app2.emit("island", v);
                            }
                            Ok(())
                        }),
                    },
                )?;
                app.manage(Island(handle));
            }
            let _ = (app, api);
            Ok(())
        })
        .build()
}
