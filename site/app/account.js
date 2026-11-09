// Your Minus account: sign in with GitHub, see your devices, pair a new one with a QR code.
// Backed by Supabase (see supabase/ in the repo). API keys for AI never go through here.
import { SUPABASE } from './config.js';
import { emit } from './store.js';

const tauri = window.__TAURI__;
const isAndroid = /Android/i.test(navigator.userAgent);
export const configured = () => !!(SUPABASE.url && SUPABASE.key && window.supabase);

let sb = null;
export function client() {
  if (!configured()) return null;
  sb ||= window.supabase.createClient(SUPABASE.url, SUPABASE.key, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: !tauri, storageKey: 'minus.auth' },
  });
  return sb;
}

export let session = null;
export const user = () => session?.user || null;
export const login = () => user()?.user_metadata?.user_name || user()?.email || '';

export async function start() {
  const c = client(); if (!c) return;
  ({ data: { session } } = await c.auth.getSession());
  c.auth.onAuthStateChange((_e, s) => {
    const was = !!session; session = s; emit('account');
    if (s && !was) registerDevice().catch(() => {});
  });
  if (session) registerDevice().catch(() => {});
  emit('account');
  // links back into the app: minus://auth/callback?code=… and minus://pair?code=…
  tauri?.event.listen('deep-link', ({ payload }) => handleLink(String(payload)));
}

export async function handleLink(url) {
  let u; try { u = new URL(url); } catch { return; }
  const code = u.searchParams.get('code') || new URLSearchParams(u.hash.slice(1)).get('code');
  if (!code) return;
  if (u.host === 'auth' || u.pathname.includes('auth')) { await client()?.auth.exchangeCodeForSession(code); emit('account'); }
  else if (u.host === 'pair' || u.pathname.includes('pair')) await redeem(code);
}

export async function signIn() {
  const c = client(); if (!c) throw new Error('Minus isn’t connected to its server yet.');
  if (tauri) {
    const { data, error } = await c.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: 'minus://auth/callback', skipBrowserRedirect: true } });
    if (error) throw error;
    await tauri.opener.openUrl(data.url);
  } else {
    const { error } = await c.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: location.href.split('#')[0] } });
    if (error) throw error;
  }
}
export async function signOut() { await client()?.auth.signOut(); session = null; emit('account'); }

/* ───────── this device ───────── */
const platform = () => (isAndroid ? 'android' : /Mac/.test(navigator.platform) ? 'macos' : /Win/.test(navigator.platform) ? 'windows' : 'linux');
export function deviceId() {
  let id = localStorage.getItem('minus.device');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('minus.device', id); }
  return id;
}
const defaultName = () => (isAndroid ? 'My phone' : { windows: 'Windows PC', macos: 'Mac', linux: 'Linux PC' }[platform()]);

async function registerDevice() {
  const c = client(); if (!c || !session) return;
  const id = deviceId(), kind = isAndroid ? 'phone' : 'desktop';
  const name = localStorage.getItem('minus.deviceName') || defaultName();
  await c.from('devices').upsert({ id, name, kind, platform: platform(), app_version: '0.1.0', last_seen: new Date().toISOString() });
  // a desktop is also a computer your agents can use
  if (kind === 'desktop') {
    const { data } = await c.from('computers').select('id').eq('device_id', id).maybeSingle();
    if (!data) await c.from('computers').insert({ name, kind: 'local', device_id: id, status: 'ready' });
  }
  emit('devices');
}

export async function devices() {
  const c = client(); if (!c || !session) return [];
  const { data } = await c.from('devices').select('*').order('created_at');
  return data || [];
}
export async function removeDevice(id) { await client()?.from('devices').delete().eq('id', id); emit('devices'); }

/* ───────── pairing ───────── */
// The QR holds a web link, so any phone camera can read it; the page hands the code to the app.
export const PAIR_PAGE = 'https://getminus.vercel.app/pair.html';
export async function makePairCode() {
  const c = client(); if (!c || !session) throw new Error('Sign in first.');
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const code = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const { error } = await c.from('pairing_codes').insert({ code, device_name: defaultName() });
  if (error) throw error;
  return { code, link: `${PAIR_PAGE}#code=${code}`, expires: Date.now() + 5 * 60e3 };
}
export async function redeem(code) {
  const c = client(); if (!c) throw new Error('Minus isn’t connected to its server yet.');
  const r = await fetch(`${SUPABASE.url}/functions/v1/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE.key, Authorization: `Bearer ${SUPABASE.key}` }, body: JSON.stringify({ code }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Pairing didn’t work. Make a new code and try again.');
  const { error } = await c.auth.verifyOtp({ token_hash: j.token_hash, type: j.type || 'magiclink' });
  if (error) throw error;
  emit('account');
}

// QR as SVG (no network, no images)
export function qrSVG(text, size = 220) {
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), cell = size / (n + 8);
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${(x + 4) * cell} ${(y + 4) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Pairing code"><rect width="${size}" height="${size}" rx="${cell * 3}" fill="#f3f2ee"/><path d="${d}" fill="#0b0b0c"/></svg>`;
}
