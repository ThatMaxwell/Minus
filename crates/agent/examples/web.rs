//! Try the free web search and page reading:  cargo run -p agent --example web -- "query" [url]
#[tokio::main]
async fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let http = agent::http_client();
    match agent::web::search(&http, &a[0]).await {
        Ok(h) => println!("{}", agent::web::render_hits(&a[0], &h)),
        Err(e) => println!("search failed: {e}"),
    }
    if let Some(u) = a.get(1) {
        match agent::web::read(&http, u).await {
            Ok(t) => println!("---\n{}", t.chars().take(900).collect::<String>()),
            Err(e) => println!("read failed: {e}"),
        }
    }
}
