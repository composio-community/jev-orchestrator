// The source registry: everything the setup wizard, the server and the UI need to know about each inbound channel.
// A source is either trigger-based (Composio pushes events over the subscription) or polled (X, which has no trigger type).

export const SOURCES = {
  gmail: {
    label: 'Gmail',
    kind: 'trigger',
    toolkits: ['gmail'],
    fields: [],
    trigger: () => ['GMAIL_NEW_GMAIL_MESSAGE', { labelIds: 'INBOX', interval: 2 }],
  },
  typeform: {
    label: 'Typeform',
    kind: 'trigger',
    toolkits: ['typeform'],
    fields: [{ key: 'formId', label: 'Form ID', hint: 'The last part of the form link: form.typeform.com/to/x2DfMTz9 → x2DfMTz9', required: true }],
    trigger: (s) => ['TYPEFORM_NEW_RESPONSE', { form_id: s.formId }],
  },
  slack: {
    label: 'Slack',
    kind: 'trigger',
    toolkits: ['slack'],
    fields: [{ key: 'channels', label: 'Channel IDs to watch', hint: 'Comma-separated, e.g. C0123ABCD. Empty means every channel the app is in, plus DMs.', list: true }],
    trigger: () => ['SLACK_RECEIVE_MESSAGE', {}],
  },
  discord: {
    label: 'Discord',
    kind: 'trigger',
    toolkits: ['discord'],
    optional: ['discordbot'], // only needed when replyVia = bot
    fields: [
      { key: 'channelId', label: 'Channel ID', hint: 'In Discord: Settings → Advanced → Developer Mode, then right-click the channel → Copy Channel ID.', required: true },
      { key: 'replyVia', label: 'Replies', hint: 'Drafts always wait in Needs you. With the bot connected they can be posted from there; otherwise you copy and paste.', options: [{ value: 'manual', label: 'I paste them myself' }, { value: 'bot', label: 'Composio bot posts them' }] },
    ],
    trigger: (s) => ['DISCORD_NEW_MESSAGE_TRIGGER', { channel_id: s.channelId, interval: 2 }],
  },
  x: {
    label: 'X',
    kind: 'poll',
    toolkits: ['twitter'],
    fields: [{ key: 'handle', label: 'Your X handle', hint: 'Without the @. Mentions of it are polled every 5 minutes.', required: true }],
    trigger: null,
  },
};

export const TOOLKIT_LABELS = {
  gmail: 'Gmail',
  typeform: 'Typeform',
  slack: 'Slack',
  discord: 'Discord · your account (reads the channel)',
  discordbot: 'Discord bot · optional, posts replies for you',
  twitter: 'X',
};

/** Trigger slug → normalizer name, for the engine's dispatch. */
export const TRIGGER_SLUGS = {
  GMAIL_NEW_GMAIL_MESSAGE: 'gmail',
  TYPEFORM_NEW_RESPONSE: 'typeform',
  SLACK_RECEIVE_MESSAGE: 'slack',
  DISCORD_NEW_MESSAGE_TRIGGER: 'discord',
};

/** Required fields that are still empty for a source, as labels. */
export function missingFields(id, src) {
  if (!SOURCES[id]) return [];
  return SOURCES[id].fields.filter((f) => f.required && !String(src?.[f.key] ?? '').trim()).map((f) => f.label);
}

/** Toolkits a source needs for its current settings (optional ones only when the settings ask for them). */
export function requiredToolkits(id, src) {
  const def = SOURCES[id];
  if (!def) return [];
  const extra = id === 'discord' && src?.replyVia === 'bot' ? def.optional : [];
  return [...def.toolkits, ...(extra ?? [])];
}

/** The registry as the UI sees it (no functions). */
export function publicSources() {
  return Object.fromEntries(Object.entries(SOURCES).map(([id, s]) => [id, { id, label: s.label, kind: s.kind, toolkits: s.toolkits, optional: s.optional ?? [], toolkitLabels: Object.fromEntries([...s.toolkits, ...(s.optional ?? [])].map((t) => [t, TOOLKIT_LABELS[t]])), fields: s.fields }]));
}

/** Parse a field value coming from the UI or the wizard into what the config stores. */
export function parseField(id, key, value) {
  const f = SOURCES[id]?.fields.find((x) => x.key === key);
  if (!f) return undefined;
  if (f.list) return String(value ?? '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const v = String(value ?? '').trim();
  if (f.options) return f.options.some((o) => o.value === v) ? v : f.options[0].value;
  return key === 'handle' ? v.replace(/^@/, '') : v;
}
