// Keep names as names. Browser translators turn "minus", "Gemini", "Patch" or "Inbox" into
// ordinary words; this wraps every product and agent name in translate="no", including text
// the page adds later (the live demos), before a translator gets to it.
const NAMES = /\b(Minus|minus|Claude|ChatGPT|Codex|Gemini|Grok|Llama|Ollama|Orpheus|Whisper|Groq|Diana|Hannah|Autumn|Troy|Daniel|Austin|OpenRouter|OpenAI|Anthropic|GitHub|Scout|Inbox|Ledger|Patch|Atlas|Rosie|Acme|MIT)\b/g;
const SKIP = '[translate="no"], script, style, textarea, .i-src';

function protect(root) {
  if (!root || (root.nodeType === 1 && root.closest(SKIP))) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const hits = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { NAMES.lastIndex = 0; if (NAMES.test(n.nodeValue)) hits.push(n); }
  for (const n of hits) {
    // One wrapper keeps the text a single run, so spaces next to a name survive inside flex boxes.
    const frag = document.createElement('mn-t'), s = n.nodeValue; // own tag names: page styles that target spans never touch them
    let last = 0; NAMES.lastIndex = 0;
    for (let m; (m = NAMES.exec(s)); ) {
      if (m.index > last) frag.append(s.slice(last, m.index));
      const span = document.createElement('mn-n');
      span.setAttribute('translate', 'no'); span.textContent = m[0];
      frag.append(span); last = m.index + m[0].length;
    }
    if (last < s.length) frag.append(s.slice(last));
    n.replaceWith(frag);
  }
}

export function keepNames() {
  protect(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) protect(n.nodeType === 3 ? n.parentElement : n);
  }).observe(document.body, { childList: true, subtree: true });
}
