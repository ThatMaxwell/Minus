// The vault: your API keys and other secrets (passwords, tokens), kept in this computer's
// password store. Agents can type a secret into a website or app by its name, and never see
// it: the value goes from the keychain straight to the keyboard (see the runtime).
import { state, save, emit } from './store.js';
import * as rt from './runtime.js';

export const SECRET = 'secret:';
const meta = () => (state.settings.vault ||= {}); // name -> { at, note }: when it was added, and what it's for

/** The secrets agents may type (names only). */
export const names = () => (rt.desktop ? rt.slots().filter((s) => s.startsWith(SECRET)).map((s) => s.slice(SECRET.length)) : Object.keys(meta())).sort((a, b) => a.localeCompare(b));
export const info = (name) => meta()[name] || {};

export async function add(name, value, note = '') {
  name = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name || !value) throw new Error('Give it a name and a value.');
  if (rt.desktop) await rt.setKey(SECRET + name, value);
  meta()[name] = { at: Date.now(), note: note.trim() };
  save(); emit('vault');
  return name;
}
export async function remove(name) {
  if (rt.desktop) await rt.removeKey(SECRET + name);
  delete meta()[name];
  save(); emit('vault');
}
