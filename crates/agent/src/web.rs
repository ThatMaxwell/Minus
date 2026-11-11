//! The web without a browser and without keys: search (Bing's and DuckDuckGo's ordinary result
//! pages, free to use) and reading a page as plain text. Works everywhere, the phone included.

use base64::Engine;
use scraper::{ElementRef, Html, Node, Selector};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

fn sel(s: &str) -> Selector {
    Selector::parse(s).expect("selector")
}
fn text_of(e: ElementRef) -> String {
    e.text().collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Bing wraps result links (`/ck/a?...&u=a1<base64 of the address>`): the real address.
fn bing_url(href: &str) -> String {
    let h = href.replace("&amp;", "&");
    if let Some(u) = h.split(['?', '&']).find_map(|p| p.strip_prefix("u=a1")) {
        if let Ok(b) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(u.trim_end_matches('=')) {
            if let Ok(s) = String::from_utf8(b) {
                return s;
            }
        }
    }
    h
}
/// DuckDuckGo wraps them too (`//duckduckgo.com/l/?uddg=<the address, escaped>`).
fn ddg_url(href: &str) -> String {
    let h = href.replace("&amp;", "&");
    match h.split(['?', '&']).find_map(|p| p.strip_prefix("uddg=")) {
        Some(u) => percent_encoding::percent_decode_str(u).decode_utf8_lossy().into_owned(),
        None if h.starts_with("//") => format!("https:{h}"),
        None => h,
    }
}

pub fn parse_bing(html: &str) -> Vec<Hit> {
    let doc = Html::parse_document(html);
    let (item, link, snip) = (sel("li.b_algo"), sel("h2 a"), sel(".b_caption p, p"));
    doc.select(&item)
        .filter_map(|li| {
            let a = li.select(&link).next()?;
            let url = bing_url(a.value().attr("href")?);
            let title = text_of(a);
            let snippet = li.select(&snip).next().map(text_of).unwrap_or_default();
            (url.starts_with("http") && !title.is_empty()).then_some(Hit { title, url, snippet })
        })
        .collect()
}

pub fn parse_ddg(html: &str) -> Vec<Hit> {
    let doc = Html::parse_document(html);
    let (item, link, snip) = (sel(".result"), sel("a.result__a"), sel(".result__snippet"));
    doc.select(&item)
        .filter_map(|r| {
            let a = r.select(&link).next()?;
            let url = ddg_url(a.value().attr("href")?);
            let title = text_of(a);
            let snippet = r.select(&snip).next().map(text_of).unwrap_or_default();
            (url.starts_with("http") && !title.is_empty() && !url.contains("duckduckgo.com/y.js")).then_some(Hit { title, url, snippet })
        })
        .collect()
}

/// Searches the web. Bing first, DuckDuckGo if Bing comes back empty or fails.
pub async fn search(http: &reqwest::Client, query: &str) -> Result<Vec<Hit>, String> {
    let q: String = percent_encoding::utf8_percent_encode(query.trim(), percent_encoding::NON_ALPHANUMERIC).to_string();
    let get = |url: String| async move {
        let r = http.get(url).header("User-Agent", UA).header("Accept-Language", "en-US,en;q=0.9,pt-BR;q=0.8").timeout(std::time::Duration::from_secs(20)).send().await.map_err(|e| e.to_string())?;
        if !r.status().is_success() {
            return Err(format!("status {}", r.status().as_u16()));
        }
        r.text().await.map_err(|e| e.to_string())
    };
    let mut why = String::new();
    match get(format!("https://www.bing.com/search?q={q}&setlang=en")).await {
        Ok(h) => {
            let hits = parse_bing(&h);
            if !hits.is_empty() {
                return Ok(hits);
            }
        }
        Err(e) => why = e,
    }
    match get(format!("https://html.duckduckgo.com/html/?q={q}")).await {
        Ok(h) => Ok(parse_ddg(&h)),
        Err(e) => Err(format!("the search didn't go through ({}{e})", if why.is_empty() { String::new() } else { format!("{why}; ") })),
    }
}

pub fn render_hits(query: &str, hits: &[Hit]) -> String {
    if hits.is_empty() {
        return format!("No results for “{query}”. Try other words.");
    }
    let mut s = format!("Results for “{query}”:\n");
    for (i, h) in hits.iter().take(8).enumerate() {
        s.push_str(&format!("{}. {} — {}\n", i + 1, h.title, h.url));
        if !h.snippet.is_empty() {
            s.push_str(&format!("   {}\n", h.snippet.chars().take(240).collect::<String>()));
        }
    }
    s.push_str("\nRead a result with `read_page` before relying on it.");
    s
}

/// The readable text of a page: its title, then what it says (menus, scripts and the like left out).
pub fn page_text(html: &str, max: usize) -> (String, String) {
    let doc = Html::parse_document(html);
    let title = doc.select(&sel("title")).next().map(text_of).unwrap_or_default();
    // the main part of the page when it says which that is
    let root = doc.select(&sel("main, article, [role=main]")).next().or_else(|| doc.select(&sel("body")).next());
    let mut out = String::new();
    fn walk(e: ElementRef, out: &mut String, max: usize) {
        for child in e.children() {
            if out.len() >= max {
                return;
            }
            match child.value() {
                Node::Text(t) => {
                    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
                    if !t.is_empty() {
                        if !out.ends_with([' ', '\n', '(']) && !out.is_empty() && !t.starts_with(['.', ',', ';', ':', '!', '?', ')']) {
                            out.push(' ');
                        }
                        out.push_str(&t);
                    }
                }
                Node::Element(el) => {
                    let name = el.name();
                    if matches!(name, "script" | "style" | "noscript" | "svg" | "nav" | "footer" | "header" | "aside" | "form" | "iframe" | "template" | "button") {
                        continue;
                    }
                    let block = matches!(name, "p" | "div" | "section" | "li" | "tr" | "br" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "pre" | "blockquote" | "dd" | "dt" | "table" | "ul" | "ol");
                    if let Some(c) = ElementRef::wrap(child) {
                        if name.starts_with('h') && name.len() == 2 {
                            out.push_str("\n\n## ");
                        } else if name == "li" {
                            out.push_str(if out.ends_with('\n') { "- " } else { "\n- " });
                        } else if block && !out.ends_with('\n') {
                            out.push('\n');
                        }
                        walk(c, out, max);
                        if block && !out.ends_with('\n') {
                            out.push('\n');
                        }
                    }
                }
                _ => {}
            }
        }
    }
    if let Some(r) = root {
        walk(r, &mut out, max);
    }
    let mut text = String::new();
    let mut blank = 0;
    for l in out.lines().map(str::trim) {
        if l.is_empty() || l == "-" {
            blank += 1;
            // one blank line at most, and none inside a list
            if blank == 1 && !text.is_empty() && !text.trim_end().lines().last().is_some_and(|x| x.starts_with("- ")) {
                text.push('\n');
            }
        } else {
            blank = 0;
            text.push_str(l);
            text.push('\n');
        }
    }
    let text: String = text.chars().take(max).collect();
    (title, text.trim().to_string())
}

/// Reads a web page as text.
pub async fn read(http: &reqwest::Client, url: &str) -> Result<String, String> {
    let url = if url.starts_with("http") { url.to_string() } else { format!("https://{url}") };
    let r = http.get(&url).header("User-Agent", UA).header("Accept-Language", "en-US,en;q=0.9,pt-BR;q=0.8").timeout(std::time::Duration::from_secs(25)).send().await.map_err(|e| format!("couldn't open {url}: {e}"))?;
    let status = r.status().as_u16();
    let kind = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
    let at = r.url().to_string();
    if status >= 400 {
        return Err(format!("{at} answered with an error ({status})"));
    }
    if kind.contains("pdf") {
        return Ok(format!("{at} is a PDF, which can't be read as text here."));
    }
    let body = r.text().await.map_err(|e| e.to_string())?;
    if kind.contains("html") || body.trim_start().starts_with('<') {
        let (title, text) = page_text(&body, 12000);
        Ok(format!("{title}\n{at}\n\n{}", if text.is_empty() { "(The page shows nothing readable without a browser: it may need JavaScript. Open it in your browser instead.)".into() } else { text }))
    } else {
        Ok(format!("{at}\n\n{}", body.chars().take(12000).collect::<String>()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unwraps_result_links() {
        assert_eq!(bing_url("https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;u=a1aHR0cHM6Ly93d3cudHJpcC5jb20vZmxpZ2h0cy90by1saXNib24vYWlyZmFyZXMtTElTLw&amp;ntb=1"), "https://www.trip.com/flights/to-lisbon/airfares-LIS/");
        assert_eq!(ddg_url("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&rut=abc"), "https://example.com/a?b=1");
    }
    #[test]
    fn reads_results_pages() {
        let ddg = r#"<div class="result results_links"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.visitlisboa.com%2F&amp;rut=1">Visit <b>Lisboa</b></a></h2><a class="result__snippet" href="x">The official <b>tourism</b> site.</a></div>"#;
        assert_eq!(parse_ddg(ddg), vec![Hit { title: "Visit Lisboa".into(), url: "https://www.visitlisboa.com/".into(), snippet: "The official tourism site.".into() }]);
        let bing = r#"<ol><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS8&amp;ntb=1">Example <strong>Domain</strong></a></h2><div class="b_caption"><p class="b_lineclamp2">For use in examples.</p></div></li></ol>"#;
        assert_eq!(parse_bing(bing), vec![Hit { title: "Example Domain".into(), url: "https://example.com/".into(), snippet: "For use in examples.".into() }]);
    }
    #[test]
    fn page_text_keeps_the_words() {
        let (t, x) = page_text("<html><head><title>Hi</title><style>p{}</style></head><body><nav>Menu</nav><main><h1>Lisbon</h1><p>Sunny <b>today</b>.</p><ul><li>Tram</li><li>Fado</li></ul><script>x()</script></main></body></html>", 1000);
        assert_eq!(t, "Hi");
        assert_eq!(x, "## Lisbon\nSunny today.\n- Tram\n- Fado");
    }
}
