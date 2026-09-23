// One external store for the page. Components read it with useSyncExternalStore; the SSE stream writes to it.
// Every pipeline event becomes: a counter bump, a pulse travelling along an edge, and a log line.
import { useSyncExternalStore } from 'react';
import { type Bucket, type Decision, type InboxEntry, type Item, type PipelineEvent, type Snapshot, describe, getKnowledge, getSnapshot, pct, post } from './lib/api';

export interface ItemRec { item: Item; decision?: Decision; outcome?: string; preview?: string; ts: number }
export interface Pulse { id: number; edge: string; tone: string; ms: number }
export interface LogLine { id: number; ts: number; text: string; strong?: string; bucket?: Bucket; warn?: boolean; ok?: boolean }

export interface State {
  snapshot: Snapshot | null;
  counts: Record<string, number>;
  items: Record<string, ItemRec>;
  order: string[]; // item ids, oldest first
  log: LogLine[]; // newest first
  inbox: InboxEntry[];
  selected: string | null;
  working: ReadonlySet<string>;
  flash: ReadonlySet<string>;
  pulses: Pulse[];
  knowledge: Record<string, string> | null;
  connection: 'connecting' | 'open' | 'lost';
}

let state: State = {
  snapshot: null, counts: {}, items: {}, order: [], log: [], inbox: [], selected: null,
  working: new Set(), flash: new Set(), pulses: [],
  knowledge: null, connection: 'connecting',
};
const listeners = new Set<() => void>();
function set(patch: Partial<State>) { state = { ...state, ...patch }; for (const l of listeners) l(); }
export function useStore<T>(selector: (s: State) => T): T { return useSyncExternalStore(subscribe, () => selector(state)); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

let seq = 0;
const CHANNEL_NODE: Record<string, string> = { form: 'typeform', gmail: 'gmail', slack: 'slack', discord: 'discord', x: 'x' };
// A scripted message flows from the source it is standing in for; one you typed flows from the Composer node.
export const sourceNode = (item: Item) => (item.test && !item.demo ? 'test' : CHANNEL_NODE[item.channel] ?? 'x');
export const agentNode = (bucket: Bucket) => 'agent-' + bucket;

function bump(id: string, delta = 1) { set({ counts: { ...state.counts, [id]: Math.max(0, (state.counts[id] ?? 0) + delta) } }); }
function withSet(key: 'working' | 'flash', id: string, on: boolean) {
  const next = new Set(state[key]); on ? next.add(id) : next.delete(id); set({ [key]: next } as Partial<State>);
}
function flash(id: string, ms = 700) { withSet('flash', id, true); setTimeout(() => withSet('flash', id, false), ms); }
function travel(a: string, b: string, tone = 'primary', ms = 800): Promise<void> {
  const pulse: Pulse = { id: ++seq, edge: `${a}>${b}`, tone, ms };
  set({ pulses: [...state.pulses, pulse] });
  return new Promise((resolve) => setTimeout(() => { set({ pulses: state.pulses.filter((p) => p.id !== pulse.id) }); resolve(); }, ms));
}
const chains = new Map<string, Promise<void>>(); // per-item promise chain so an item's pulses run in order
function chain(itemId: string, fn: () => Promise<void>) { const next = (chains.get(itemId) ?? Promise.resolve()).then(fn).catch(() => {}); chains.set(itemId, next); }
function log(line: Omit<LogLine, 'id' | 'ts'>) { set({ log: [{ id: ++seq, ts: Date.now(), ...line }, ...state.log].slice(0, 200) }); }

function handle(e: PipelineEvent, replay = false) {
  const s = state.snapshot;
  switch (e.type) {
    case 'snapshot': return applySnapshot(e);
    case 'stats': if (s) set({ snapshot: { ...s, stats: e.stats } }); return;
    case 'config': if (s) set({ snapshot: { ...s, config: e.config } }); return;
    case 'error': log({ text: e.message, warn: true }); return;
    case 'note': log({ text: e.message }); return;
    case 'stream': if (s) set({ snapshot: { ...s, stats: { ...s.stats, stream: e.status === 'connected' ? 'live' : e.status } } }); return;
    // Tracked so the canvas can show every source as live, but never written to the activity log:
    // nothing on screen should announce that a run is scripted.
    case 'demo':
      if (s) set({ snapshot: { ...s, stats: { ...s.stats, demo: { running: e.running, index: e.index ?? 0, total: e.total } } } });
      return;
    case 'inbox': {
      void refreshInbox();
      if (e.action === 'sent') { chain(e.item.id, () => travel('needs-you', 'sent', 'ok')); bump('sent'); log({ strong: `Sent the reply to ${e.item.from}`, text: '', ok: true }); }
      else if (e.action === 'routed' && e.bucket) { chain(e.item.id, () => travel('unsure', e.bucket === 'unsure' ? 'needs-you' : e.bucket!, e.bucket!)); log({ strong: describe(e.item), text: `routed to ${e.bucket}`, bucket: e.bucket }); }
      else log({ strong: describe(e.item), text: e.action === 'done' ? 'pasted by you, marked done' : e.action, ok: e.action === 'done' });
      return;
    }
  }
  const item = e.item; if (!item) return;
  const rec: ItemRec = state.items[item.id] ?? { item, ts: Date.now() };
  const items = { ...state.items, [item.id]: rec };
  const order = state.items[item.id] ? state.order : [...state.order, item.id];
  set({ items, order });
  if (e.type === 'item') {
    const src = sourceNode(item); bump(src); bump('jev');
    if (!replay) { chain(item.id, () => travel(src, 'jev')); flash('jev'); }
    log({ strong: describe(item), text: (item.subject || item.text).slice(0, 90) });
  } else if (e.type === 'decided') {
    const d = e.decision; set({ items: { ...state.items, [item.id]: { ...rec, decision: d } } }); bump(d.bucket);
    if (!replay && !d.manual) chain(item.id, () => travel('jev', d.bucket, d.bucket));
    const why = d.prefiltered ? d.reason ?? '' : `${d.confidence != null ? pct(d.confidence) + ' · ' : ''}${d.reason ?? ''}${d.original && d.original !== d.bucket ? ` (Jev said ${d.original})` : ''}${d.ms ? ` · ${(d.ms / 1000).toFixed(1)}s` : ''}`;
    log({ bucket: d.bucket, text: why });
  } else if (e.type === 'agent_start') {
    const a = agentNode(e.bucket); bump(a); withSet('working', a, true);
    if (!replay) chain(item.id, () => travel(e.bucket, a, e.bucket));
  } else if (e.type === 'action') {
    set({ items: { ...state.items, [item.id]: { ...rec, outcome: e.outcome, preview: e.preview } } });
    const a = agentNode(e.bucket); withSet('working', a, false);
    if (e.outcome === 'sent') { bump('sent'); if (!replay) chain(item.id, () => travel(a, 'sent', 'ok')); log({ ok: true, strong: 'Reply sent', text: (e.preview ?? '').slice(0, 100) }); }
    else if (e.outcome === 'held') { bump('needs-you'); if (!replay) chain(item.id, () => travel(a, 'needs-you', 'held')); log({ strong: 'Draft ready', text: 'waiting for your OK', bucket: e.bucket }); void refreshInbox(); }
    else if (e.outcome === 'needs_you') { bump('needs-you'); if (!replay) chain(item.id, () => travel('unsure', 'needs-you', 'unsure')); log({ strong: 'Needs you', text: describe(item) }); void refreshInbox(); }
    else if (e.outcome === 'error') { flash(a); log({ warn: true, strong: 'Agent failed', text: e.error ?? '' }); }
    else if (e.outcome === 'nothing') log({ strong: 'Agent did nothing', text: (e.note ?? '').slice(0, 100) });
  }
}

function applySnapshot(s: Snapshot) {
  set({ snapshot: s, inbox: s.inbox, counts: {}, items: {}, order: [], connection: 'open' });
  for (const e of s.recent) handle(e, true);
  set({ counts: { ...state.counts, 'needs-you': s.inbox.length } });
}
async function refreshInbox() {
  const r = await getSnapshot();
  set({ inbox: r.inbox, counts: { ...state.counts, 'needs-you': r.inbox.length } });
}

// ── actions used by the UI ─────────────────────────────────────────────
export const actions = {
  select(id: string | null) {
    set({ selected: id });
    if ((id === 'jev' || id === 'agent-support') && !state.knowledge) void getKnowledge().then((k) => set({ knowledge: k }));
  },
  async simulate(text: string, channel: 'email' | 'form' | 'x' | 'slack' | 'discord') {
    const r = await post('/simulate', { text, channel });
    if (r.error) log({ warn: true, text: r.error });
  },
  setMode: (mode: 'review' | 'auto') => post('/mode', { mode }),
  runDemo: () => post('/demo', {}),
  stopDemo: () => post('/demo', { action: 'stop' }),
  /** Start a Composio Connect Link for a toolkit and open it in a new tab. Returns an error string or null. */
  async connect(toolkit: string) {
    const r = await post<{ url?: string; error?: string }>('/connect', { toolkit });
    if (r.error || !r.url) { log({ warn: true, text: r.error ?? 'no connect link' }); return r.error ?? 'no connect link'; }
    window.open(r.url, '_blank', 'noopener');
    return null;
  },
  /** Remove the connected account for a toolkit, so a different one can be connected in its place. */
  async disconnect(toolkit: string) {
    const r = await post('/disconnect', { toolkit });
    if (r.error) { log({ warn: true, text: r.error }); return r.error; }
    return null;
  },
  /** Save a source's fields and/or switch it on or off. Returns an error string or null. */
  async setSource(id: string, patch: Record<string, unknown>) {
    const r = await post('/source/' + id, patch);
    if (r.error) { log({ warn: true, text: r.error }); return r.error; }
    return null;
  },
  async saveXApp(app: { clientId: string; clientSecret: string; bearerToken: string } | { authConfigId: string } | Record<string, never>) {
    const r = await post('/source/x/app', app);
    if (r.error) { log({ warn: true, text: r.error }); return r.error; }
    return null;
  },
  refresh: () => post('/refresh'),
  setFloor: (floor: number) => post('/floor', { floor }),
  setTrigger: (id: string, enabled: boolean) => post('/trigger', { id, enabled }),
  async saveKnowledge(file: string, text: string) {
    await post('/knowledge', { file, text });
    set({ knowledge: { ...(state.knowledge ?? {}), [file]: text } });
  },
  /** Approve everything the queue can actually send. Returns how many went out and how many are left. */
  async sendAll() {
    const r = await post<{ sent?: number; remaining?: number; failed?: { error: string }[]; error?: string }>('/inbox/send-all');
    if (r.error) { log({ warn: true, text: r.error }); return r; }
    await refreshInbox();
    if (r.failed?.length) log({ warn: true, strong: `${r.failed.length} could not be sent`, text: r.failed[0].error });
    return r;
  },
  async inboxAct(id: string, act: 'send' | 'done' | 'drop' | 'route' | 'ignore', body?: { text?: string; bucket?: Bucket }) {
    const r = await post<{ error?: string; gone?: boolean }>(`/inbox/${id}/${act}`, body);
    if (r.gone) { await refreshInbox(); return null; } // the row was stale; catch up without shouting about it
    if (r.error) { log({ warn: true, text: r.error }); return r.error; }
    await refreshInbox();
    return null;
  },
};

// ── SSE + the one hidden control ────────────────────────────────────────
if (typeof window !== 'undefined') {
  // The demo run has no button on purpose: nothing on screen should say "demo" while someone is watching.
  // Ctrl/Cmd + Shift + D starts it, and stops it if one is already running.
  window.addEventListener('keydown', (e) => {
    if (!(e.shiftKey && (e.metaKey || e.ctrlKey) && e.code === 'KeyD')) return;
    e.preventDefault();
    void (state.snapshot?.stats.demo?.running ? actions.stopDemo() : actions.runDemo());
  });
  const es = new EventSource('/events');
  es.onmessage = (m) => handle(JSON.parse(m.data) as PipelineEvent);
  es.onopen = () => set({ connection: 'open' });
  es.onerror = () => set({ connection: 'lost' });
}
