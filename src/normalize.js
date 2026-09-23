// Turn whatever a source sends into one flat shape Jev can read:
// { id, channel: 'gmail'|'x'|'form'|'slack'|'discord', from, fromEmail, subject, text, url, reply: {...what a write agent needs to answer...} }

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'", mdash: '-', ndash: '-', hellip: '…', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d' };

/**
 * Readable text out of an HTML email body. Marketing mail is often HTML-only, and passing the raw markup on
 * would fill the screen with tags, waste tokens, and give Jev almost nothing to read.
 */
export function htmlToText(input) {
  const str = String(input ?? '');
  // Only treat this as markup on a strong signal: a closing tag, a doctype, or a <br>. A loose "looks like a
  // tag" test eats plain text such as "5 <b and 3> 1", silently deleting what sits between the brackets.
  if (!/<\/[a-z][a-z0-9]*\s*>|<!doctype|<br\s*\/?>/i.test(str)) return str.trim();
  return str
    .replace(/<(script|style|head|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      const key = code.toLowerCase();
      if (ENTITIES[key]) return ENTITIES[key];
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16) || 32);
      if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)) || 32);
      return ' ';
    })
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1') // tags become spaces, which would otherwise leave "is Pro ?"
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function fromGmail(payload) {
  const p = payload ?? {};
  const sender = String(p.sender ?? '');
  const email = (sender.match(/<([^>]+)>/)?.[1] ?? sender).trim().toLowerCase();
  return {
    id: 'gmail:' + (p.message_id ?? p.id ?? ''),
    channel: 'gmail',
    from: sender,
    fromEmail: email,
    subject: String(p.subject ?? ''),
    text: htmlToText(p.message_text ?? p.preview?.body ?? p.snippet ?? '').slice(0, 8000),
    url: p.thread_id ? `https://mail.google.com/mail/u/0/#inbox/${p.thread_id}` : '',
    reply: { threadId: p.thread_id ?? '', messageId: p.message_id ?? '', to: email },
  };
}

export function fromTypeform(payload) {
  const fr = payload?.form_response ?? payload ?? {};
  const fields = new Map((fr.definition?.fields ?? []).map((f) => [f.id, f]));
  const lines = [];
  let email = '';
  let name = '';
  for (const a of fr.answers ?? []) {
    const def = fields.get(a.field?.id) ?? {};
    const q = def.title ?? a.field?.ref ?? a.field?.id ?? 'field';
    let v = a[a.type];
    if (a.type === 'choice') v = a.choice?.label;
    if (a.type === 'choices') v = (a.choices?.labels ?? []).join(', ');
    if (a.type === 'email' && !email) email = String(v ?? '').toLowerCase();
    if (/name/i.test(q) && !name) name = String(v ?? '');
    lines.push(`${q}: ${v ?? ''}`);
  }
  const hidden = Object.entries(fr.hidden ?? {}).map(([k, v]) => `${k}: ${v}`);
  return {
    id: 'form:' + (payload?.event_id ?? fr.token ?? ''),
    channel: 'form',
    from: name || email || 'form submission',
    fromEmail: email,
    subject: `Form: ${fr.definition?.title ?? 'lead'}`,
    text: [...lines, ...hidden].join('\n'),
    url: '',
    reply: { to: email },
  };
}

/** One tweet from TWITTER_RECENT_SEARCH data.data[], with users from includes. */
export function fromTweet(tweet, usersById = {}) {
  const u = usersById[tweet.author_id] ?? {};
  const handle = u.username ? '@' + u.username : tweet.author_id;
  return {
    id: 'x:' + tweet.id,
    channel: 'x',
    from: handle,
    fromEmail: '',
    subject: '',
    text: String(tweet.text ?? ''),
    url: u.username ? `https://x.com/${u.username}/status/${tweet.id}` : '',
    reply: { tweetId: tweet.id, handle },
  };
}

/** One SLACK_RECEIVE_MESSAGE event. `name` is the sender's display name when the engine could resolve it. */
export function fromSlack(payload, { name = '' } = {}) {
  const p = payload ?? {};
  const fromAttachments = (p.attachments ?? []).map((a) => a.text ?? a.fallback ?? '').filter(Boolean).join('\n');
  return {
    id: 'slack:' + (p.channel ?? '') + ':' + (p.ts ?? ''),
    channel: 'slack',
    from: name || (p.user ? `<@${p.user}>` : 'someone'),
    fromEmail: '',
    subject: '',
    text: htmlToText(p.text || fromAttachments || '').slice(0, 8000),
    url: '',
    authorId: p.user ?? '',
    botId: p.bot_id ?? '',
    channelType: p.channel_type ?? '',
    reply: { channel: p.channel ?? '', ts: p.thread_ts ?? p.ts ?? '' },
  };
}

/** One DISCORD_NEW_MESSAGE_TRIGGER event. */
export function fromDiscord(payload) {
  const m = payload?.message ?? payload ?? {};
  return {
    id: 'discord:' + (m.message_id ?? ''),
    channel: 'discord',
    from: m.username || m.author_id || 'someone',
    fromEmail: '',
    subject: '',
    text: htmlToText(m.content ?? '').slice(0, 8000),
    url: '',
    authorId: m.author_id ?? '',
    reply: { channelId: m.channel_id ?? '', messageId: m.message_id ?? '' },
  };
}

/** Skip obvious machines before spending a model call. Returns a reason string or null. */
export function prefilter(item, cfg) {
  const e = item.fromEmail;
  if (item.channel === 'gmail') {
    // The connected mailbox itself: a reply we send can land back in the inbox, and answering it would loop.
    if (e && cfg.sources.gmail?.selfEmail && e === cfg.sources.gmail.selfEmail.toLowerCase()) return 'this mailbox';
    if (e && cfg.owner.email && e === cfg.owner.email.toLowerCase()) return 'your own address';
    if (/(^|[.\-_])(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|mailer[-_.]?daemon|postmaster|bounce)/i.test(e)) return 'automated sender';
    if (/^(re: )?(unsubscribe|out of office|automatic reply)/i.test(item.subject)) return 'auto-reply';
  }
  if (item.channel === 'x' && cfg.sources.x.handle && item.from.toLowerCase() === '@' + cfg.sources.x.handle.toLowerCase()) return 'your own post';
  if (item.channel === 'slack') {
    const s = cfg.sources.slack ?? {};
    if (item.botId) return 'bot message';
    if (s.selfId && item.authorId === s.selfId) return 'your own message';
    if (s.channels?.length && !s.channels.includes(item.reply?.channel)) return 'channel not watched';
  }
  if (item.channel === 'discord' && cfg.sources.discord?.selfId && item.authorId === cfg.sources.discord.selfId) return 'your own message';
  if (!item.text.trim()) return 'empty message';
  return null;
}

export function describe(item) {
  if (item.channel === 'gmail') return `email from ${item.from}`;
  if (item.channel === 'x') return `X mention by ${item.from}`;
  if (item.channel === 'slack') return `Slack message from ${item.from}`;
  if (item.channel === 'discord') return `Discord message from ${item.from}`;
  return `form lead from ${item.from}`;
}
