// Types for what src/server.js sends, plus the handful of POSTs the page makes.
export type Bucket = 'ignore' | 'faq' | 'sales' | 'support' | 'escalate' | 'unsure';
export const BUCKETS: Bucket[] = ['ignore', 'faq', 'sales', 'support', 'escalate', 'unsure'];
export type Channel = 'gmail' | 'form' | 'x' | 'slack' | 'discord';
export type SourceId = 'gmail' | 'typeform' | 'slack' | 'discord' | 'x';

export interface Item {
  id: string;
  channel: Channel;
  from: string;
  fromEmail?: string;
  subject?: string;
  text: string;
  test?: boolean;
  demo?: boolean; // part of a scripted demo run: flows from its real source node
}
export interface Decision {
  bucket: Bucket;
  confidence?: number;
  reason?: string;
  original?: string;
  prefiltered?: boolean;
  manual?: boolean;
  ms?: number;
  probabilities?: Record<string, number>;
}
export interface InboxEntry {
  id: string;
  ts: string;
  kind: 'held' | 'needs_you';
  bucket: Bucket;
  item: Item;
  reason: string;
  note: string; // the agent's own line on why this one is waiting
  draft: string;
  tool: string;
  to: string;
  manual?: boolean; // nothing can post it: the owner copies it into the chat and marks it done
  channel?: Channel;
  suggested?: Bucket | ''; // Jev's next-best bucket for something it could not decide
}
export interface Trigger { id: string; name: string; disabled: boolean; toolkit: string }
export interface SourceConfig { enabled: boolean; triggerId?: string; formId?: string; handle?: string; authConfigId?: string; pollMinutes?: number; channels?: string[]; channelId?: string; selfId?: string; selfHandle?: string; replyVia?: 'manual' | 'bot' }
export interface SourceField { key: string; label: string; hint?: string; required?: boolean; list?: boolean; options?: { value: string; label: string }[] }
export interface SourceMeta { id: SourceId; label: string; kind: 'trigger' | 'poll'; toolkits: string[]; optional: string[]; toolkitLabels: Record<string, string>; fields: SourceField[] }
export interface Config {
  mode: 'review' | 'auto';
  owner?: { name?: string; email?: string };
  jevModel: string;
  model: string;
  confidenceFloor: number;
  sources: Record<SourceId, SourceConfig>;
  bookingLink?: string;
}
export interface Stats {
  stream?: 'live' | 'connecting' | 'error' | 'idle' | string;
  connected?: Partial<Record<SourceId, boolean | null>>;
  accounts?: Record<string, boolean>; // toolkit slug → has an active connected account
  accountsError?: string;
  pending?: Record<string, boolean>; // toolkit slug → a Connect Link is open, waiting for sign-in
  triggers?: Trigger[];
  triggersError?: string;
  demo?: { running: boolean; index?: number; total: number };
  watchedBy?: number; // another process holds the watcher lock, on this port
}
export interface Snapshot {
  configured: boolean;
  config: Config;
  watching: string[];
  xAppInEnv?: boolean; // X app credentials are present in .env, so it can be saved without typing
  stats: Stats;
  sources: Record<SourceId, SourceMeta>;
  criteria: Record<string, string>;
  buckets: string[];
  agents: Record<string, string>;
  inbox: InboxEntry[];
  recent: PipelineEvent[];
}

export type PipelineEvent =
  | ({ type: 'snapshot' } & Snapshot)
  | { type: 'stats'; stats: Stats }
  | { type: 'config'; config: Config }
  | { type: 'error'; message: string }
  | { type: 'note'; message: string }
  | { type: 'stream'; status: 'connected' | 'reconnecting' | string; in?: number }
  | { type: 'demo'; running: boolean; index?: number; total: number }
  | { type: 'inbox'; action: 'sent' | 'routed' | 'dropped' | 'ignored' | string; item: Item; bucket?: Bucket }
  | { type: 'item'; item: Item }
  | { type: 'decided'; item: Item; decision: Decision }
  | { type: 'agent_start'; item: Item; bucket: Bucket }
  | { type: 'action'; item: Item; bucket: Bucket; outcome: 'sent' | 'held' | 'needs_you' | 'error' | 'nothing'; preview?: string; error?: string; note?: string };

export async function post<T = { error?: string }>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return r.json();
}
export const getSnapshot = () => fetch('/snapshot').then((r) => r.json() as Promise<Snapshot>);
export const getKnowledge = () => fetch('/knowledge').then((r) => r.json() as Promise<Record<string, string>>);

export const describe = (item: Item) =>
  item.channel === 'gmail' ? `email from ${item.from}`
    : item.channel === 'x' ? `X mention by ${item.from}`
    : item.channel === 'slack' ? `Slack message from ${item.from}`
    : item.channel === 'discord' ? `Discord message from ${item.from}`
    : `form lead from ${item.from}`;
export const pct = (v?: number) => `${Math.round((Number(v) || 0) * 100)}%`;
