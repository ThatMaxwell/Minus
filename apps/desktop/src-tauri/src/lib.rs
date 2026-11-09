//! Minus desktop: the app window, the always-on dock, the tray, and Minus Hands.
//!
//! Minus starts with the computer (hidden, with just the dock), so your phone can reach your
//! agents without you opening anything. Closing the window keeps Minus running in the tray.

use hands::{ActResult, Action, Hands, SnapshotOptions, Target, WindowInfo};
use serde::Serialize;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Minus Hands, started on first use (it isn't available on every platform yet).
#[derive(Default)]
struct HandsState(Mutex<Option<Hands>>);

impl HandsState {
    fn get(&self) -> Result<Hands, String> {
        let mut g = self.0.lock().map_err(|_| "Hands is busy")?;
        if g.is_none() {
            *g = Some(Hands::new().map_err(|e| e.to_string())?);
        }
        Ok(g.clone().unwrap())
    }
}

#[derive(Serialize)]
struct Look {
    outline: String,
    elements: usize,
    took_ms: u64,
    window: WindowInfo,
}

#[tauri::command]
async fn hands_windows(state: tauri::State<'_, HandsState>) -> Result<Vec<WindowInfo>, String> {
    let h = state.get()?;
    tauri::async_runtime::spawn_blocking(move || h.windows().map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn hands_look(state: tauri::State<'_, HandsState>, target: Option<Target>) -> Result<Look, String> {
    let h = state.get()?;
    tauri::async_runtime::spawn_blocking(move || {
        let s = h.snapshot(target.unwrap_or(Target::Focused), SnapshotOptions::default()).map_err(|e| e.to_string())?;
        Ok(Look { outline: hands::render(&s), elements: s.elements.len(), took_ms: s.took_ms, window: s.window })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn hands_act(state: tauri::State<'_, HandsState>, actions: Vec<Action>) -> Result<Vec<ActResult>, String> {
    let h = state.get()?;
    tauri::async_runtime::spawn_blocking(move || h.act(actions, false).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

/// The dock sizes itself to its content (so it never blocks clicks around it) and stays
/// centered at the top of the screen it's on, like an island.
#[tauri::command]
fn dock_fit(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let dock = app.get_webview_window("dock").ok_or("no dock")?;
    let mon = dock.current_monitor().ok().flatten().or_else(|| dock.primary_monitor().ok().flatten()).ok_or("no screen")?;
    let scale = mon.scale_factor();
    let (w, h) = ((width * scale).round() as u32, (height * scale).round() as u32);
    let x = mon.position().x + (mon.size().width as i32 - w as i32) / 2;
    let y = mon.position().y + (10.0 * scale) as i32;
    dock.set_size(PhysicalSize::new(w, h)).map_err(|e| e.to_string())?;
    dock.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Opens the main window (from the tray, the dock, a second launch or a minus:// link).
#[tauri::command]
fn show_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn toggle_dock(app: AppHandle) {
    if let Some(d) = app.get_webview_window("dock") {
        if d.is_visible().unwrap_or(false) { let _ = d.hide(); } else { let _ = d.show(); }
    }
}

fn make_dock(app: &AppHandle) -> tauri::Result<()> {
    let dock = WebviewWindowBuilder::new(app, "dock", WebviewUrl::App("dock.html".into()))
        .title("Minus")
        .inner_size(44.0, 44.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;
    let _ = dock;
    Ok(())
}

fn tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Minus", true, None::<&str>)?;
    let dock = MenuItem::with_id(app, "dock", "Show or hide the dock", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause all agents", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Minus", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &dock, &PredefinedMenuItem::separator(app)?, &pause, &PredefinedMenuItem::separator(app)?, &quit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id("minus")
        .icon(icon)
        .tooltip("Minus")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app.clone()),
            "dock" => toggle_dock(app.clone()),
            "pause" => { let _ = app.emit("pause-all", ()); }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|t, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(t.app_handle().clone());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let started_hidden = std::env::args().any(|a| a == "--hidden");
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // one Minus at a time: a second launch (or a minus:// link) opens the first one
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            show_main(app.clone());
            if let Some(url) = argv.iter().find(|a| a.starts_with("minus://")) {
                let _ = app.emit("deep-link", url.clone());
            }
        }));
        builder = builder.plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .manage(HandsState::default())
        .invoke_handler(tauri::generate_handler![hands_windows, hands_look, hands_act, dock_fit, show_main, toggle_dock])
        .setup(move |app| {
            let handle = app.handle().clone();

            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::ManagerExt;
                use tauri_plugin_deep_link::DeepLinkExt;
                // start with the computer, by default (Settings can turn it off)
                let marker = app.path().app_config_dir()?.join(".autostart-set");
                if !marker.exists() {
                    let _ = app.autolaunch().enable();
                    let _ = std::fs::create_dir_all(marker.parent().unwrap());
                    let _ = std::fs::write(&marker, b"1");
                }
                // installed builds register minus:// themselves; this covers running from source
                #[cfg(any(windows, target_os = "linux"))]
                let _ = app.deep_link().register_all();
                let h2 = handle.clone();
                app.deep_link().on_open_url(move |e| {
                    for url in e.urls() {
                        let _ = h2.emit("deep-link", url.to_string());
                    }
                    show_main(h2.clone());
                });

                tray(&handle)?;
                make_dock(&handle)?;
            }

            if !started_hidden {
                show_main(handle.clone());
            }
            Ok(())
        })
        .on_window_event(|w, e| {
            // closing the app window keeps Minus running (agents keep working, the dock stays)
            if let WindowEvent::CloseRequested { api, .. } = e {
                if w.label() == "main" {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Minus failed to start");
}
