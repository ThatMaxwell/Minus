//! Minus desktop: the app window, the always-on dock, the tray, and Minus Hands.
//!
//! Minus starts with the computer (hidden, with just the dock), so your phone can reach your
//! agents without you opening anything. Closing the window keeps Minus running in the tray.

mod keys;

use hands::{ActResult, Action, Hands, SnapshotOptions, Target, WindowInfo};
use serde::Deserialize;
use std::sync::Arc;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
// the window, dock, ghost and tray are desktop things; the phone app only controls agents
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::{PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent};

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

/// The screen right now, small enough to show in the app, and how to map screen pixels onto it
/// (so the app can mark where an agent is acting).
#[derive(Serialize)]
struct Screen {
    png: String,
    width: u32,
    height: u32,
    scale: f64,
    origin_x: i32,
    origin_y: i32,
}

#[tauri::command]
async fn hands_screen(state: tauri::State<'_, HandsState>, max_edge: Option<u32>) -> Result<Screen, String> {
    use base64::Engine;
    let h = state.get()?;
    tauri::async_runtime::spawn_blocking(move || {
        let s = h.screenshot_for_model(max_edge.unwrap_or(960)).map_err(|e| e.to_string())?;
        Ok(Screen { png: base64::engine::general_purpose::STANDARD.encode(&s.png), width: s.width, height: s.height, scale: s.scale, origin_x: s.origin_x, origin_y: s.origin_y })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn hands_act(state: tauri::State<'_, HandsState>, actions: Vec<Action>) -> Result<Vec<ActResult>, String> {
    let h = state.get()?;
    tauri::async_runtime::spawn_blocking(move || h.act(actions, false).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

/* ───────── agents: the real runtime (see crates/agent) ───────── */

struct Agents(agent::Runtime);

#[derive(Deserialize)]
struct BrainIn {
    /// anthropic, openai, gemini, grok, openrouter, ollama, custom
    provider: String,
    /// which saved key to use (the provider's id in Settings)
    slot: String,
    model: String,
    effort: Option<String>,
    base_url: Option<String>,
}

fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// The agent's AI with its key (read here, never sent to the page).
fn brain_of(app: &AppHandle, brain: BrainIn) -> Result<agent::Brain, String> {
    let key = keys::get(&data_dir(app)?, &brain.slot).unwrap_or_default();
    if key.is_empty() && brain.provider != "ollama" {
        return Err("This agent's AI isn't connected yet. Add a key in Settings → Your AI.".into());
    }
    Ok(agent::Brain { provider: brain.provider, model: brain.model, key, effort: brain.effort, base_url: brain.base_url })
}

#[tauri::command]
async fn agent_run(app: AppHandle, rt: tauri::State<'_, Agents>, spec: agent::AgentSpec, brain: BrainIn, text: String) -> Result<(), String> {
    if rt.0.is_running(&spec.id) {
        return Err(format!("{} is already working. Stop it first, or wait.", spec.name));
    }
    let brain = brain_of(&app, brain)?;
    let id = spec.id.clone();
    let app2 = app.clone();
    let emit: Arc<dyn Fn(agent::Event) + Send + Sync> = Arc::new(move |e| {
        let _ = app2.emit("agent-event", serde_json::json!({ "agent": id, "event": e }));
    });
    rt.0.start(spec, brain, text, emit);
    Ok(())
}

/// What agents can do on this device: use the computer (Windows, for now), or only think and write.
#[derive(Serialize)]
struct Caps {
    computer: bool,
    platform: &'static str,
}
#[tauri::command]
fn agent_caps(rt: tauri::State<'_, Agents>) -> Caps {
    Caps { computer: rt.0.has_computer(), platform: std::env::consts::OS }
}

/// Tries a key with its provider before it's saved: Ok(models it can use), or the reason it
/// didn't work. With no key given, it checks the one already saved for `slot`.
#[tauri::command]
async fn ai_check(app: AppHandle, rt: tauri::State<'_, Agents>, provider: String, slot: String, key: Option<String>, model: String, base_url: Option<String>, name: String) -> Result<Vec<String>, String> {
    let key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()).or_else(|| keys::get(&data_dir(&app).ok()?, &slot)).unwrap_or_default();
    if key.is_empty() && provider != "ollama" && provider != "custom" {
        return Err("Paste the API key first.".into());
    }
    let brain = agent::Brain { provider, model, key, effort: None, base_url: base_url.filter(|u| !u.trim().is_empty()) };
    rt.0.check(&brain, &name).await
}

/// Ask the room: one agent's answer (round 1), or its reply to the others (round 2).
#[tauri::command]
async fn room_answer(app: AppHandle, rt: tauri::State<'_, Agents>, spec: agent::AgentSpec, brain: BrainIn, notes: String, question: String, others: Vec<(String, String)>, round: u8) -> Result<agent::room::Answer, String> {
    let brain = brain_of(&app, brain)?;
    rt.0.room_answer(&spec, &brain, &notes, &question, &others, round).await
}
#[tauri::command]
async fn room_sum_up(app: AppHandle, rt: tauri::State<'_, Agents>, spec: agent::AgentSpec, brain: BrainIn, question: String, said: Vec<(String, String)>) -> Result<agent::room::Answer, String> {
    let brain = brain_of(&app, brain)?;
    rt.0.room_sum_up(&spec, &brain, &question, &said).await
}
/// Rewind: keep the first `jobs` jobs of this agent's conversation and forget the rest.
#[tauri::command]
fn agent_rewind(rt: tauri::State<'_, Agents>, agent: String, jobs: usize) {
    rt.0.rewind(&agent, jobs);
}

#[tauri::command]
fn agent_reply(rt: tauri::State<'_, Agents>, call: String, answer: String) -> bool {
    rt.0.reply(&call, answer)
}
#[tauri::command]
fn agent_stop(rt: tauri::State<'_, Agents>, agent: String) {
    rt.0.stop(&agent);
}
#[tauri::command]
fn agent_forget(rt: tauri::State<'_, Agents>, agent: String) {
    rt.0.forget(&agent);
}

/* ───────── "show me once": watch the person do a job, then replay it as a skill ───────── */

#[derive(Default)]
struct Teach(hands::Teacher);

/// Starts watching. The app window steps aside so you can do the job; the dock shows each
/// step as it's recorded and has the Done button.
#[tauri::command]
fn teach_start(app: AppHandle, t: tauri::State<'_, Teach>) -> Result<(), String> {
    t.0.start().map_err(|e| e.to_string())?;
    #[cfg(desktop)]
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
    }
    let _ = app;
    Ok(())
}
#[tauri::command]
fn teach_steps(t: tauri::State<'_, Teach>) -> Vec<hands::TaughtStep> {
    t.0.steps()
}
#[tauri::command]
fn teach_stop(app: AppHandle, t: tauri::State<'_, Teach>) -> Vec<hands::TaughtStep> {
    let steps = t.0.stop();
    #[cfg(desktop)]
    show_main(app);
    let _ = app;
    steps
}

#[tauri::command]
fn skill_run(app: AppHandle, rt: tauri::State<'_, Agents>, agent: String, skill: agent::skills::Skill, inputs: std::collections::HashMap<String, String>) -> Result<(), String> {
    let id = agent.clone();
    let emit: Arc<dyn Fn(agent::Event) + Send + Sync> = Arc::new(move |e| {
        let _ = app.emit("agent-event", serde_json::json!({ "agent": id, "event": e }));
    });
    rt.0.run_skill(agent, skill, inputs, emit)
}

#[tauri::command]
fn keys_list(app: AppHandle) -> Result<Vec<String>, String> {
    Ok(keys::list(&data_dir(&app)?))
}
#[tauri::command]
fn keys_set(app: AppHandle, slot: String, key: String) -> Result<(), String> {
    keys::set(&data_dir(&app)?, &slot, key.trim())
}
#[tauri::command]
fn keys_remove(app: AppHandle, slot: String) -> Result<(), String> {
    keys::remove(&data_dir(&app)?, &slot);
    Ok(())
}

/* ───────── the MacBook notch: the island grows out of it ───────── */

/// The notch's size in points, or nothing on screens without one (and off macOS).
#[derive(Serialize, Clone, Copy)]
struct NotchSize {
    width: f64,
    height: f64,
}
static NOTCH: Mutex<Option<NotchSize>> = Mutex::new(None);

#[cfg(target_os = "macos")]
mod notch {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior, NSWindowSharingType};

    /// The notch of the screen this window is on.
    /// # Safety
    /// `ns_window` is a live NSWindow, and this runs on the main thread.
    pub unsafe fn of(ns_window: *mut std::ffi::c_void) -> Option<super::NotchSize> {
        let w: &NSWindow = &*(ns_window as *const NSWindow);
        let screen = w.screen()?;
        let insets = screen.safeAreaInsets();
        if insets.top <= 0.0 {
            return None;
        }
        let (l, r) = (screen.auxiliaryTopLeftArea(), screen.auxiliaryTopRightArea());
        let width = r.origin.x - (l.origin.x + l.size.width);
        (width > 0.0).then_some(super::NotchSize { width, height: insets.top })
    }

    /// Above the menu bar, on every space and over full-screen apps, and left out of screenshots.
    /// # Safety
    /// As above.
    pub unsafe fn raise(ns_window: *mut std::ffi::c_void) {
        let w: &NSWindow = &*(ns_window as *const NSWindow);
        w.setLevel(27); // the menu bar is 24
        w.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::Stationary | NSWindowCollectionBehavior::FullScreenAuxiliary | NSWindowCollectionBehavior::IgnoresCycle);
        w.setHasShadow(false);
        w.setSharingType(NSWindowSharingType::None);
    }
}

#[cfg(desktop)]
#[tauri::command]
fn dock_notch() -> Option<NotchSize> {
    *NOTCH.lock().unwrap()
}

/// The dock sizes itself to its content (so it never blocks clicks around it) and stays
/// centered at the top of the screen it's on, like an island.
#[cfg(desktop)]
#[tauri::command]
fn dock_fit(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let dock = app.get_webview_window("dock").ok_or("no dock")?;
    let mon = dock.current_monitor().ok().flatten().or_else(|| dock.primary_monitor().ok().flatten()).ok_or("no screen")?;
    let scale = mon.scale_factor();
    let (w, h) = ((width * scale).round() as u32, (height * scale).round() as u32);
    let x = mon.position().x + (mon.size().width as i32 - w as i32) / 2;
    // with a notch it hangs from the very top of the screen; otherwise it floats just below
    let gap = if NOTCH.lock().unwrap().is_some() { 0.0 } else { 10.0 };
    let y = mon.position().y + (gap * scale) as i32;
    dock.set_size(PhysicalSize::new(w, h)).map_err(|e| e.to_string())?;
    dock.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Opens the main window (from the tray, the dock, a second launch or a minus:// link).
#[cfg(desktop)]
#[tauri::command]
fn show_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(desktop)]
#[tauri::command]
fn toggle_dock(app: AppHandle) {
    if let Some(d) = app.get_webview_window("dock") {
        if d.is_visible().unwrap_or(false) { let _ = d.hide(); } else { let _ = d.show(); }
    }
}

#[cfg(desktop)]
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
    hide_from_capture(&dock);
    #[cfg(target_os = "macos")]
    if let Ok(p) = dock.ns_window() {
        // setup runs on the main thread, which AppKit needs
        unsafe {
            notch::raise(p);
            *NOTCH.lock().unwrap() = notch::of(p);
        }
    }
    Ok(())
}

/// Keeps a window out of screenshots and screen recordings (Windows 10 2004 and later),
/// so agents never see the dock or the ghost cursor in what they look at.
#[cfg(desktop)]
fn hide_from_capture(w: &tauri::WebviewWindow) {
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() {
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE};
        let hwnd = windows::Win32::Foundation::HWND(h.0 as *mut _);
        unsafe {
            let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        }
    }
    let _ = w;
}

/// The ghost cursor: a see-through layer over the whole main screen that ignores the mouse.
#[cfg(desktop)]
fn make_ghost(app: &AppHandle) -> tauri::Result<()> {
    let ghost = WebviewWindowBuilder::new(app, "ghost", WebviewUrl::App("ghost.html".into()))
        .title("Minus")
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
    if let Some(m) = ghost.primary_monitor()? {
        ghost.set_position(*m.position())?;
        ghost.set_size(*m.size())?;
    }
    ghost.set_ignore_cursor_events(true)?;
    hide_from_capture(&ghost);
    Ok(())
}

#[tauri::command]
fn ghost_pace(rt: tauri::State<'_, Agents>, ms: u64) {
    rt.0.set_pace(ms);
}

#[cfg(desktop)]
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

/// The commands the app's pages can call.
#[cfg(desktop)]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![hands_windows, hands_look, hands_act, hands_screen, dock_fit, dock_notch, show_main, toggle_dock, agent_run, agent_caps, ai_check, agent_reply, agent_stop, agent_forget, keys_list, keys_set, keys_remove, ghost_pace, teach_start, teach_steps, teach_stop, skill_run, room_answer, room_sum_up, agent_rewind]
}
#[cfg(mobile)]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![hands_windows, hands_look, hands_act, hands_screen, agent_run, agent_caps, ai_check, agent_reply, agent_stop, agent_forget, keys_list, keys_set, keys_remove, ghost_pace, teach_start, teach_steps, teach_stop, skill_run, room_answer, room_sum_up, agent_rewind]
}

/// When Minus can't start or hits a bug it can't recover from, say so (a popup on Windows,
/// and minus-crash.log in the temp folder) instead of vanishing.
fn report(msg: &str) {
    eprintln!("{msg}");
    let path = std::env::temp_dir().join("minus-crash.log");
    let _ = std::fs::write(&path, format!("{msg}\n"));
    #[cfg(windows)]
    if std::env::var_os("MINUS_NO_DIALOG").is_none() {
        use windows::core::HSTRING;
        use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let text = format!("{msg}\n\nThis was saved to {}. Send it to the Minus team.", path.display());
        unsafe {
            MessageBoxW(None, &HSTRING::from(text), &HSTRING::from("Minus"), MB_OK | MB_ICONERROR);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|info| report(&format!("Minus hit a problem and has to close.\n\n{info}"))));
    #[cfg(desktop)]
    let started_hidden = std::env::args().any(|a| a == "--hidden");
    #[allow(unused_mut)]
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
        .plugin(tauri_plugin_island::init())
        .manage(HandsState::default())
        .manage(Teach::default())
        .invoke_handler(handlers())
        .setup(move |app| {
            let handle = app.handle().clone();
            app.manage(Agents(agent::Runtime::new(app.path().app_data_dir()?.join("conversations"))));

            // minus:// links (sign-in coming back, a pairing code) reach the page, on every platform
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let h2 = handle.clone();
                app.deep_link().on_open_url(move |e| {
                    for url in e.urls() {
                        let _ = h2.emit("deep-link", url.to_string());
                    }
                    #[cfg(desktop)]
                    show_main(h2.clone());
                });
                // a link that started the app
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let h3 = handle.clone();
                    let urls: Vec<String> = urls.iter().map(|u| u.to_string()).collect();
                    // give the page a moment to start listening
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(1500));
                        for u in urls {
                            let _ = h3.emit("deep-link", u);
                        }
                    });
                }
            }

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

                tray(&handle)?;
                make_dock(&handle)?;
                make_ghost(&handle)?;
            }

            #[cfg(desktop)]
            if !started_hidden {
                show_main(handle.clone());
            }
            let _ = &handle;
            Ok(())
        })
        .on_window_event(|w, e| {
            let _ = (&w, &e);
            #[cfg(desktop)]
            // closing the app window keeps Minus running (agents keep working, the dock stays)
            if let WindowEvent::CloseRequested { api, .. } = e {
                if w.label() == "main" {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| report(&format!("Minus couldn't start.\n\n{e}")));
}
