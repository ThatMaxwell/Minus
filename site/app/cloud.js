// Cloud computers, for real: machines in your own cloud account that your agents work on.
// Minus makes them, starts and stops them, and keeps the list (the app holds their keys).
import { state, save, emit, id as newId } from './store.js';
import * as rt from './runtime.js';

const tauri = window.__TAURI__;
export const real = () => !!tauri && rt.desktop;

export const CLOUDS = [
  { id: 'aws', name: 'AWS', mark: 'aws', color: '#ff9900', by: 'Amazon Web Services',
    fields: [['access_key', 'Access key ID', 'AKIA…'], ['secret_key', 'Secret access key', '', 'secret'], ['region', 'Home region', 'us-east-1']],
    help: 'In the AWS console: IAM → Users → your user → Security credentials → Create access key. The user needs EC2 (AmazonEC2FullAccess) and to read public parameters (AmazonSSMReadOnlyAccess).',
    price: { small: 'about $15 a month running (t3.small)', medium: 'about $30 a month running (t3.medium)' } },
  { id: 'gcp', name: 'Google Cloud', mark: 'G', color: '#4285f4', by: 'Google',
    fields: [['key', 'Service account key (the JSON file)', '{ "type": "service_account", … }', 'json']],
    help: 'In Google Cloud: turn on the Compute Engine API, then IAM & Admin → Service accounts → Create (role: Compute Admin) → Keys → Add key → JSON. Paste the file here.',
    price: { small: 'about $12 a month running (e2-small)', medium: 'about $25 a month running (e2-medium)' } },
  { id: 'oci', name: 'Oracle Cloud', mark: 'O', color: '#c74634', by: 'Oracle',
    fields: [['tenancy', 'Tenancy OCID', 'ocid1.tenancy.oc1..'], ['user', 'User OCID', 'ocid1.user.oc1..'], ['fingerprint', 'Key fingerprint', 'aa:bb:cc:…'], ['region', 'Region', 'us-ashburn-1'], ['private_key', 'Private key (.pem file)', '-----BEGIN PRIVATE KEY-----', 'area']],
    help: 'In Oracle Cloud: Profile → My profile → API keys → Add API key → download the private key. The configuration it shows you has the OCIDs, fingerprint and region.',
    price: { small: 'free on the Always Free tier (1 core, 6 GB)', medium: 'free on the Always Free tier (2 cores, 12 GB)' } },
  { id: 'digitalocean', name: 'DigitalOcean', mark: 'DO', color: '#0080ff', by: 'DigitalOcean',
    fields: [['token', 'API token', 'dop_v1_…', 'secret']],
    help: 'In DigitalOcean: API → Tokens → Generate New Token, with read and write.',
    price: { small: '$12 a month (1 core, 2 GB)', medium: '$24 a month (2 cores, 4 GB)' } },
  { id: 'hetzner', name: 'Hetzner', mark: 'H', color: '#d50c2d', by: 'Hetzner',
    fields: [['token', 'API token', '', 'secret']],
    help: 'In the Hetzner Cloud Console: your project → Security → API tokens → Generate, with read & write.',
    price: { small: 'about €5 a month (2 cores, 4 GB)', medium: 'about €9 a month (4 cores, 8 GB)' } },
];
export const cloud = (pid) => CLOUDS.find((c) => c.id === pid);
export const connected = (pid) => real() && rt.hasKey(`cloud:${pid}`);

// a machine as the rest of the app sees it (one of state.computers)
const asComputer = (m, old = {}) => ({
  ...old, id: `${m.provider}:${m.id}`, real: true, kind: 'cloud', provider: m.provider, name: m.name,
  region: m.region, size: m.size, ip: m.ip, os: 'Ubuntu Linux', ready: !!m.ready,
  status: m.status === 'running' ? (m.ready ? 'running' : 'setting-up') : m.status,
});
export const isReal = (c) => !!c?.real;
export const label = (c) => (c.status === 'starting' ? 'Starting…' : c.status === 'setting-up' ? 'Setting up…' : c.status === 'stopping' ? 'Stopping…' : c.status === 'stopped' ? 'Stopped' : 'Ready');

/** The list from the app, merged into state.computers. */
export async function sync() {
  if (!real()) return;
  let ms = [];
  try { ms = await tauri.core.invoke('cloud_list'); } catch { return; }
  const keep = state.computers.filter((c) => !c.real && c.kind === 'local');
  state.computers = [...keep, ...ms.map((m) => asComputer(m, state.computers.find((c) => c.id === `${m.provider}:${m.id}`)))];
  save(); emit('computers');
  watch();
}

export async function connect(pid, creds) {
  const regions = await tauri.core.invoke('cloud_connect', { provider: pid, creds });
  await rt.refreshKeys();
  (state.settings.cloudRegions ||= {})[pid] = regions; save(); emit('computers');
  return regions;
}
export async function disconnect(pid) { await tauri.core.invoke('cloud_disconnect', { provider: pid }); await rt.refreshKeys(); emit('computers'); }
export async function regions(pid) {
  try { const r = await tauri.core.invoke('cloud_regions', { provider: pid }); (state.settings.cloudRegions ||= {})[pid] = r; save(); return r; }
  catch (e) { const r = state.settings.cloudRegions?.[pid]; if (r?.length) return r; throw e; }
}

export async function create(pid, want) {
  const m = await tauri.core.invoke('cloud_create', { provider: pid, want });
  const c = asComputer(m);
  state.computers.push(c); save(); emit('computers');
  watch();
  return c;
}
export async function refresh(cid) {
  const m = await tauri.core.invoke('cloud_refresh', { id: cid });
  const i = state.computers.findIndex((c) => c.id === cid);
  if (m.status === 'gone') { if (i >= 0) state.computers.splice(i, 1); }
  else if (i >= 0) state.computers[i] = asComputer(m, state.computers[i]);
  save(); emit('computers');
  return m;
}
export async function power(cid, on) {
  await tauri.core.invoke('cloud_power', { id: cid, on });
  const c = state.computers.find((x) => x.id === cid); if (c) { c.status = on ? 'starting' : 'stopping'; save(); emit('computers'); }
  watch();
}
export async function remove(cid) {
  await tauri.core.invoke('cloud_delete', { id: cid });
  state.computers = state.computers.filter((c) => c.id !== cid);
  for (const a of state.agents) if (a.computer === cid) a.computer = 'here';
  save(); emit('computers'); emit('agents');
}

// machines on their way up (or down) are checked every few seconds until they settle
let t = 0;
function watch() {
  clearTimeout(t);
  const moving = state.computers.filter((c) => c.real && ['starting', 'setting-up', 'stopping'].includes(c.status));
  if (!moving.length) return;
  t = setTimeout(async () => { for (const c of moving) await refresh(c.id).catch(() => {}); watch(); }, 6000);
}
export const nextName = () => `Cloud computer ${state.computers.filter((c) => c.kind === 'cloud').length + 1}`;
void newId;
