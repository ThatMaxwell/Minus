// Voices that run on this computer: free, private, and offline once downloaded. Three sizes:
//   Small   Kokoro 82M         92 MB    fast and natural (English)
//   Medium  Supertonic 2       263 MB   natural, and it speaks Portuguese, Spanish, French, Korean too
//   Large   Orpheus 3B         2.4 GB   the most expressive: it laughs, sighs and whispers
// Small and Medium run inside the app (WebAssembly, or the graphics card when there is one).
// Large thinks with llama.cpp on this computer (the app runs it) and its sound is made here.
import { state, save, emit } from './store.js';

const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
const KOKORO = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort.wasm.min.mjs';
const SNAC = 'https://huggingface.co/onnx-community/snac_24khz-ONNX/resolve/main/onnx/decoder_model.onnx';
const tauri = window.__TAURI__;

export const TIERS = {
  small: { name: 'Small', model: 'Kokoro 82M', size: '92 MB', about: 'Fast and natural · English', langs: ['en'],
    voices: [['af_heart', 'Heart', 'Warm'], ['af_bella', 'Bella', 'Bright'], ['af_nicole', 'Nicole', 'Soft'], ['af_sky', 'Sky', 'Light'], ['am_michael', 'Michael', 'Calm'], ['am_fenrir', 'Fenrir', 'Deep'], ['am_puck', 'Puck', 'Playful'], ['bf_emma', 'Emma', 'British'], ['bm_george', 'George', 'British'], ['bm_fable', 'Fable', 'Storyteller']] },
  medium: { name: 'Medium', model: 'Supertonic 2', size: '263 MB', about: 'Natural · English, Português, Español, Français, 한국어', langs: ['en', 'pt', 'es', 'fr', 'ko'],
    voices: [['F1', 'Ana', 'Clear'], ['F2', 'Bia', 'Warm'], ['F3', 'Clara', 'Bright'], ['F4', 'Dani', 'Calm'], ['F5', 'Eva', 'Soft'], ['M1', 'Leo', 'Clear'], ['M2', 'Rafa', 'Warm'], ['M3', 'Theo', 'Deep'], ['M4', 'Davi', 'Calm'], ['M5', 'Caio', 'Bright']] },
  large: { name: 'Large', model: 'Orpheus 3B', size: '2.4 GB', about: 'The most expressive: laughs, sighs, whispers · English · needs a good computer', langs: ['en'], desktop: true,
    voices: [['tara', 'Tara', 'Conversational'], ['leah', 'Leah', 'Warm'], ['jess', 'Jess', 'Lively'], ['mia', 'Mia', 'Gentle'], ['zoe', 'Zoe', 'Bright'], ['leo', 'Leo', 'Calm'], ['dan', 'Dan', 'Casual'], ['zac', 'Zac', 'Energetic']] },
};
export const installed = (tier) => !!(state.settings.localVoices || {})[tier];
const mark = (tier, on) => { (state.settings.localVoices ||= {})[tier] = on; save(); emit('voice'); };

const gpu = async () => { try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; } };
const loaded = {};

// Each model loads once; `progress` hears how the download is going (0 to 1).
async function load(tier, progress = () => {}) {
  if (loaded[tier]) return loaded[tier];
  const files = new Map();
  const onProgress = (p) => {
    if (p.status === 'progress' && p.file) files.set(p.file, [p.loaded || 0, p.total || 0]);
    let got = 0, all = 0; for (const [a, b] of files.values()) { got += a; all += b; }
    if (all) progress(got / all);
  };
  loaded[tier] = (async () => {
    if (tier === 'small') {
      const { KokoroTTS } = await import(KOKORO);
      const webgpu = await gpu();
      return await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: webgpu ? 'fp32' : 'q8', device: webgpu ? 'webgpu' : 'wasm', progress_callback: onProgress });
    }
    if (tier === 'medium') {
      const { pipeline } = await import(TJS);
      return await pipeline('text-to-speech', 'onnx-community/Supertonic-TTS-2-ONNX', { device: (await gpu()) ? 'webgpu' : 'wasm', progress_callback: onProgress });
    }
    if (tier === 'large') {
      if (!tauri) throw new Error('The large voice runs in the Minus app on a computer.');
      // the brain (Orpheus, run by llama.cpp) is set up by the app; the sound is made here
      const un = await tauri.event.listen('voice-install', ({ payload: p }) => p?.total && progress(Math.min(0.97, p.done / p.total)));
      try { await tauri.core.invoke('orpheus_install'); } finally { un(); }
      return await snacSession();
    }
    throw new Error('No local voice called ' + tier);
  })();
  try { return await loaded[tier]; } catch (e) { delete loaded[tier]; throw e; }
}

/** Downloads a voice so it's ready offline. */
export async function install(tier, progress) {
  await load(tier, progress);
  mark(tier, true);
}
export async function uninstall(tier) {
  delete loaded[tier];
  mark(tier, false);
  if (tier === 'large' && tauri) await tauri.core.invoke('orpheus_remove').catch(() => {});
}

// What the person hears from bracketed directions: Orpheus laughs and sighs, the others read plain words.
const ORPHEUS_TAGS = { laughing: '<laugh>', laugh: '<laugh>', chuckle: '<chuckle>', playfully: '<chuckle>', sadly: '<sigh>', sigh: '<sigh>', sleepily: '<yawn>', surprised: '<gasp>', gasp: '<gasp>', nervously: '<sigh>' };
const plain = (t) => t.replace(/\[[a-z][a-z -]{0,22}\]/gi, ' ').replace(/\s+/g, ' ').trim();
const guessLang = (t) => (/[ãõçáéíóúâêô]|\b(você|não|está|obrigad|olá|tudo|então)\b/i.test(t) ? 'pt' : /[ñ¿¡]|\b(usted|gracias|hola|qué)\b/i.test(t) ? 'es' : /[àèùëïœ]|\b(merci|bonjour|vous|c'est)\b/i.test(t) ? 'fr' : /[가-힣]/.test(t) ? 'ko' : 'en');

/** Speaks `text` with a local voice: Float32 samples and their rate. */
export async function synth(tier, voice, text) {
  const m = await load(tier);
  if (tier === 'small') {
    const a = await m.generate(plain(text), { voice: voice || 'af_heart' });
    return { samples: a.audio, rate: a.sampling_rate };
  }
  if (tier === 'medium') {
    const lang = guessLang(text);
    const a = await m(`<${lang}>${plain(text)}</${lang}>`, { speaker_embeddings: `https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/${voice || 'F1'}.bin`, num_inference_steps: 8, speed: 1.05 });
    return { samples: a.audio, rate: a.sampling_rate };
  }
  // large: Orpheus writes sound codes; SNAC turns them into sound
  const said = text.replace(/\[([a-z][a-z -]{0,22})\]/gi, (_, d) => ORPHEUS_TAGS[d.toLowerCase()] || ' ').replace(/\s+/g, ' ').trim();
  const codes = await tauri.core.invoke('orpheus_codes', { text: said, voice: voice || 'tara' });
  return { samples: await snac(m, codes), rate: 24000 };
}

// Orpheus' codes come in frames of 7: one for SNAC's first layer, two for the second, four for the third.
export function layers(codes) {
  const n = Math.floor(codes.length / 7), l0 = [], l1 = [], l2 = [];
  for (let j = 0; j < n; j++) {
    const f = codes.slice(j * 7, j * 7 + 7);
    l0.push(f[0]); l1.push(f[1], f[4]); l2.push(f[2], f[3], f[5], f[6]);
  }
  return [l0, l1, l2];
}
// SNAC, the decoder that turns Orpheus' codes into sound (53 MB, loaded once).
let snacP = null;
export function snacSession() {
  snacP ||= (async () => {
    const ort = await import(ORT);
    ort.env.wasm.wasmPaths = ORT.replace(/[^/]+$/, '');
    return ort.InferenceSession.create(SNAC, { executionProviders: ['wasm'] });
  })().catch((e) => { snacP = null; throw e; });
  return snacP;
}
export async function snac(session, codes) {
  const ort = await import(ORT);
  const ls = layers(codes);
  if (!ls[0].length) throw new Error('The large voice made no sound for that. Try again.');
  const feeds = {};
  session.inputNames.forEach((name, i) => { feeds[name] = new ort.Tensor('int64', BigInt64Array.from(ls[i].map(BigInt)), [1, ls[i].length]); });
  const out = await session.run(feeds);
  return out[session.outputNames[0]].data;
}
