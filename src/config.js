// jev.json = settings. .state/ = cursors, seen ids, inbox (needs-you pile + held sends), log.jsonl. knowledge/ = the files you edit.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = process.cwd();
export const CONFIG_PATH = path.join(ROOT, 'jev.json');
export const JEV_DIR = path.join(ROOT, '.state');
export const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');
export const STATE_PATH = path.join(JEV_DIR, 'state.json');
export const INBOX_PATH = path.join(JEV_DIR, 'inbox.json');
export const LOG_PATH = path.join(JEV_DIR, 'log.jsonl');
export const LOCK_PATH = path.join(JEV_DIR, 'watcher.lock');

export const BUCKETS = ['ignore', 'faq', 'sales', 'support', 'escalate', 'unsure'];
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-5'; // write agents (generative, via OpenRouter chat)
export const DEFAULT_JEV_MODEL = 'jev-latest'; // the filter (TypeSafe System One, via OpenRouter /v1/systemone)

export function defaultConfig() {
  return {
    userId: 'jev_' + crypto.randomBytes(6).toString('hex'),
    mode: 'review', // review = hold every customer-facing send for your approval. auto = send immediately.
    model: DEFAULT_MODEL,
    jevModel: DEFAULT_JEV_MODEL,
    confidenceFloor: 0.7, // below this, Jev's answer is downgraded to "unsure"
    owner: { name: '', email: '' },
    bookingLink: '',
    sources: {
      gmail: { enabled: false, triggerId: '' },
      typeform: { enabled: false, formId: '', triggerId: '' },
      slack: { enabled: false, channels: [], triggerId: '' }, // channels: Slack channel ids to watch; empty = all the app can see
      discord: { enabled: false, channelId: '', triggerId: '', replyVia: 'manual' }, // manual = drafts wait for you to paste; bot = the Composio bot posts them
      x: { enabled: false, handle: '', authConfigId: '', pollMinutes: 5 },
    },
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function configExists() {
  return fs.existsSync(CONFIG_PATH);
}
export function loadConfig() {
  const base = defaultConfig();
  const saved = readJson(CONFIG_PATH, null);
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    owner: { ...base.owner, ...(saved.owner ?? {}) },
    sources: Object.fromEntries(Object.keys(base.sources).map((k) => [k, { ...base.sources[k], ...(saved.sources?.[k] ?? {}) }])),
  };
}
export function saveConfig(cfg) {
  writeJson(CONFIG_PATH, cfg);
}

// ---- state (cursors, dedupe) ----
export function loadState() {
  return readJson(STATE_PATH, { x: { sinceId: '' }, seen: [] });
}
export function saveState(state) {
  state.seen = state.seen.slice(-1000);
  writeJson(STATE_PATH, state);
}
/** Returns true the first time an id is seen, false afterwards. */
export function markSeen(state, id) {
  if (!id) return true;
  if (state.seen.includes(id)) return false;
  state.seen.push(id);
  saveState(state);
  return true;
}

// ---- watcher lock ----
// Only one process may hold the trigger subscription. Two would each receive the same message and each write a
// reply, so the customer would be answered twice. A second process still serves the UI and the queue.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export const LOCK_STALE_MS = 90_000; // a holder refreshes every 30s; three missed beats and it is fair game

/**
 * Take the watcher lock. Returns null when taken, or the holder `{ pid, port, ts }` when someone else has it.
 * Liveness is not judged by the pid alone: pids get reused, and a stale file naming a pid that happens to exist
 * would block watching forever with no way out but deleting it by hand. The holder refreshes the timestamp.
 */
export function acquireWatcherLock(port) {
  const held = readJson(LOCK_PATH, null);
  const fresh = held?.ts && Date.now() - new Date(held.ts).getTime() < LOCK_STALE_MS;
  if (held && held.pid !== process.pid && alive(held.pid) && fresh) return held;
  writeJson(LOCK_PATH, { pid: process.pid, port, ts: new Date().toISOString() });
  return null;
}

/** Keep our claim fresh. Returns a stop function. */
export function holdWatcherLock(port) {
  const beat = setInterval(() => {
    const held = readJson(LOCK_PATH, null);
    if (!held || held.pid === process.pid) writeJson(LOCK_PATH, { pid: process.pid, port, ts: new Date().toISOString() });
  }, 30_000);
  beat.unref?.();
  return () => clearInterval(beat);
}
export function releaseWatcherLock() {
  const held = readJson(LOCK_PATH, null);
  if (held && held.pid === process.pid) {
    try { fs.unlinkSync(LOCK_PATH); } catch { /* already gone */ }
  }
}

// ---- inbox (needs-you pile + held sends) ----
export function loadInbox() {
  return readJson(INBOX_PATH, []);
}
export function saveInbox(items) {
  writeJson(INBOX_PATH, items);
}
export function addInboxEntry(entry) {
  const items = loadInbox();
  const full = { id: 'ib_' + crypto.randomBytes(4).toString('hex'), ts: new Date().toISOString(), status: 'open', ...entry };
  items.push(full);
  saveInbox(items);
  return full;
}
export function updateInboxEntry(id, patch) {
  const items = loadInbox();
  const i = items.findIndex((e) => e.id === id);
  if (i === -1) return null;
  items[i] = { ...items[i], ...patch };
  saveInbox(items);
  return items[i];
}

// ---- audit log ----
export function appendLog(record) {
  fs.mkdirSync(JEV_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
}

// ---- knowledge files the person edits ----
export function readKnowledge(name) {
  try {
    return fs.readFileSync(path.join(KNOWLEDGE_DIR, name), 'utf8').trim();
  } catch {
    return '';
  }
}
