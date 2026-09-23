// Everything that touches Composio lives here.
// Sessions: one narrow direct-tools session per channel. The write agents never get more than the tool(s) they need.
import { Composio, SessionPreset } from '@composio/core';

let client;
export function composio() {
  if (!client) {
    if (!process.env.COMPOSIO_API_KEY) throw new Error('COMPOSIO_API_KEY is missing. Run `jev-orchestrator setup`.');
    client = new Composio({ allowTracking: false });
  }
  return client;
}

// Tools each channel is allowed to write with. Nothing else is exposed to the model.
export const CHANNEL_TOOLS = {
  gmail: ['GMAIL_REPLY_TO_THREAD', 'GMAIL_SEND_EMAIL'],
  x: ['TWITTER_CREATION_OF_A_POST'],
  slack: ['SLACK_SEND_MESSAGE'],
  discord: ['DISCORDBOT_CREATE_MESSAGE'],
};

// What each channel's session is built from: the toolkit, every tool the process may call (send tools plus the
// read-only helpers the engine needs), and where the auth config comes from.
const CHANNELS = {
  gmail: { toolkit: 'gmail', tools: [...CHANNEL_TOOLS.gmail, 'GMAIL_GET_PROFILE'] },
  x: { toolkit: 'twitter', tools: [...CHANNEL_TOOLS.x, 'TWITTER_RECENT_SEARCH', 'TWITTER_USER_LOOKUP_ME'], authConfig: (cfg) => cfg.sources.x.authConfigId, setupHint: 'X is not set up. Save your X app first.' },
  slack: { toolkit: 'slack', tools: [...CHANNEL_TOOLS.slack, 'SLACK_TEST_AUTH', 'SLACK_RETRIEVE_DETAILED_USER_INFORMATION'] },
  discord: { toolkit: 'discordbot', tools: [...CHANNEL_TOOLS.discord, 'DISCORDBOT_TEST_AUTH'] },
};

const sessions = new Map();
/** Forget cached sessions, e.g. after a new account was connected. */
export function resetSessions() {
  sessions.clear();
}

/**
 * Narrow write session for a channel. Cached per process.
 * A session only sees a connected account when it is created with that account's auth config,
 * so we always resolve the auth config from the user's active connection first.
 */
export async function channelSession(cfg, channel) {
  if (sessions.has(channel)) return sessions.get(channel);
  const def = CHANNELS[channel];
  if (!def) throw new Error(`unknown channel ${channel}`);
  // The live connection wins. A stored id can point at a different auth config than the one the account was
  // actually created under, and the session would then see no connection at all.
  const live = (await connectedAccount(cfg, def.toolkit))?.authConfig?.id;
  const authConfigId = live || def.authConfig?.(cfg);
  if (!authConfigId && def.setupHint) throw new Error(def.setupHint);
  const session = await composio().create(cfg.userId, {
    sessionPreset: SessionPreset.DIRECT_TOOLS,
    manageConnections: false,
    toolkits: [def.toolkit],
    tools: { [def.toolkit]: def.tools },
    ...(authConfigId ? { authConfigs: { [def.toolkit]: authConfigId } } : {}),
  });
  sessions.set(channel, session);
  return session;
}

/** OpenAI-format tool definitions for a channel, optionally narrowed to specific slugs. */
export async function channelTools(cfg, channel, only) {
  const session = await channelSession(cfg, channel);
  const tools = await session.tools();
  return only ? tools.filter((t) => only.includes(t.function?.name)) : tools;
}

/** Execute a tool in the channel's session. Throws on tool-level failure so callers see it. */
export async function execute(cfg, channel, slug, args) {
  const session = await channelSession(cfg, channel);
  const res = await session.execute(slug, args);
  if (res && res.successful === false) throw new Error(res.error || `${slug} failed`);
  return res?.data ?? res;
}

// ---- connections ----
// Always ask for ACTIVE only: the list is paginated (10 per page) and every abandoned Connect Link leaves an
// INITIATED / EXPIRED row that would otherwise push the live account off the first page.
export async function connectedAccount(cfg, toolkit) {
  const res = await composio().connectedAccounts.list({ userIds: [cfg.userId], toolkitSlugs: [toolkit], statuses: ['ACTIVE'] });
  return (res.items ?? [])[0] ?? null;
}

/** { toolkit: true|false } for a list of toolkits, in one request. */
export async function connectedToolkits(cfg, toolkits) {
  const res = await composio().connectedAccounts.list({ userIds: [cfg.userId], toolkitSlugs: toolkits, statuses: ['ACTIVE'] });
  const active = new Set((res.items ?? []).map((a) => String(a.toolkit?.slug ?? a.toolkitSlug ?? '').toLowerCase()));
  return Object.fromEntries(toolkits.map((t) => [t, active.has(t)]));
}

/** True if an auth config still resolves. Custom (bring-your-own-app) configs can be created and then vanish. */
export async function authConfigExists(id) {
  if (!id) return false;
  try {
    await composio().authConfigs.get(id);
    return true;
  } catch {
    return false;
  }
}

/** Remove every active connection for a toolkit. Returns how many were removed. */
export async function disconnectToolkit(cfg, toolkit) {
  const res = await composio().connectedAccounts.list({ userIds: [cfg.userId], toolkitSlugs: [toolkit], statuses: ['ACTIVE'] });
  let removed = 0;
  for (const a of res.items ?? []) {
    await composio().connectedAccounts.delete(a.id);
    removed++;
  }
  resetSessions();
  return removed;
}

/** Start a Connect Link flow; returns { url, wait() }. Pass authConfigId for toolkits without managed auth. */
export async function beginConnect(cfg, toolkit, authConfigId) {
  const req = await composio().toolkits.authorize(cfg.userId, toolkit, authConfigId || undefined);
  return {
    url: req.redirectUrl,
    wait: (ms = 5 * 60 * 1000) => req.waitForConnection(ms),
  };
}

/** Create a custom OAuth2 auth config for X (Composio has no managed X app). */
export async function createXAuthConfig({ clientId, clientSecret, bearerToken }) {
  const ac = await composio().authConfigs.create('twitter', {
    type: 'use_custom_auth',
    authScheme: 'OAUTH2',
    name: 'Jev X app',
    credentials: {
      client_id: clientId,
      client_secret: clientSecret,
      generic_id: bearerToken,
      oauth_redirect_uri: 'https://backend.composio.dev/api/v1/auth-apps/add',
      scopes: 'tweet.read,tweet.write,users.read,offline.access',
    },
  });
  return ac.id;
}

// ---- triggers ----
/** Ids of this user's connected accounts (trigger instances carry connectedAccountId, not userId). */
async function myAccountIds(cfg) {
  const res = await composio().connectedAccounts.list({ userIds: [cfg.userId], statuses: ['ACTIVE'] });
  return new Set((res.items ?? []).map((a) => a.id));
}

export async function ensureTrigger(cfg, slug, triggerConfig) {
  const mineIds = await myAccountIds(cfg);
  const active = await composio().triggers.listActive({ triggerNames: [slug], showDisabled: true });
  const mine = (active.items ?? []).find((t) => mineIds.has(t.connectedAccountId));
  if (mine) {
    if (mine.disabledAt) await composio().triggers.enable(mine.id);
    return mine.id;
  }
  const created = await composio().triggers.create(cfg.userId, slug, { triggerConfig });
  return created.triggerId;
}

/** Best-effort disable; a missing trigger is not an error. */
export async function disableTrigger(id) {
  if (!id) return;
  try {
    await composio().triggers.disable(id);
  } catch {
    /* already gone */
  }
}

export async function listMyTriggers(cfg) {
  const mineIds = await myAccountIds(cfg);
  const active = await composio().triggers.listActive({ showDisabled: true });
  return (active.items ?? []).filter((t) => mineIds.has(t.connectedAccountId));
}

/** Stream trigger events for this user. Resolves once subscribed; keeps the process alive. */
export function subscribe(cfg, onEvent, onError) {
  return composio().triggers.subscribe(onEvent, { userId: cfg.userId }, onError);
}
