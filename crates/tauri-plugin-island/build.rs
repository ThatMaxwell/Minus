const COMMANDS: &[&str] = &["status", "ask", "show", "hide"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
