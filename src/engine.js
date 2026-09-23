// The watcher: one Composio trigger stream for every push source (Gmail, Typeform, Slack, Discord), polling for X.
// Idempotent: `ensureWatching` can be called again after a source is enabled at runtime and only starts what is missing.
import { loadState, markSeen } from './config.js';
import { subscribe, execute } from './composio.js';
import { fromGmail, fromTypeform, fromSlack, fromDiscord } from './normalize.js';
import { pollMentions } from './sources/x.js';
import { SOURCES, TRIGGER_SLUGS } from './sources/index.js';
import { handleItem } from './pipeline.js';
import { emit } from './bus.js';

export function watching(cfg) {
  return Object.keys(SOURCES).filter((id) => cfg.sources[id]?.enabled);
}
const pushSources = (cfg) => watching(cfg).filter((id) => SOURCES[id].kind === 'trigger');

const state = { subscribed: false, polling: null, retryTimer: null, stopped: false, enqueue: null };
const slackNames = new Map();

/** Sender display name for a Slack user id, cached. Empty string when it cannot be resolved. */
async function slackName(cfg, userId) {
  if (!userId) return '';
  if (slackNames.has(userId)) return slackNames.get(userId);
  let name = '';
  try {
    const d = await execute(cfg, 'slack', 'SLACK_RETRIEVE_DETAILED_USER_INFORMATION', { user: userId });
    const u = d?.user ?? d ?? {};
    name = u.real_name || u.profile?.real_name || u.profile?.display_name || u.name || '';
  } catch {
    /* fall back to the id */
  }
  slackNames.set(userId, name);
  return name;
}

/** Learn our own ids so the prefilter can skip messages we posted. Best effort; kept on cfg in memory. */
async function learnSelf(cfg) {
  if (cfg.sources.gmail?.enabled && !cfg.sources.gmail.selfEmail) {
    try {
      const d = await execute(cfg, 'gmail', 'GMAIL_GET_PROFILE', { user_id: 'me' });
      cfg.sources.gmail.selfEmail = d?.emailAddress ?? d?.email_address ?? '';
    } catch { /* not critical */ }
  }
  if (cfg.sources.x?.enabled && !cfg.sources.x.selfHandle) {
    try {
      const r = await execute(cfg, 'x', 'TWITTER_USER_LOOKUP_ME', {});
      cfg.sources.x.selfHandle = (r?.data?.username ?? r?.username ?? '').replace(/^@/, '');
    } catch { /* not critical */ }
  }
  if (cfg.sources.slack?.enabled && !cfg.sources.slack.selfId) {
    try { cfg.sources.slack.selfId = (await execute(cfg, 'slack', 'SLACK_TEST_AUTH', {}))?.user_id ?? ''; } catch { /* not critical */ }
  }
  if (cfg.sources.discord?.enabled && cfg.sources.discord.replyVia === 'bot' && !cfg.sources.discord.selfId) {
    try { const d = await execute(cfg, 'discord', 'DISCORDBOT_TEST_AUTH', {}); cfg.sources.discord.selfId = d?.id ?? d?.user?.id ?? ''; } catch { /* not critical */ }
  }
}

async function normalize(cfg, evt) {
  const kind = TRIGGER_SLUGS[evt.triggerSlug];
  if (kind === 'gmail') return fromGmail(evt.payload);
  if (kind === 'typeform') return fromTypeform(evt.payload);
  if (kind === 'slack') return fromSlack(evt.payload, { name: await slackName(cfg, evt.payload?.user) });
  if (kind === 'discord') return fromDiscord(evt.payload);
  return null;
}

/** Start whatever is enabled and not yet running. Safe to call repeatedly. */
export async function ensureWatching(cfg) {
  if (!state.enqueue) throw new Error('engine not started');
  await learnSelf(cfg);
  if (!state.subscribed && pushSources(cfg).length) {
    state.subscribed = true;
    await connectStream(cfg);
  }
  if (!state.polling && cfg.sources.x.enabled) {
    const tick = async () => {
      if (!cfg.sources.x.enabled) return;
      try {
        const { items, firstRun } = await pollMentions(cfg);
        if (firstRun) emit('note', { message: 'X: cursor set, replying to mentions from now on' });
        items.forEach(state.enqueue);
      } catch (err) {
        emit('error', { message: `X poll failed: ${err.message}` });
      }
    };
    await tick();
    state.polling = setInterval(tick, Math.max(1, cfg.sources.x.pollMinutes) * 60 * 1000);
  }
}

const MAX_CONCURRENT = 3; // write agents in flight at once
const RECONNECT_MS = [2_000, 5_000, 15_000, 30_000, 60_000]; // then every minute

/**
 * Open the trigger stream and keep it open. A dropped subscription is the failure that matters most here:
 * the process stays up and silently stops receiving, so it retries with backoff instead of giving up.
 */
async function connectStream(cfg, attempt = 0) {
  const onEvent = (evt) => {
    const kind = TRIGGER_SLUGS[evt.triggerSlug];
    if (!kind || !cfg.sources[kind]?.enabled) return; // a trigger for a source that is switched off
    normalize(cfg, evt)
      .then((item) => item && state.enqueue(item))
      .catch((err) => emit('error', { message: `bad event from ${evt.triggerSlug}: ${err.message}` }));
  };
  const retry = (why) => {
    if (state.stopped) return;
    const wait = RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)];
    emit('stream', { status: 'reconnecting', in: wait });
    emit('error', { message: `Composio stream dropped (${why}); reconnecting in ${Math.round(wait / 1000)}s` });
    state.retryTimer = setTimeout(() => connectStream(cfg, attempt + 1), wait);
  };
  try {
    await subscribe(cfg, onEvent, (err) => retry(err?.message ?? String(err)));
    emit('stream', { status: 'connected' });
  } catch (err) {
    retry(err?.message ?? String(err));
  }
}

/** Starts watching. Resolves once subscribed. Returns { stop, enqueue }. */
export async function startEngine(cfg, { dryRun = false } = {}) {
  const seen = loadState();
  state.stopped = false;
  // Messages are handled a few at a time rather than strictly one after another: a write agent takes seconds,
  // and a burst of mail should not sit behind the slowest one. Bounded so a flood cannot fan out unchecked.
  let running = 0;
  const waiting = [];
  const pump = () => {
    while (running < MAX_CONCURRENT && waiting.length) {
      const item = waiting.shift();
      running++;
      handleItem(cfg, item, { dryRun })
        .catch((err) => emit('error', { message: err.message }))
        .finally(() => { running--; pump(); });
    }
  };
  state.enqueue = (item) => {
    if (!markSeen(seen, item.id)) return;
    waiting.push(item);
    pump();
  };
  await ensureWatching(cfg);
  return {
    enqueue: state.enqueue,
    stop: () => {
      state.stopped = true;
      if (state.polling) clearInterval(state.polling);
      if (state.retryTimer) clearTimeout(state.retryTimer);
      state.polling = null;
      state.retryTimer = null;
    },
  };
}
