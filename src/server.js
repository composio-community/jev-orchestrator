// Local web server: serves the built UI, streams pipeline events over SSE, and exposes the actions the page needs,
// including connecting sources from the browser (Composio Connect Links) and switching them on.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, configExists, loadInbox, updateInboxEntry, appendLog, readKnowledge, acquireWatcherLock, releaseWatcherLock, holdWatcherLock, KNOWLEDGE_DIR, BUCKETS } from './config.js';
import { startEngine, ensureWatching, watching } from './engine.js';
import { handleItem, simulatedItem } from './pipeline.js';
import { runDemo, stopDemo, demoState, composedCfg, DEMO_OWNER } from './demo.js';
import { runWriteAgent, sendHeld, heldBody, AGENT_LABELS, MANUAL_TOOL } from './agents.js';
import { connectedToolkits, connectedAccount, disconnectToolkit, listMyTriggers, composio, beginConnect, ensureTrigger, disableTrigger, createXAuthConfig, resetSessions, authConfigExists } from './composio.js';
import { SOURCES, TOOLKIT_LABELS, publicSources, missingFields, parseField, requiredToolkits } from './sources/index.js';
import { CRITERIA } from './jev.js';
import { on, emit } from './bus.js';
import { loadEnv } from './env.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const DIST = path.join(WEB, 'dist'); // built by `npm run build` (Vite); see vite.config.ts
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const API = new Set(['/snapshot', '/events', '/knowledge', '/simulate', '/mode', '/refresh', '/trigger', '/floor', '/connect', '/disconnect', '/demo']);
const isApi = (p) => API.has(p) || p.startsWith('/inbox/') || p.startsWith('/source/');
const ALL_TOOLKITS = [...new Set(Object.values(SOURCES).flatMap((s) => [...s.toolkits, ...(s.optional ?? [])]))];

/** Serve the built UI from web/dist. Unknown non-API paths fall back to index.html. Returns false if nothing was served. */
function serveStatic(pathname, res) {
  if (isApi(pathname)) return false;
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  let file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('UI not built. Run `npm run build` in the jev-orchestrator directory.');
    return true;
  }
  const ext = path.extname(file);
  const immutable = rel.startsWith('assets/') || rel.startsWith('fonts/');
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store' });
  res.end(fs.readFileSync(file));
  return true;
}
const KNOWLEDGE_FILES = ['business.md', 'faq.md', 'support.md'];

export async function startServer({ port = 4180, open = true } = {}) {
  loadEnv();
  const cfg = loadConfig();
  const recent = []; // last events, replayed to new browser tabs
  const clients = new Set();
  const stats = { connected: {}, accounts: {}, pending: {}, stream: watching(cfg).length ? 'connecting' : 'off', triggers: [], demo: demoState() };
  let engine = null;

  on((e) => {
    recent.push(e);
    if (recent.length > 300) recent.shift();
    if (e.type === 'stream') stats.stream = e.status === 'connected' ? 'live' : e.status ?? 'live';
    if (e.type === 'error' && /stream/i.test(e.message)) stats.stream = 'error';
    if (e.type === 'demo') {
      stats.demo = { running: e.running, index: e.index ?? 0, total: e.total };
      if (!e.index) broadcast({ type: 'config', ts: new Date().toISOString(), config: publicConfig() });
    }
    broadcast(e);
  });
  const broadcast = (e) => {
    const line = `data: ${JSON.stringify(e)}\n\n`;
    for (const res of clients) res.write(line);
  };
  const publicConfig = () => ({ mode: cfg.mode, owner: demoState().running ? DEMO_OWNER : cfg.owner, jevModel: cfg.jevModel, model: cfg.model, confidenceFloor: cfg.confidenceFloor ?? 0.5, sources: cfg.sources, bookingLink: cfg.bookingLink });
  const snapshot = () => ({
    configured: configExists(),
    config: publicConfig(),
    watching: watching(cfg),
    xAppInEnv: Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET && process.env.X_BEARER_TOKEN),
    stats,
    sources: publicSources(),
    criteria: CRITERIA,
    buckets: BUCKETS,
    agents: AGENT_LABELS,
    inbox: loadInbox().filter((e) => e.status === 'open').map(publicEntry),
    recent,
  });
  const broadcastConfig = () => broadcast({ type: 'config', ts: new Date().toISOString(), config: publicConfig() });

  /** Start the engine once; afterwards just pick up newly enabled sources. */
  async function engineUp() {
    if (!process.env.COMPOSIO_API_KEY) return;
    if (!engine) {
      const held = acquireWatcherLock(port);
      if (held) {
        // Another window already owns the triggers. Serve the UI and the queue, but do not watch, or this
        // message would be answered twice.
        stats.stream = 'standby';
        stats.watchedBy = held.port;
        emit('note', { message: `Another window on port ${held.port} is watching. This one shows the queue but will not reply.` });
        return;
      }
      holdWatcherLock(port);
      process.once('exit', releaseWatcherLock);
      for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { releaseWatcherLock(); process.exit(0); });
      engine = await startEngine(cfg);
    } else await ensureWatching(cfg);
  }

  async function refreshSources() {
    try {
      stats.accounts = await connectedToolkits(cfg, ALL_TOOLKITS);
      delete stats.accountsError;
    } catch (err) {
      stats.accountsError = err.message;
    }
    for (const id of Object.keys(SOURCES)) stats.connected[id] = cfg.sources[id]?.enabled ? requiredToolkits(id, cfg.sources[id]).every((t) => stats.accounts[t]) : null;
    // Keep the stored X auth config pointing at whatever the live connection actually used.
    if (stats.accounts.twitter) {
      try {
        const live = (await connectedAccount(cfg, 'twitter'))?.authConfig?.id;
        if (live && live !== cfg.sources.x.authConfigId) {
          cfg.sources.x.authConfigId = live;
          saveConfig(cfg);
          resetSessions();
          broadcastConfig();
        }
      } catch { /* not critical */ }
    }
    try {
      stats.triggers = (await listMyTriggers(cfg)).map((t) => ({ id: t.id, name: t.triggerName, disabled: Boolean(t.disabledAt), toolkit: t.toolkitSlug ?? '' }));
      delete stats.triggersError;
    } catch (err) {
      stats.triggersError = err.message;
    }
    broadcast({ type: 'stats', ts: new Date().toISOString(), stats });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      if (req.method === 'GET' && serveStatic(url.pathname, res)) return;
      if (req.method === 'GET' && url.pathname === '/snapshot') return send(200, snapshot());
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ type: 'snapshot', ...snapshot() })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/knowledge') {
        return send(200, Object.fromEntries(KNOWLEDGE_FILES.map((f) => [f, readKnowledge(f)])));
      }
      const body = req.method === 'POST' ? await readJson(req) : {};
      if (req.method === 'POST' && url.pathname === '/knowledge') {
        if (!KNOWLEDGE_FILES.includes(body.file)) return send(400, { error: 'unknown file' });
        fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
        fs.writeFileSync(path.join(KNOWLEDGE_DIR, body.file), String(body.text ?? ''));
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/simulate') {
        const text = String(body.text ?? '').trim();
        if (!text) return send(400, { error: 'text is empty' });
        const item = simulatedItem(text, { from: body.channel || 'email', sender: body.sender || '' });
        handleItem(composedCfg(cfg), item).catch((err) => emit('error', { message: err.message }));
        return send(200, { ok: true, id: item.id });
      }
      if (req.method === 'POST' && url.pathname === '/demo') {
        if (body.action === 'stop') { stopDemo(); return send(200, { ok: true }); }
        runDemo(cfg).catch((err) => emit('error', { message: `demo: ${err.message}` }));
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/mode') {
        if (!['auto', 'review'].includes(body.mode)) return send(400, { error: 'mode must be auto or review' });
        cfg.mode = body.mode;
        saveConfig(cfg);
        broadcastConfig();
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/floor') {
        const n = Number(body.floor);
        if (!(n >= 0 && n <= 1)) return send(400, { error: 'floor must be 0..1' });
        cfg.confidenceFloor = n;
        saveConfig(cfg);
        broadcastConfig();
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/refresh') {
        await refreshSources();
        return send(200, { ok: true, stats });
      }
      if (req.method === 'POST' && url.pathname === '/trigger') {
        if (!body.id) return send(400, { error: 'id' });
        if (body.enabled) await composio().triggers.enable(body.id);
        else await composio().triggers.disable(body.id);
        await refreshSources();
        return send(200, { ok: true });
      }

      // ---- connecting sources from the page ----
      if (req.method === 'POST' && url.pathname === '/connect') {
        const toolkit = String(body.toolkit ?? '');
        if (!ALL_TOOLKITS.includes(toolkit)) return send(400, { error: 'unknown toolkit' });
        if (toolkit === 'twitter') {
          if (!cfg.sources.x.authConfigId) return send(400, { error: 'Save your X app (client id, secret, bearer token) first.' });
          // A custom auth config can disappear server-side after it is created; sending someone to a dead link
          // ends in a success page that connects nothing, so check before handing one out.
          if (!(await authConfigExists(cfg.sources.x.authConfigId))) {
            cfg.sources.x.authConfigId = '';
            saveConfig(cfg);
            broadcastConfig();
            return send(400, { error: 'Composio no longer has your saved X app, so the sign-in link would connect nothing. Create the auth config in the Composio dashboard and save its id here.' });
          }
        }
        const { url: link, wait } = await beginConnect(cfg, toolkit, toolkit === 'twitter' ? cfg.sources.x.authConfigId : undefined);
        stats.pending[toolkit] = true;
        broadcast({ type: 'stats', ts: new Date().toISOString(), stats });
        wait()
          .then(() => { resetSessions(); emit('note', { message: `${TOOLKIT_LABELS[toolkit]} connected` }); })
          .catch((err) => emit('error', { message: `${TOOLKIT_LABELS[toolkit]} not connected: ${err.message}` }))
          .finally(async () => { delete stats.pending[toolkit]; await refreshSources(); });
        return send(200, { ok: true, url: link });
      }
      if (req.method === 'POST' && url.pathname === '/source/x/app') {
        // Fall back to the X app credentials in .env, so recreating the auth config is one click. Composio has
        // been dropping these configs, so this is not a one-off setup step.
        const clientId = body.clientId || process.env.X_CLIENT_ID;
        const clientSecret = body.clientSecret || process.env.X_CLIENT_SECRET;
        const bearerToken = body.bearerToken || process.env.X_BEARER_TOKEN;
        const { authConfigId } = body;
        // An auth config made in the Composio dashboard can be pasted in directly.
        if (authConfigId) {
          const id = String(authConfigId).trim();
          if (!(await authConfigExists(id))) return send(400, { error: 'Composio does not have an auth config with that id.' });
          cfg.sources.x.authConfigId = id;
          saveConfig(cfg);
          broadcastConfig();
          return send(200, { ok: true, authConfigId: id });
        }
        if (!clientId || !clientSecret || !bearerToken) return send(400, { error: 'client id, client secret and bearer token are all required' });
        const created = await createXAuthConfig({ clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim(), bearerToken: String(bearerToken).trim() });
        if (!(await authConfigExists(created))) return send(502, { error: 'Composio accepted the X app but the auth config did not persist. Create it in the Composio dashboard instead, then paste its id.' });
        cfg.sources.x.authConfigId = created;
        saveConfig(cfg);
        broadcastConfig();
        return send(200, { ok: true, authConfigId: cfg.sources.x.authConfigId });
      }
      if (req.method === 'POST' && url.pathname === '/disconnect') {
        const toolkit = String(body.toolkit ?? '');
        if (!ALL_TOOLKITS.includes(toolkit)) return send(400, { error: 'unknown toolkit' });
        const removed = await disconnectToolkit(cfg, toolkit);
        // A source that can no longer reach its account should stop watching rather than fail on every message.
        for (const [id, def] of Object.entries(SOURCES)) {
          if (def.toolkits.includes(toolkit) && cfg.sources[id]?.enabled) {
            cfg.sources[id].enabled = false;
            if (def.trigger) await disableTrigger(cfg.sources[id].triggerId);
            if (id === 'x') { cfg.sources.x.selfHandle = ''; cfg.sources.x.authConfigId = ''; }
            if (id === 'gmail') cfg.sources.gmail.selfEmail = '';
          }
        }
        saveConfig(cfg);
        broadcastConfig();
        await refreshSources();
        return send(200, { ok: true, removed });
      }
      const sm = url.pathname.match(/^\/source\/([a-z]+)$/);
      if (req.method === 'POST' && sm) {
        const id = sm[1];
        const def = SOURCES[id];
        if (!def) return send(404, { error: 'unknown source' });
        const src = cfg.sources[id];
        for (const f of def.fields) if (body[f.key] !== undefined) src[f.key] = parseField(id, f.key, body[f.key]);
        if (body.enabled === true) {
          const missing = missingFields(id, src);
          if (missing.length) return send(400, { error: `missing: ${missing.join(', ')}` });
          if (id === 'x' && !src.authConfigId) return send(400, { error: 'Save your X app first.' });
          const need = requiredToolkits(id, src);
          const acc = await connectedToolkits(cfg, need);
          const notConnected = need.filter((t) => !acc[t]);
          if (notConnected.length) return send(400, { error: `connect ${notConnected.map((t) => TOOLKIT_LABELS[t]).join(' and ')} first` });
          if (def.trigger) {
            const [slug, conf] = def.trigger(src);
            src.triggerId = await ensureTrigger(cfg, slug, conf);
          }
          src.enabled = true;
          saveConfig(cfg);
          resetSessions();
          stats.stream = stats.stream === 'off' ? 'connecting' : stats.stream;
          await engineUp();
        } else if (body.enabled === false) {
          src.enabled = false;
          if (def.trigger) await disableTrigger(src.triggerId);
          saveConfig(cfg);
        } else {
          saveConfig(cfg);
        }
        broadcastConfig();
        await refreshSources();
        return send(200, { ok: true, source: src });
      }

      if (req.method === 'POST' && url.pathname === '/inbox/send-all') {
        // Escalations are deliberately left out: the whole point of that bucket is that a person reads the
        // message before it goes out, and a bulk approve would quietly defeat it.
        const open = loadInbox().filter((e) => e.status === 'open' && e.kind === 'held' && e.action?.tool !== MANUAL_TOOL && e.bucket !== 'escalate');
        let sent = 0;
        const failed = [];
        for (const entry of open) {
          try {
            await sendHeld(cfg, entry);
            updateInboxEntry(entry.id, { status: 'sent', sentText: heldBody(entry.action) });
            emit('inbox', { action: 'sent', id: entry.id, item: entry.item, bucket: entry.bucket });
            sent++;
          } catch (err) {
            failed.push({ id: entry.id, error: err.message });
          }
        }
        const stuck = loadInbox().filter((e) => e.status === 'open').length;
        return send(200, { ok: true, sent, failed, remaining: stuck, inbox: loadInbox().filter((e) => e.status === 'open').map(publicEntry) });
      }
      const m = url.pathname.match(/^\/inbox\/([^/]+)\/(send|done|drop|ignore|route)$/);
      if (req.method === 'POST' && m) {
        const [, id, action] = m;
        const entry = loadInbox().find((e) => e.id === id);
        if (!entry) return send(404, { error: 'that one is no longer in the queue', gone: true });
        if (entry.status !== 'open') return send(409, { error: 'already handled', gone: true });
        if (action === 'send') {
          await sendHeld(cfg, entry, body.text != null ? String(body.text) : undefined);
          updateInboxEntry(id, { status: 'sent', sentText: body.text ?? heldBody(entry.action) });
          emit('inbox', { action: 'sent', id, item: entry.item, bucket: entry.bucket });
        } else if (action === 'done') {
          updateInboxEntry(id, { status: 'handled', sentText: body.text ?? heldBody(entry.action) });
          appendLog({ event: 'handled', inboxId: id, itemId: entry.item.id });
          emit('inbox', { action: 'done', id, item: entry.item, bucket: entry.bucket });
        } else if (action === 'drop') {
          updateInboxEntry(id, { status: 'dropped' });
          appendLog({ event: 'dropped', inboxId: id, itemId: entry.item.id });
          emit('inbox', { action: 'dropped', id, item: entry.item, bucket: entry.bucket });
        } else if (action === 'ignore') {
          updateInboxEntry(id, { status: 'ignored' });
          emit('inbox', { action: 'ignored', id, item: entry.item, bucket: entry.bucket });
        } else if (action === 'route') {
          if (!['faq', 'sales', 'support', 'escalate'].includes(body.bucket)) return send(400, { error: 'bucket' });
          updateInboxEntry(id, { status: 'routed', routedTo: body.bucket });
          emit('inbox', { action: 'routed', id, item: entry.item, bucket: body.bucket });
          emit('decided', { item: entry.item, decision: { bucket: body.bucket, reason: 'you chose ' + body.bucket, manual: true } });
          emit('agent_start', { item: entry.item, bucket: body.bucket });
          runWriteAgent(cfg, body.bucket, entry.item, { ...entry.decision, bucket: body.bucket, reason: 'you chose ' + body.bucket })
            .then((r) => emit('action', { item: entry.item, bucket: body.bucket, outcome: r.outcome, inboxId: r.inboxId, preview: r.calls[0] ? heldBody(r.calls[0]) : '', note: r.note }))
            .catch((err) => emit('action', { item: entry.item, bucket: body.bucket, outcome: 'error', error: err.message }));
        }
        return send(200, { ok: true, inbox: loadInbox().filter((e) => e.status === 'open').map(publicEntry) });
      }
      send(404, { error: 'not found' });
    } catch (err) {
      send(500, { error: err.message });
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const urlStr = `http://127.0.0.1:${port}`;
  if (configExists()) {
    refreshSources();
    engineUp().catch((err) => {
      stats.stream = 'error';
      emit('error', { message: `could not start watching: ${err.message}` });
    });
  }
  if (open) {
    const { spawn } = await import('node:child_process');
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      spawn(cmd, [urlStr], { stdio: 'ignore', detached: true }).unref();
    } catch {
      /* the URL is printed anyway */
    }
  }
  return { url: urlStr, server };
}

/** Jev's own next-best bucket for something it could not decide, so sorting it is one click and not five. */
function suggestedBucket(decision) {
  const probs = decision?.probabilities ?? {};
  const ranked = Object.entries(probs)
    .filter(([b]) => !['unsure', 'ignore'].includes(b))
    .sort((a, b) => b[1] - a[1]);
  const top = decision?.original && !['unsure', 'ignore'].includes(decision.original) ? decision.original : ranked[0]?.[0];
  return ['faq', 'sales', 'support', 'escalate'].includes(top) ? top : '';
}

function publicEntry(e) {
  const a = e.action?.args ?? {};
  const manual = e.action?.tool === MANUAL_TOOL;
  return {
    id: e.id,
    ts: e.ts,
    kind: e.kind,
    bucket: e.bucket,
    item: e.item,
    reason: e.decision?.reason ?? '',
    note: e.note ?? '',
    draft: e.kind === 'held' ? heldBody(e.action) : '',
    tool: manual ? 'paste into ' + e.item.channel : e.action?.tool ?? '',
    to: manual ? e.item.reply?.channelId ?? '' : a.recipient_email ?? a.channel ?? a.channel_id ?? '',
    manual,
    channel: e.item?.channel ?? '',
    suggested: e.kind === 'held' ? '' : suggestedBucket(e.decision),
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
