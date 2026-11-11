//! Drive the agents' browser by hand:  cargo run -p agent --example browse -- <url>
use agent::browser::{find, Browser};
#[tokio::main]
async fn main() {
    let url = std::env::args().nth(1).unwrap_or("https://example.com".into());
    let exe = find().expect("no Chromium-family browser found (set MINUS_BROWSER)");
    println!("browser: {}", exe.display());
    let profile = std::env::temp_dir().join("minus-browse-profile");
    let b = Browser::launch(&exe, &profile).await.unwrap();
    let t = b.tab("demo").await.unwrap();
    t.open(&url).await.unwrap();
    let (page, _, _) = t.look().await.unwrap();
    println!("{page}\n======");
    // the form: type a city, pick a month, search
    let ids = |s: &str, want: &str| s.lines().find(|l| l.contains(want)).and_then(|l| l[1..l.find(']')?].parse::<u64>().ok());
    if let (Some(q), Some(m), Some(go)) = (ids(&page, "Para onde"), ids(&page, "Mês"), ids(&page, "Buscar")) {
        t.type_into(q, "Lisboa", false).await.unwrap();
        t.select(m, "março").await.unwrap();
        t.click(go).await.unwrap();
        println!("clicked {}", t.name(go));
        let (page, _, _) = t.look().await.unwrap();
        println!("{}", page.lines().filter(|l| l.contains("Resultados")).collect::<Vec<_>>().join("\n"));
        let low = ids(&page, "Lá embaixo").unwrap();
        t.click(low).await.unwrap();
        let (page, _, _) = t.look().await.unwrap();
        println!("{}", page.lines().filter(|l| l.contains("Clicado")).collect::<Vec<_>>().join("\n"));
        let about = ids(&page, "Sobre nós").unwrap();
        t.click(about).await.unwrap();
        let (_, url, title) = t.look().await.unwrap();
        println!("after the link: {title} {url}");
        t.back().await.unwrap();
        let (_, url, _) = t.look().await.unwrap();
        println!("after back: {url}");
    }
    let (jpeg, url, title) = t.frame().await.unwrap();
    println!("frame: {} bytes of base64, {title} {url}", jpeg.len());
    std::fs::write(std::env::temp_dir().join("minus-frame.b64"), jpeg).unwrap();
}
