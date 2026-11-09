//! Windows: UI Automation.
//!
//! Speed: the whole window is read with one cache request (TreeScope_Subtree + the
//! properties and patterns we need), which is a single round trip to the app instead of
//! thousands of small ones.
//! Politeness: actions use the element's own patterns first (Invoke, Value, Toggle,
//! ExpandCollapse, SelectionItem, Scroll), so most clicks and typing don't touch the mouse
//! or keyboard at all. Real input is the fallback, and the cursor is put back afterwards.

use crate::outline::finalize;
use crate::platform::Backend;
use crate::{encode_scaled, parse_keys, sleep_ms, ActResult, Action, Element, HandsError, IdMap, MouseButton, Rect, Result, Shot, Snapshot, SnapshotOptions, Target, WindowInfo};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use windows::core::{Interface, BSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, SRCCOPY,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::Accessibility::*;
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;

pub(crate) struct Uia {
    uia: IUIAutomation,
    cache: IUIAutomationCacheRequest,
    /// Elements of the last snapshot, by their (stable) id.
    last: HashMap<u32, IUIAutomationElement>,
    ids: IdMap,
}

/// UI Automation client objects are free-threaded in the MTA; this lets us hand one to a
/// helper thread for Invoke calls that can block while an app shows a modal dialog.
struct Agile<T>(T);
unsafe impl<T> Send for Agile<T> {}

fn os(e: windows::core::Error) -> HandsError {
    HandsError::Os(e.message().to_string())
}

impl Uia {
    pub fn new() -> Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(os)?;
            // physical pixels everywhere, so element bounds match where the mouse goes
            let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let uia: IUIAutomation = match CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER) {
                Ok(u) => u,
                Err(_) => CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(os)?,
            };
            // don't hang forever on an app that stopped responding
            if let Ok(u2) = uia.cast::<IUIAutomation2>() {
                let _ = u2.SetConnectionTimeout(2000);
                let _ = u2.SetTransactionTimeout(4000);
            }
            let cache = uia.CreateCacheRequest().map_err(os)?;
            for p in [
                UIA_NamePropertyId,
                UIA_ControlTypePropertyId,
                UIA_LocalizedControlTypePropertyId,
                UIA_BoundingRectanglePropertyId,
                UIA_IsEnabledPropertyId,
                UIA_HasKeyboardFocusPropertyId,
                UIA_IsOffscreenPropertyId,
                UIA_ValueValuePropertyId,
                UIA_ValueIsReadOnlyPropertyId,
                UIA_ToggleToggleStatePropertyId,
                UIA_ExpandCollapseExpandCollapseStatePropertyId,
                UIA_SelectionItemIsSelectedPropertyId,
                UIA_ScrollVerticallyScrollablePropertyId,
                UIA_ScrollHorizontallyScrollablePropertyId,
            ] {
                cache.AddProperty(p).map_err(os)?;
            }
            for p in [UIA_InvokePatternId, UIA_ValuePatternId, UIA_TogglePatternId, UIA_ExpandCollapsePatternId, UIA_SelectionItemPatternId, UIA_ScrollPatternId] {
                cache.AddPattern(p).map_err(os)?;
            }
            cache.SetTreeScope(TreeScope_Subtree).map_err(os)?;
            cache.SetTreeFilter(&uia.ControlViewCondition().map_err(os)?).map_err(os)?;
            Ok(Self { uia, cache, last: HashMap::new(), ids: IdMap::default() })
        }
    }

    fn el(&self, id: u32) -> Result<IUIAutomationElement> {
        self.last.get(&id).cloned().ok_or(HandsError::NoElement(id))
    }

    fn hwnd_for(&mut self, target: &Target) -> Result<HWND> {
        match target {
            Target::Focused => {
                let h = unsafe { GetForegroundWindow() };
                // if Minus itself is in front (you just sent the job), use the window behind it
                if !h.0.is_null() && !is_own(h) {
                    return Ok(h);
                }
                list_windows().into_iter().next().map(|w| HWND(w.handle as usize as *mut _)).ok_or_else(|| HandsError::NoWindow("the focused window".into()))
            }
            Target::Handle(h) => Ok(HWND(*h as usize as *mut _)),
            Target::Title(t) => {
                let t = t.to_lowercase();
                list_windows().into_iter().find(|w| w.title.to_lowercase().contains(&t)).map(|w| HWND(w.handle as usize as *mut _)).ok_or_else(|| HandsError::NoWindow(format!("title \"{t}\"")))
            }
            Target::App(a) => {
                let a = a.to_lowercase();
                list_windows().into_iter().find(|w| w.app.to_lowercase() == a || w.app.to_lowercase().trim_end_matches(".exe") == a).map(|w| HWND(w.handle as usize as *mut _)).ok_or_else(|| HandsError::NoWindow(format!("app {a}")))
            }
        }
    }

    fn click_mouse(&self, e: &IUIAutomationElement, button: MouseButton, double: bool) -> Result<()> {
        unsafe {
            // bring it into view first if it can be scrolled to
            if let Ok(si) = e.GetCurrentPatternAs::<IUIAutomationScrollItemPattern>(UIA_ScrollItemPatternId) {
                let _ = si.ScrollIntoView();
            }
            let r = e.CurrentBoundingRectangle().map_err(os)?;
            let rect = to_rect(r);
            if rect.is_empty() {
                return Err(HandsError::Os("element has no position on screen".into()));
            }
            let (x, y) = rect.center();
            click_at(x, y, button, double)
        }
    }
}

impl Backend for Uia {
    fn windows(&mut self) -> Result<Vec<WindowInfo>> {
        Ok(list_windows())
    }

    fn snapshot(&mut self, target: Target, opts: SnapshotOptions) -> Result<Snapshot> {
        let t0 = Instant::now();
        let hwnd = self.hwnd_for(&target)?;
        let window = window_info(hwnd).ok_or_else(|| HandsError::NoWindow(format!("{target:?}")))?;
        let root = unsafe { self.uia.ElementFromHandle(hwnd).map_err(os)? };
        let root = unsafe { root.BuildUpdatedCache(&self.cache).map_err(os)? };
        let mut elements = Vec::new();
        let mut refs = Vec::new();
        let mut truncated = false;
        walk(&root, 0, &opts, &mut elements, &mut refs, &mut truncated);
        finalize(&mut elements);
        let ids = self.ids.stabilize(window.handle, &mut elements);
        self.last = ids.into_iter().zip(refs).collect();
        Ok(Snapshot { window, elements, took_ms: t0.elapsed().as_millis() as u64, truncated })
    }

    fn act(&mut self, actions: Vec<Action>, keep_going: bool) -> Result<Vec<ActResult>> {
        let mut out = Vec::new();
        for a in actions {
            let info = if matches!(a, Action::CursorPos) {
                unsafe {
                    let mut p = POINT::default();
                    let _ = GetCursorPos(&mut p);
                    Some(format!("X={}, Y={}", p.x, p.y))
                }
            } else {
                None
            };
            let r = self.one(a);
            let failed = r.is_err();
            out.push(match r {
                Ok(how) => ActResult { ok: true, how: how.into(), error: None, info },
                Err(e) => ActResult { ok: false, how: String::new(), error: Some(e.to_string()), info: None },
            });
            if failed && !keep_going {
                break;
            }
        }
        Ok(out)
    }

    fn screenshot(&mut self, max_edge: u32) -> Result<Shot> {
        screenshot_scaled(max_edge)
    }
}

impl Uia {
    fn one(&mut self, a: Action) -> Result<&'static str> {
        unsafe {
            match a {
                Action::Click { id, button, double } => {
                    let e = self.el(id)?;
                    if button == MouseButton::Left && !double {
                        if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
                            // Invoke can block while the app shows a modal dialog; don't wait for that
                            let p = Agile(p);
                            let (tx, rx) = std::sync::mpsc::channel();
                            std::thread::spawn(move || {
                                let p = p;
                                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                                let _ = tx.send(p.0.Invoke().is_ok());
                            });
                            match rx.recv_timeout(Duration::from_millis(1500)) {
                                Ok(true) | Err(_) => return Ok("invoke"),
                                Ok(false) => {}
                            }
                        }
                        if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId) {
                            if p.Select().is_ok() {
                                return Ok("select");
                            }
                        }
                        if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId) {
                            if p.Toggle().is_ok() {
                                return Ok("toggle");
                            }
                        }
                        if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId) {
                            let st = p.CurrentExpandCollapseState().unwrap_or(ExpandCollapseState_LeafNode);
                            let r = if st == ExpandCollapseState_Expanded { p.Collapse() } else { p.Expand() };
                            if r.is_ok() {
                                return Ok("expand");
                            }
                        }
                    }
                    self.click_mouse(&e, button, double)?;
                    Ok("mouse")
                }
                Action::Fill { id, text } => {
                    let e = self.el(id)?;
                    if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) {
                        let ro = p.CurrentIsReadOnly().map(|b| b.as_bool()).unwrap_or(true);
                        if !ro && p.SetValue(&BSTR::from(text.as_str())).is_ok() {
                            return Ok("value");
                        }
                    }
                    if e.SetFocus().is_err() {
                        self.click_mouse(&e, MouseButton::Left, false)?;
                    }
                    sleep_ms(40);
                    press_chord(&["ctrl".into(), "a".into()])?;
                    type_text(&text)?;
                    Ok("keyboard")
                }
                Action::Type { text } => {
                    type_text(&text)?;
                    Ok("keyboard")
                }
                Action::Key { keys, repeat } => {
                    for _ in 0..repeat.clamp(1, 100) {
                        for chord in parse_keys(&keys) {
                            press_chord(&chord)?;
                            sleep_ms(20);
                        }
                    }
                    Ok("keyboard")
                }
                Action::HoldKey { keys, secs } => {
                    let codes = codes(&parse_keys(&keys).concat())?;
                    send(&codes.iter().map(|c| key_input(*c, false)).collect::<Vec<_>>())?;
                    sleep_ms((secs.clamp(0.0, 300.0) * 1000.0) as u64);
                    send(&codes.iter().rev().map(|c| key_input(*c, true)).collect::<Vec<_>>())?;
                    Ok("keyboard")
                }
                Action::Focus { id } => {
                    self.el(id)?.SetFocus().map_err(os)?;
                    Ok("focus")
                }
                Action::Toggle { id } => {
                    let e = self.el(id)?;
                    match e.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId) {
                        Ok(p) => { p.Toggle().map_err(os)?; Ok("toggle") }
                        Err(_) => { self.click_mouse(&e, MouseButton::Left, false)?; Ok("mouse") }
                    }
                }
                Action::Expand { id } | Action::Collapse { id } => {
                    let expand = matches!(a, Action::Expand { .. });
                    let e = self.el(id)?;
                    match e.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId) {
                        Ok(p) => { if expand { p.Expand() } else { p.Collapse() }.map_err(os)?; Ok("expand") }
                        Err(_) => { self.click_mouse(&e, MouseButton::Left, false)?; Ok("mouse") }
                    }
                }
                Action::Select { id } => {
                    let e = self.el(id)?;
                    match e.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId) {
                        Ok(p) => { p.Select().map_err(os)?; Ok("select") }
                        Err(_) => { self.click_mouse(&e, MouseButton::Left, false)?; Ok("mouse") }
                    }
                }
                Action::Scroll { id, dx, dy } => {
                    if let Some(id) = id {
                        let e = self.el(id)?;
                        if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId) {
                            let amt = |v: f32| if v > 0.5 { ScrollAmount_LargeIncrement } else if v > 0.0 { ScrollAmount_SmallIncrement } else if v < -0.5 { ScrollAmount_LargeDecrement } else if v < 0.0 { ScrollAmount_SmallDecrement } else { ScrollAmount_NoAmount };
                            let pages = dy.abs().max(dx.abs()).ceil().max(1.0) as u32;
                            for _ in 0..pages {
                                p.Scroll(amt(dx), amt(dy)).map_err(os)?;
                            }
                            return Ok("scroll");
                        }
                        let r = to_rect(e.CurrentBoundingRectangle().map_err(os)?);
                        let (x, y) = r.center();
                        let _ = SetCursorPos(x, y);
                    }
                    wheel(dy, false)?;
                    if dx != 0.0 {
                        wheel(dx, true)?;
                    }
                    Ok("wheel")
                }
                Action::ClickAt { x, y, button, count, mods } => {
                    with_mods(&mods, || click_n(x, y, button, count.clamp(1, 3), false))?;
                    Ok("mouse")
                }
                Action::MoveTo { x, y } => {
                    SetCursorPos(x, y).map_err(os)?;
                    Ok("mouse")
                }
                Action::Drag { from, to, mods } => {
                    with_mods(&mods, || {
                        SetCursorPos(from[0], from[1]).map_err(os)?;
                        send(&[mouse_input(MOUSEEVENTF_LEFTDOWN, 0)])?;
                        // move in steps so apps see a real drag
                        for i in 1..=12 {
                            let t = i as f64 / 12.0;
                            let _ = SetCursorPos(from[0] + ((to[0] - from[0]) as f64 * t) as i32, from[1] + ((to[1] - from[1]) as f64 * t) as i32);
                            sleep_ms(12);
                        }
                        send(&[mouse_input(MOUSEEVENTF_LEFTUP, 0)])
                    })?;
                    Ok("mouse")
                }
                Action::MouseDown => { send(&[mouse_input(MOUSEEVENTF_LEFTDOWN, 0)])?; Ok("mouse") }
                Action::MouseUp => { send(&[mouse_input(MOUSEEVENTF_LEFTUP, 0)])?; Ok("mouse") }
                Action::ScrollAt { at, direction, amount, mods } => {
                    if let Some([x, y]) = at {
                        SetCursorPos(x, y).map_err(os)?;
                    }
                    let n = amount.clamp(1, 50) as i32;
                    let (flag, delta) = match direction.as_str() {
                        "up" => (MOUSEEVENTF_WHEEL, n * WHEEL_DELTA as i32),
                        "down" => (MOUSEEVENTF_WHEEL, -n * WHEEL_DELTA as i32),
                        "left" => (MOUSEEVENTF_HWHEEL, -n * WHEEL_DELTA as i32),
                        _ => (MOUSEEVENTF_HWHEEL, n * WHEEL_DELTA as i32),
                    };
                    with_mods(&mods, || send(&[mouse_input(flag, delta)]))?;
                    Ok("wheel")
                }
                Action::CursorPos => Ok("cursor"),
                Action::Launch { target } => {
                    use std::os::windows::process::CommandExt;
                    std::process::Command::new("cmd").args(["/C", "start", "", &target]).creation_flags(0x0800_0000).spawn().map_err(|e| HandsError::Os(e.to_string()))?;
                    Ok("launch")
                }
                Action::Activate { target } => {
                    let h = self.hwnd_for(&target)?;
                    if IsIconic(h).as_bool() {
                        let _ = ShowWindow(h, SW_RESTORE);
                    }
                    // Windows only lets the foreground app hand over focus; a lone Alt tap unlocks it
                    send(&[key_input(VK_MENU.0, false), key_input(VK_MENU.0, true)])?;
                    let _ = SetForegroundWindow(h);
                    Ok("activate")
                }
                Action::Wait { ms } => {
                    sleep_ms(ms.min(30_000));
                    Ok("wait")
                }
            }
        }
    }
}

/* ───────── reading the tree ───────── */

fn walk(e: &IUIAutomationElement, depth: u16, opts: &SnapshotOptions, out: &mut Vec<Element>, refs: &mut Vec<IUIAutomationElement>, truncated: &mut bool) {
    let children = unsafe { e.GetCachedChildren() };
    let Ok(children) = children else { return };
    let n = unsafe { children.Length() }.unwrap_or(0);
    for i in 0..n {
        if out.len() >= opts.max_elements {
            *truncated = true;
            return;
        }
        let Ok(c) = (unsafe { children.GetElement(i) }) else { continue };
        let role = role_of(unsafe { c.CachedControlType() }.map(|t| t.0).unwrap_or(0));
        // noise the agent never needs: window chrome and scroll bar parts
        if matches!(role, "titlebar" | "thumb" | "separator" | "scrollbar") {
            continue;
        }
        let offscreen = unsafe { c.CachedIsOffscreen() }.map(|b| b.as_bool()).unwrap_or(false);
        if offscreen && opts.prune {
            continue;
        }
        let el = read(&c, role, depth, (out.len() + 1) as u32);
        refs.push(c.clone());
        let me = out.len();
        out.push(el);
        if depth + 1 < opts.max_depth {
            let before = out.len();
            walk(&c, depth + 1, opts, out, refs, truncated);
            let kids: Vec<u32> = out[before..].iter().filter(|x| x.depth == depth + 1).map(|x| x.id).collect();
            out[me].children = kids;
        }
    }
}

fn read(c: &IUIAutomationElement, role: &'static str, depth: u16, id: u32) -> Element {
    unsafe {
        let name = c.CachedName().map(|b| b.to_string()).unwrap_or_default();
        let bounds = c.CachedBoundingRectangle().map(to_rect).unwrap_or_default();
        let enabled = c.CachedIsEnabled().map(|b| b.as_bool()).unwrap_or(true);
        let focused = c.CachedHasKeyboardFocus().map(|b| b.as_bool()).unwrap_or(false);
        let mut can = Vec::new();
        let mut value = None;
        let mut checked = None;
        let mut expanded = None;
        let mut selected = None;
        if c.GetCachedPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId).is_ok() {
            can.push("invoke".to_string());
        }
        if let Ok(p) = c.GetCachedPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) {
            value = p.CachedValue().ok().map(|b| b.to_string());
            if !p.CachedIsReadOnly().map(|b| b.as_bool()).unwrap_or(true) {
                can.push("set_value".to_string());
            }
        }
        if let Ok(p) = c.GetCachedPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId) {
            can.push("toggle".to_string());
            checked = p.CachedToggleState().ok().map(|s| s == ToggleState_On);
        }
        if let Ok(p) = c.GetCachedPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId) {
            match p.CachedExpandCollapseState() {
                Ok(s) if s == ExpandCollapseState_Expanded || s == ExpandCollapseState_PartiallyExpanded => { can.push("expand".into()); expanded = Some(true); }
                Ok(s) if s == ExpandCollapseState_Collapsed => { can.push("expand".into()); expanded = Some(false); }
                _ => {}
            }
        }
        if let Ok(p) = c.GetCachedPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId) {
            can.push("select".to_string());
            selected = p.CachedIsSelected().ok().map(|b| b.as_bool());
        }
        if let Ok(p) = c.GetCachedPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId) {
            let v = p.CachedVerticallyScrollable().map(|b| b.as_bool()).unwrap_or(false);
            let h = p.CachedHorizontallyScrollable().map(|b| b.as_bool()).unwrap_or(false);
            if v || h {
                can.push("scroll".to_string());
            }
        }
        Element { id, role: role.to_string(), name, value, bounds, enabled, focused, checked, expanded, selected, can, key: String::new(), depth, children: Vec::new() }
    }
}

fn role_of(t: i32) -> &'static str {
    match t {
        50000 => "button", 50001 => "calendar", 50002 => "checkbox", 50003 => "combobox", 50004 => "edit",
        50005 => "link", 50006 => "image", 50007 => "listitem", 50008 => "list", 50009 => "menu",
        50010 => "menubar", 50011 => "menuitem", 50012 => "progressbar", 50013 => "radio", 50014 => "scrollbar",
        50015 => "slider", 50016 => "spinner", 50017 => "statusbar", 50018 => "tablist", 50019 => "tab",
        50020 => "text", 50021 => "toolbar", 50022 => "tooltip", 50023 => "tree", 50024 => "treeitem",
        50025 => "custom", 50026 => "group", 50027 => "thumb", 50028 => "grid", 50029 => "row",
        50030 => "document", 50031 => "splitbutton", 50032 => "window", 50033 => "pane", 50034 => "header",
        50035 => "columnheader", 50036 => "table", 50037 => "titlebar", 50038 => "separator", 50039 => "zoom",
        50040 => "appbar", _ => "unknown",
    }
}

fn to_rect(r: RECT) -> Rect {
    Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top }
}

/* ───────── windows on screen ───────── */

fn list_windows() -> Vec<WindowInfo> {
    let mut hwnds: Vec<HWND> = Vec::new();
    unsafe extern "system" fn each(h: HWND, l: LPARAM) -> windows::core::BOOL {
        let v = unsafe { &mut *(l.0 as *mut Vec<HWND>) };
        v.push(h);
        true.into()
    }
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut hwnds as *mut _ as isize));
    }
    hwnds.into_iter().filter_map(window_info).collect()
}

/// Windows of this process (Minus's own window, dock and ghost cursor) are never targets.
fn is_own(h: HWND) -> bool {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
    pid == std::process::id()
}

fn window_info(h: HWND) -> Option<WindowInfo> {
    unsafe {
        if !IsWindowVisible(h).as_bool() || is_own(h) {
            return None;
        }
        let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 {
            return None;
        }
        let mut cloaked: u32 = 0;
        let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4);
        if cloaked != 0 {
            return None;
        }
        let len = GetWindowTextLengthW(h);
        if len <= 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(h, &mut buf);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        let mut pid = 0u32;
        GetWindowThreadProcessId(h, Some(&mut pid));
        let mut r = RECT::default();
        let _ = GetWindowRect(h, &mut r);
        Some(WindowInfo {
            handle: h.0 as usize as u64,
            title,
            app: exe_name(pid),
            pid,
            bounds: to_rect(r),
            focused: GetForegroundWindow() == h,
            minimized: IsIconic(h).as_bool(),
        })
    }
}

fn exe_name(pid: u32) -> String {
    unsafe {
        let Ok(p) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(p, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(p);
        if !ok {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit(['\\', '/']).next().unwrap_or("").to_string()
    }
}

/* ───────── real input (the fallback) ───────── */

fn send(inputs: &[INPUT]) -> Result<()> {
    let n = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) };
    if n as usize != inputs.len() {
        return Err(HandsError::Os("Windows blocked the input (is a higher-privilege window in front?)".into()));
    }
    Ok(())
}

fn key_input(vk: u16, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, time: 0, dwExtraInfo: 0 } },
    }
}

fn unicode_input(unit: u16, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: unit, dwFlags: if up { KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } else { KEYEVENTF_UNICODE }, time: 0, dwExtraInfo: 0 } },
    }
}

fn mouse_input(flags: MOUSE_EVENT_FLAGS, data: i32) -> INPUT {
    INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: data as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }
}

fn type_text(text: &str) -> Result<()> {
    let mut batch = Vec::new();
    for ch in text.chars() {
        match ch {
            '\n' => { batch.push(key_input(VK_RETURN.0, false)); batch.push(key_input(VK_RETURN.0, true)); }
            '\t' => { batch.push(key_input(VK_TAB.0, false)); batch.push(key_input(VK_TAB.0, true)); }
            '\r' => {}
            _ => {
                let mut b = [0u16; 2];
                for u in ch.encode_utf16(&mut b) {
                    batch.push(unicode_input(*u, false));
                    batch.push(unicode_input(*u, true));
                }
            }
        }
        // small chunks so apps that read input slowly don't drop characters
        if batch.len() >= 64 {
            send(&batch)?;
            batch.clear();
            sleep_ms(4);
        }
    }
    if !batch.is_empty() {
        send(&batch)?;
    }
    Ok(())
}

fn vk(name: &str) -> Option<u16> {
    Some(match name {
        "ctrl" | "control" => VK_CONTROL.0, "shift" => VK_SHIFT.0, "alt" | "option" => VK_MENU.0, "win" | "meta" | "cmd" | "super" => VK_LWIN.0,
        "enter" | "return" => VK_RETURN.0, "tab" => VK_TAB.0, "esc" | "escape" => VK_ESCAPE.0, "space" => VK_SPACE.0,
        "backspace" => VK_BACK.0, "delete" | "del" => VK_DELETE.0, "insert" => VK_INSERT.0,
        "up" => VK_UP.0, "down" => VK_DOWN.0, "left" => VK_LEFT.0, "right" => VK_RIGHT.0,
        "home" => VK_HOME.0, "end" => VK_END.0, "pageup" => VK_PRIOR.0, "pagedown" => VK_NEXT.0,
        "printscreen" => VK_SNAPSHOT.0, "menu" | "apps" => VK_APPS.0,
        f if f.len() >= 2 && f.starts_with('f') && f[1..].parse::<u16>().is_ok_and(|n| (1..=24).contains(&n)) => VK_F1.0 + f[1..].parse::<u16>().unwrap() - 1,
        c if c.len() == 1 => {
            let b = c.as_bytes()[0];
            match b {
                b'a'..=b'z' => (b - 32) as u16,
                b'0'..=b'9' => b as u16,
                b'-' => VK_OEM_MINUS.0, b'=' | b'+' => VK_OEM_PLUS.0, b',' => VK_OEM_COMMA.0, b'.' => VK_OEM_PERIOD.0,
                b'/' => VK_OEM_2.0, b';' => VK_OEM_1.0, b'[' => VK_OEM_4.0, b']' => VK_OEM_6.0, b'\\' => VK_OEM_5.0, b'\'' => VK_OEM_7.0, b'`' => VK_OEM_3.0,
                _ => return None,
            }
        }
        _ => return None,
    })
}

fn codes(keys: &[String]) -> Result<Vec<u16>> {
    keys.iter().map(|k| vk(k).ok_or_else(|| HandsError::Os(format!("unknown key \"{k}\"")))).collect()
}

/// Runs `f` with modifier keys ("ctrl", "ctrl+shift", "") held down.
fn with_mods(mods: &str, f: impl FnOnce() -> Result<()>) -> Result<()> {
    let keys: Vec<String> = mods.split('+').map(|k| k.trim().to_lowercase()).filter(|k| !k.is_empty()).collect();
    let c = codes(&keys)?;
    if !c.is_empty() {
        send(&c.iter().map(|k| key_input(*k, false)).collect::<Vec<_>>())?;
    }
    let r = f();
    if !c.is_empty() {
        let _ = send(&c.iter().rev().map(|k| key_input(*k, true)).collect::<Vec<_>>());
    }
    r
}

fn click_n(x: i32, y: i32, button: MouseButton, count: u8, restore: bool) -> Result<()> {
    unsafe {
        let mut back = POINT::default();
        let _ = GetCursorPos(&mut back);
        SetCursorPos(x, y).map_err(os)?;
        let (d, u) = match button {
            MouseButton::Left => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
            MouseButton::Right => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
            MouseButton::Middle => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
        };
        let mut v = Vec::new();
        for _ in 0..count {
            v.push(mouse_input(d, 0));
            v.push(mouse_input(u, 0));
        }
        send(&v)?;
        if restore {
            sleep_ms(30);
            let _ = SetCursorPos(back.x, back.y);
        }
        Ok(())
    }
}

fn press_chord(chord: &[String]) -> Result<()> {
    let codes = codes(chord)?;
    let mut v: Vec<INPUT> = codes.iter().map(|c| key_input(*c, false)).collect();
    v.extend(codes.iter().rev().map(|c| key_input(*c, true)));
    send(&v)
}

/// Element clicks put the pointer back where the person left it.
fn click_at(x: i32, y: i32, button: MouseButton, double: bool) -> Result<()> {
    click_n(x, y, button, if double { 2 } else { 1 }, true)
}

fn wheel(pages: f32, horizontal: bool) -> Result<()> {
    if pages == 0.0 {
        return Ok(());
    }
    // one "page" ~ five notches; positive = down/right
    let notches = (pages * 5.0).round() as i32;
    let delta = if horizontal { notches * WHEEL_DELTA as i32 } else { -notches * WHEEL_DELTA as i32 };
    send(&[mouse_input(if horizontal { MOUSEEVENTF_HWHEEL } else { MOUSEEVENTF_WHEEL }, delta)])
}

/* ───────── screenshot ───────── */

fn screenshot_scaled(max_edge: u32) -> Result<Shot> {
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp.into());
        let ok = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT).is_ok();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() },
            ..Default::default()
        };
        let mut px = vec![0u8; (w * h * 4) as usize];
        let lines = GetDIBits(mem, bmp, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        if !ok || lines == 0 {
            return Err(HandsError::Os("couldn't capture the screen".into()));
        }
        for p in px.chunks_exact_mut(4) {
            p.swap(0, 2); // BGRA -> RGBA
            p[3] = 255;
        }
        let (png, width, height, scale) = encode_scaled(&px, w as u32, h as u32, max_edge)?;
        Ok(Shot { png, width, height, scale, origin_x: x, origin_y: y })
    }
}

/* ───────── "Show me once": watching what you do ───────── */
pub(crate) mod rec {
    //! Two threads: one holds low-level mouse and keyboard hooks (they need a message loop and
    //! must return at once), the other asks UI Automation what each click landed on and
    //! watches the focused field's value. Input that agents generate (injected) is skipped.
    use super::{exe_name, role_of, to_rect};
    use crate::teach::{ElementRef, TaughtStep};
    use crate::{HandsError, MouseButton, Result};
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Accessibility::*;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows::Win32::UI::WindowsAndMessaging::*;

    enum Raw {
        Down { x: i32, y: i32, button: MouseButton },
        Key { vk: u32, ctrl: bool, alt: bool, shift: bool, win: bool },
    }
    static RAW: OnceLock<Mutex<Option<Sender<Raw>>>> = OnceLock::new();
    fn send(r: Raw) {
        if let Some(tx) = RAW.get().and_then(|m| m.lock().ok()).and_then(|g| g.clone()) {
            let _ = tx.send(r);
        }
    }
    const INJECTED_MOUSE: u32 = 0x1;
    const INJECTED_KEY: u32 = 0x10;

    unsafe extern "system" fn mouse_proc(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if code >= 0 {
            let m = unsafe { &*(l.0 as *const MSLLHOOKSTRUCT) };
            if m.flags & INJECTED_MOUSE == 0 {
                let b = match w.0 as u32 {
                    WM_LBUTTONDOWN => Some(MouseButton::Left),
                    WM_RBUTTONDOWN => Some(MouseButton::Right),
                    _ => None,
                };
                if let Some(button) = b {
                    send(Raw::Down { x: m.pt.x, y: m.pt.y, button });
                }
            }
        }
        unsafe { CallNextHookEx(None, code, w, l) }
    }
    unsafe extern "system" fn key_proc(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if code >= 0 && (w.0 as u32 == WM_KEYDOWN || w.0 as u32 == WM_SYSKEYDOWN) {
            let k = unsafe { &*(l.0 as *const KBDLLHOOKSTRUCT) };
            if k.flags.0 & INJECTED_KEY == 0 {
                let down = |vk: i32| unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000 != 0;
                send(Raw::Key { vk: k.vkCode, ctrl: down(0x11), alt: down(0x12), shift: down(0x10), win: down(0x5B) || down(0x5C) });
            }
        }
        unsafe { CallNextHookEx(None, code, w, l) }
    }

    fn keyname(vk: u32) -> Option<String> {
        Some(match vk {
            0x0D => "enter".into(), 0x09 => "tab".into(), 0x1B => "esc".into(), 0x2E => "delete".into(),
            0x21 => "pageup".into(), 0x22 => "pagedown".into(), 0x23 => "end".into(), 0x24 => "home".into(),
            0x25 => "left".into(), 0x26 => "up".into(), 0x27 => "right".into(), 0x28 => "down".into(), 0x20 => "space".into(),
            0x70..=0x87 => format!("f{}", vk - 0x6F),
            0x30..=0x39 | 0x41..=0x5A => ((vk as u8) as char).to_ascii_lowercase().to_string(),
            _ => return None,
        })
    }

    pub(crate) struct Recording {
        steps: Arc<Mutex<Vec<TaughtStep>>>,
        hook_thread: u32,
        stop: Arc<std::sync::atomic::AtomicBool>,
        worker: Option<std::thread::JoinHandle<()>>,
    }

    impl Recording {
        pub fn start() -> Result<Self> {
            let (tx, rx) = channel::<Raw>();
            *RAW.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(tx);
            let steps = Arc::new(Mutex::new(Vec::new()));
            let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
            // hooks
            let (tid_tx, tid_rx) = channel();
            std::thread::spawn(move || unsafe {
                let _ = tid_tx.send(GetCurrentThreadId());
                let mh = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0);
                let kh = SetWindowsHookExW(WH_KEYBOARD_LL, Some(key_proc), None, 0);
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                if let Ok(h) = mh { let _ = UnhookWindowsHookEx(h); }
                if let Ok(h) = kh { let _ = UnhookWindowsHookEx(h); }
            });
            let hook_thread = tid_rx.recv().map_err(|_| HandsError::Os("couldn't start watching".into()))?;
            // meaning
            let (s2, st2) = (steps.clone(), stop.clone());
            let worker = std::thread::spawn(move || unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let Ok(uia) = CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER) else { return };
                let Ok(walker) = uia.ControlViewWalker() else { return };
                let mut focus: Option<(IUIAutomationElement, Option<String>, ElementRef, bool)> = None;
                let mut last_click: Option<(Instant, ElementRef)> = None;
                let flush = |focus: &mut Option<(IUIAutomationElement, Option<String>, ElementRef, bool)>, steps: &Mutex<Vec<TaughtStep>>| {
                    if let Some((e, before, r, secret)) = focus.as_mut() {
                        let now = value_of(e);
                        if now.is_some() && now != *before {
                            // passwords are never written down: the skill asks for them each run
                            let value = if *secret { "{{password}}".to_string() } else { now.clone().unwrap_or_default() };
                            let mut s = steps.lock().unwrap();
                            // typing more into the same field replaces the last value
                            if let Some(TaughtStep::Fill { target, value: v }) = s.last_mut() {
                                if target == r { *v = value; *before = now; return; }
                            }
                            s.push(TaughtStep::Fill { target: r.clone(), value });
                            *before = now;
                        }
                    }
                };
                while !st2.load(std::sync::atomic::Ordering::SeqCst) {
                    match rx.recv_timeout(Duration::from_millis(150)) {
                        Ok(Raw::Down { x, y, button }) => {
                            flush(&mut focus, &s2);
                            if let Ok(e) = uia.ElementFromPoint(POINT { x, y }) {
                                if let Some(r) = describe(&walker, &e) {
                                    let mut s = s2.lock().unwrap();
                                    let again = last_click.as_ref().is_some_and(|(t, lr)| t.elapsed() < Duration::from_millis(450) && *lr == r);
                                    if again {
                                        if let Some(TaughtStep::Click { double, .. }) = s.last_mut() { *double = true; }
                                    } else {
                                        s.push(TaughtStep::Click { target: r.clone(), button, double: false });
                                    }
                                    last_click = Some((Instant::now(), r));
                                }
                            }
                        }
                        Ok(Raw::Key { vk, ctrl, alt, shift, win }) => {
                            let special = matches!(vk, 0x0D | 0x09 | 0x1B | 0x2E | 0x21..=0x28 | 0x70..=0x87);
                            if (ctrl || alt || win || special) && !matches!(vk, 0x10..=0x12 | 0x5B | 0x5C | 0xA0..=0xA5) {
                                if let Some(k) = keyname(vk) {
                                    flush(&mut focus, &s2);
                                    let mut keys = String::new();
                                    if ctrl { keys.push_str("ctrl+"); }
                                    if alt { keys.push_str("alt+"); }
                                    if shift && (ctrl || alt || win) { keys.push_str("shift+"); }
                                    if win { keys.push_str("win+"); }
                                    keys.push_str(&k);
                                    let (app, window) = focus.as_ref().map(|f| (f.2.app.clone(), f.2.window.clone())).unwrap_or_default();
                                    s2.lock().unwrap().push(TaughtStep::Key { keys, app, window });
                                }
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                    // follow the keyboard focus, and note what each field ends up holding
                    if let Ok(f) = uia.GetFocusedElement() {
                        let same = focus.as_ref().is_some_and(|(e, ..)| uia.CompareElements(e, &f).map(|b| b.as_bool()).unwrap_or(false));
                        if !same {
                            flush(&mut focus, &s2);
                            focus = describe(&walker, &f).map(|r| {
                                let secret = f.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(false);
                                (f.clone(), value_of(&f), r, secret)
                            });
                        }
                    }
                }
                flush(&mut focus, &s2);
            });
            Ok(Self { steps, hook_thread, stop, worker: Some(worker) })
        }
        pub fn steps(&self) -> Vec<TaughtStep> {
            self.steps.lock().unwrap().clone()
        }
        pub fn stop(mut self) -> Vec<TaughtStep> {
            unsafe {
                let _ = PostThreadMessageW(self.hook_thread, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
            *RAW.get_or_init(|| Mutex::new(None)).lock().unwrap() = None;
            if let Some(w) = self.worker.take() {
                let _ = w.join();
            }
            self.steps()
        }
    }

    fn value_of(e: &IUIAutomationElement) -> Option<String> {
        unsafe { e.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId).ok().and_then(|p| p.CurrentValue().ok()).map(|b| b.to_string()) }
    }

    /// What an element is, where it lives, and how to find it again.
    fn describe(walker: &IUIAutomationTreeWalker, e: &IUIAutomationElement) -> Option<ElementRef> {
        unsafe {
            let pid = e.CurrentProcessId().ok()? as u32;
            if pid == std::process::id() {
                return None; // Minus itself (the dock's Done button, for one)
            }
            let role = role_of(e.CurrentControlType().map(|t| t.0).unwrap_or(0)).to_string();
            let name = e.CurrentName().map(|b| b.to_string()).unwrap_or_default();
            let bounds = to_rect(e.CurrentBoundingRectangle().ok()?);
            // walk up to the top-level window, collecting named ancestors
            let mut path = Vec::new();
            let mut window = String::new();
            let mut wbounds = bounds;
            let mut cur = walker.GetParentElement(e).ok();
            let mut guard = 0;
            while let Some(p) = cur {
                guard += 1;
                if guard > 40 { break; }
                let next = walker.GetParentElement(&p).ok();
                let is_top = next.as_ref().map(|n| n.CurrentControlType().map(|t| t.0).unwrap_or(0) == 0 || n.CurrentProcessId().map(|x| x as u32 != pid).unwrap_or(true)).unwrap_or(true);
                let r = role_of(p.CurrentControlType().map(|t| t.0).unwrap_or(0));
                let n = p.CurrentName().map(|b| b.to_string()).unwrap_or_default();
                if is_top {
                    window = n;
                    wbounds = p.CurrentBoundingRectangle().map(to_rect).unwrap_or(bounds);
                    break;
                }
                if !n.trim().is_empty() && path.len() < 6 {
                    path.push(format!("{}:{}", r, n.trim()));
                }
                cur = next;
            }
            path.reverse();
            Some(ElementRef { role, name, app: exe_name(pid), window, path, at: crate::Rect { x: bounds.x - wbounds.x, y: bounds.y - wbounds.y, w: bounds.w, h: bounds.h } })
        }
    }
}
