// Write agents. One per bucket, each with exactly the tool it needs.
// In review mode, customer-facing sends are captured and parked in the inbox instead of executed.
import { runAgent } from './llm.js';
import { channelTools, execute, CHANNEL_TOOLS } from './composio.js';
import { readKnowledge, addInboxEntry, appendLog } from './config.js';

// A channel with no way to post (Discord without the bot) gets this instead of a real tool: the draft is captured and
// waits in Needs you for the owner to paste. It is never executed.
export const MANUAL_TOOL = 'JEV_DRAFT_REPLY';
const MANUAL_TOOL_DEF = { type: 'function', function: { name: MANUAL_TOOL, description: 'Hand the reply to the owner, who will paste it into the chat themselves.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'The reply, ready to paste.' } }, required: ['text'] } } };
const SEND_TOOLS = new Set([...Object.values(CHANNEL_TOOLS).flat(), MANUAL_TOOL]);

function persona(cfg) {
  const name = cfg.owner.name || 'the owner';
  return `You write on behalf of ${name}. Business context:\n${readKnowledge('business.md') || '(none)'}\n\nStyle: short, warm, plain language, no corporate filler, no emojis unless the person used them. Never use an em dash or an en dash; write a comma, a full stop or a plain hyphen instead. Close the message with your name on its own line, exactly: ${name}`;
}

// How each bucket may answer. `where` decides which tools it gets.
const AGENTS = {
  faq: {
    label: 'FAQ agent',
    where: 'customer',
    system: (cfg) => `${persona(cfg)}\n\nAnswer the person's question using ONLY the FAQ below. If the FAQ does not cover it, do not invent an answer: say you will check and get back to them.\n\n## FAQ\n${readKnowledge('faq.md') || '(empty)'}`,
  },
  sales: {
    label: 'Sales agent',
    where: 'customer',
    system: (cfg) =>
      `${persona(cfg)}\n\nThis person may become a customer. Reply once: thank them, answer what you can from the FAQ, ask at most one clarifying question, and ${cfg.bookingLink ? `offer this link to book a call: ${cfg.bookingLink}` : 'offer to jump on a quick call'}. Never promise discounts or custom pricing.\n\n## FAQ\n${readKnowledge('faq.md') || '(empty)'}`,
  },
  support: {
    label: 'Support agent',
    where: 'customer',
    system: (cfg) =>
      `${persona(cfg)}\n\nThis is an existing customer with a problem. Reply once: acknowledge it, give the matching steps from the support notes if there are any, and ask for whatever detail is missing (account email, screenshot, when it started). Never promise a refund or a fix date.\n\n## Support notes\n${readKnowledge('support.md') || '(empty)'}`,
  },
  escalate: {
    label: 'Escalation agent',
    where: 'customer',
    alwaysHold: true, // never goes out on its own, even in auto mode
    system: (cfg) =>
      `${persona(cfg)}\n\nThis message is sensitive: anger, a refund or chargeback dispute, legal or press risk, or a security report. Write a careful reply to the person. Take it seriously, apologise for the specific thing that went wrong if there is one, and ask for exactly what you need to look into it. Never promise a refund, a deadline, a policy exception, or any legal position: those are ${cfg.owner.name || 'the owner'}'s to give, and ${cfg.owner.name || 'they'} will read this before it goes out. Keep it short and human.`,
  },
};

/** Can we actually post on this channel right now? Cheap local check, no API call. */
function canPost(cfg, channel) {
  if (channel === 'gmail') return Boolean(cfg.sources.gmail?.enabled);
  if (channel === 'x') return Boolean(cfg.sources.x?.enabled);
  if (channel === 'slack') return Boolean(cfg.sources.slack?.enabled);
  if (channel === 'discord') return cfg.sources.discord?.replyVia === 'bot' && Boolean(cfg.sources.discord?.enabled);
  return false;
}
const DRAFT_ONLY = { channel: 'manual', tools: [MANUAL_TOOL] };

/**
 * Which channel + tools an agent should use for this item.
 * A channel we cannot post on (not connected, or Discord without the bot) falls back to a draft that waits
 * for you, so an unconnected source degrades to "here is the reply" instead of failing.
 */
function route(bucket, item, cfg) {
  const via = (channel, tools) => (canPost(cfg, channel) ? { channel, tools } : DRAFT_ONLY);
  if (item.channel === 'gmail') return via('gmail', ['GMAIL_REPLY_TO_THREAD']);
  if (item.channel === 'x') return via('x', ['TWITTER_CREATION_OF_A_POST']);
  if (item.channel === 'slack') return via('slack', ['SLACK_SEND_MESSAGE']);
  if (item.channel === 'discord') return via('discord', ['DISCORDBOT_CREATE_MESSAGE']);
  if (item.channel === 'form') return item.fromEmail ? via('gmail', ['GMAIL_SEND_EMAIL']) : DRAFT_ONLY;
  throw new Error(`no route for ${item.channel}`);
}

function taskFor(bucket, item, cfg, { channel }) {
  const lines = [`## Message (${item.channel})`, `From: ${item.from}`];
  if (item.subject) lines.push(`Subject: ${item.subject}`);
  if (item.url) lines.push(`Link: ${item.url}`);
  lines.push('', item.text.slice(0, 6000), '', '## How to send');
  if (channel === 'manual') {
    lines.push(`Call ${MANUAL_TOOL} with the reply in text, written for ${item.channel}. Short, no subject line, no sign-off block.`);
  } else if (item.channel === 'gmail') {
    lines.push(`Call GMAIL_REPLY_TO_THREAD with thread_id="${item.reply.threadId}", recipient_email="${item.reply.to}", user_id="me", is_html=false. Plain text body only.`);
  } else if (item.channel === 'x') {
    lines.push(`Call TWITTER_CREATION_OF_A_POST with reply_in_reply_to_tweet_id="${item.reply.tweetId}". Keep text under 260 characters. Do not start with their handle; X adds it.`);
  } else if (item.channel === 'form') {
    lines.push(`Call GMAIL_SEND_EMAIL with recipient_email="${item.reply.to}", user_id="me", a short subject, is_html=false.`);
  } else if (item.channel === 'slack') {
    lines.push(`Call SLACK_SEND_MESSAGE with channel="${item.reply.channel}", thread_ts="${item.reply.ts}", and your reply in markdown_text. Slack tone: short, no subject line, no sign-off block, plain Markdown only.`);
  } else if (item.channel === 'discord') {
    lines.push(`Call DISCORDBOT_CREATE_MESSAGE with channel_id="${item.reply.channelId}", message_reference={"message_id":"${item.reply.messageId}"}, and your reply in content (under 1900 characters). Chat tone: short, no subject line, no sign-off block.`);
  }
  lines.push(
    bucket === 'escalate'
      ? 'Make exactly one tool call, then stop. After the tool result, answer with one short sentence on why this one needs a person to look at it before it goes out.'
      : 'Make exactly one tool call, then stop. After the tool result, answer with one sentence describing what you sent.',
  );
  return lines.join('\n');
}

/**
 * Run the write agent for a bucket.
 * Returns { outcome: 'sent'|'held'|'nothing', calls, note, inboxId? }
 */
export async function runWriteAgent(cfg, bucket, item, decision, { dryRun = false } = {}) {
  const agent = AGENTS[bucket];
  if (!agent) throw new Error(`no write agent for ${bucket}`);
  const target = route(bucket, item, cfg);
  const manual = target.channel === 'manual';
  const tools = manual ? [MANUAL_TOOL_DEF] : await channelTools(cfg, target.channel, target.tools);
  if (!tools.length) throw new Error(`no tools available for ${target.channel} (is it connected? run jev-orchestrator setup)`);

  // A simulated or demo message never executes a tool, not even the escalation email to the owner: the UI
  // promises nothing is sent to anyone, and the owner is someone. Its draft is parked in needs-you instead.
  const hold = dryRun || manual || item.test || agent.alwaysHold || (cfg.mode !== 'auto' && agent.where === 'customer');
  const held = [];
  const onToolCall = async (name, args) => {
    if (!SEND_TOOLS.has(name)) return { successful: false, error: `tool ${name} is not allowed` };
    if (hold) {
      held.push({ channel: target.channel, tool: name, args });
      return { successful: true, note: dryRun ? 'dry run: not sent' : 'queued for owner approval' };
    }
    return await execute(cfg, target.channel, name, args);
  };

  const result = await runAgent({ model: cfg.model, system: agent.system(cfg), user: taskFor(bucket, item, cfg, target), tools, onToolCall });

  if (held.length) {
    if (dryRun) return { outcome: 'nothing', calls: held, note: result.text };
    const entry = addInboxEntry({ kind: 'held', bucket, item, decision, action: held[0], note: result.text });
    appendLog({ event: 'held', bucket, itemId: item.id, inboxId: entry.id });
    return { outcome: 'held', calls: held, note: result.text, inboxId: entry.id };
  }
  const sent = result.calls.filter((c) => SEND_TOOLS.has(c.name));
  appendLog({ event: sent.length ? 'sent' : 'agent_no_action', bucket, itemId: item.id, calls: sent.map((c) => c.name) });
  return { outcome: sent.length ? 'sent' : 'nothing', calls: sent, note: result.text };
}

/** Send a previously held action as-is (or with an edited body). */
export async function sendHeld(cfg, entry, editedText) {
  const { channel, tool, args } = entry.action;
  if (tool === MANUAL_TOOL) throw new Error('nothing can post this for you: copy it in, then mark it done');
  // There is no real recipient behind a composed or scripted item, so the send completes without calling the
  // tool. The audit log keeps the distinction even though the screen does not.
  if (entry.item?.test) {
    appendLog({ event: 'sent', bucket: entry.bucket, itemId: entry.item.id, calls: [tool], inboxId: entry.id, edited: editedText != null, executed: false });
    return { delivered: false };
  }
  const finalArgs = { ...args };
  if (editedText != null) {
    if (tool === 'TWITTER_CREATION_OF_A_POST') finalArgs.text = editedText;
    else if (tool === 'GMAIL_REPLY_TO_THREAD') finalArgs.message_body = editedText;
    else if (tool === 'GMAIL_SEND_EMAIL') finalArgs.body = editedText;
    else if (tool === 'SLACK_SEND_MESSAGE') { finalArgs.markdown_text = editedText; delete finalArgs.text; delete finalArgs.blocks; }
    else if (tool === 'DISCORDBOT_CREATE_MESSAGE') finalArgs.content = editedText;
  }
  const data = await execute(cfg, channel, tool, finalArgs);
  appendLog({ event: 'sent', bucket: entry.bucket, itemId: entry.item.id, calls: [tool], inboxId: entry.id, edited: editedText != null });
  return data;
}

/** The text a held action would send, for display. */
export function heldBody(action) {
  const a = action.args ?? {};
  return a.message_body ?? a.body ?? a.markdown_text ?? a.content ?? a.text ?? JSON.stringify(a, null, 2);
}

export const AGENT_LABELS = Object.fromEntries(Object.entries(AGENTS).map(([k, v]) => [k, v.label]));
