// One message in, one decision out. Emits events on the bus; the console sink and the TUI render them.
import { classify } from './jev.js';
import { runWriteAgent, heldBody } from './agents.js';
import { prefilter, describe } from './normalize.js';
import { addInboxEntry, appendLog } from './config.js';
import { emit } from './bus.js';

/**
 * @returns {Promise<{bucket:string, outcome:string, inboxId?:string}>}
 */
export async function handleItem(cfg, item, { dryRun = false } = {}) {
  emit('item', { item });

  const skip = prefilter(item, cfg);
  if (skip) {
    appendLog({ event: 'prefiltered', itemId: item.id, reason: skip });
    emit('decided', { item, decision: { bucket: 'ignore', reason: `skipped: ${skip}`, prefiltered: true } });
    return { bucket: 'ignore', outcome: 'skipped' };
  }

  let decision;
  try {
    decision = await classify(cfg, item);
  } catch (err) {
    appendLog({ event: 'classify_error', itemId: item.id, error: String(err.message) });
    const entry = dryRun ? { id: '(dry run)' } : addInboxEntry({ kind: 'needs_you', bucket: 'unsure', item, decision: { reason: 'Jev could not decide: ' + err.message } });
    emit('decided', { item, decision: { bucket: 'unsure', reason: 'Jev could not decide: ' + err.message, error: true } });
    emit('action', { item, bucket: 'unsure', outcome: 'needs_you', inboxId: entry.id });
    return { bucket: 'unsure', outcome: 'needs_you', inboxId: entry.id };
  }
  appendLog({ event: 'decided', itemId: item.id, ...decision, probabilities: undefined });
  emit('decided', { item, decision });

  if (decision.bucket === 'ignore') {
    emit('action', { item, bucket: 'ignore', outcome: 'ignored' });
    return { bucket: 'ignore', outcome: 'ignored' };
  }
  if (decision.bucket === 'unsure') {
    const entry = dryRun ? { id: '(dry run)' } : addInboxEntry({ kind: 'needs_you', bucket: 'unsure', item, decision });
    emit('action', { item, bucket: 'unsure', outcome: 'needs_you', inboxId: entry.id });
    return { bucket: 'unsure', outcome: 'needs_you', inboxId: entry.id };
  }

  emit('agent_start', { item, bucket: decision.bucket });
  try {
    const r = await runWriteAgent(cfg, decision.bucket, item, decision, { dryRun });
    const preview = r.calls[0] ? heldBody(r.calls[0]) : '';
    emit('action', { item, bucket: decision.bucket, outcome: r.outcome, inboxId: r.inboxId, preview, note: r.note, call: r.calls[0] });
    return { bucket: decision.bucket, outcome: r.outcome, inboxId: r.inboxId };
  } catch (err) {
    appendLog({ event: 'agent_error', bucket: decision.bucket, itemId: item.id, error: String(err.message) });
    const entry = dryRun ? { id: '(dry run)' } : addInboxEntry({ kind: 'needs_you', bucket: decision.bucket, item, decision: { ...decision, reason: `agent failed: ${err.message}` } });
    emit('action', { item, bucket: decision.bucket, outcome: 'error', error: err.message, inboxId: entry.id });
    return { bucket: decision.bucket, outcome: 'error', inboxId: entry.id };
  }
}

/** Build a simulated item (used by `test` and by the TUI prompt). Test items are never sent anywhere. */
export function simulatedItem(text, { from = 'email', sender = '' } = {}) {
  const id = 'test:' + Date.now();
  if (from === 'x') return { id, channel: 'x', from: sender || '@someone', fromEmail: '', subject: '', text, url: '', reply: { tweetId: '0', handle: sender || '@someone' }, test: true };
  if (from === 'slack') return { id, channel: 'slack', from: sender || 'Someone', fromEmail: '', subject: '', text, url: '', authorId: '', botId: '', reply: { channel: 'C0000000000', ts: '0.0' }, test: true };
  if (from === 'discord') return { id, channel: 'discord', from: sender || 'someone', fromEmail: '', subject: '', text, url: '', authorId: '', reply: { channelId: '0', messageId: '0' }, test: true };
  if (from === 'form') {
    const email = sender || 'lead@example.com';
    return { id, channel: 'form', from: email, fromEmail: email, subject: 'Form: test', text, url: '', reply: { to: email }, test: true };
  }
  const email = sender || 'someone@example.com';
  return { id, channel: 'gmail', from: email, fromEmail: email, subject: text.split('\n')[0].slice(0, 60), text, url: '', reply: { threadId: '0000000000000000', messageId: '0', to: email }, test: true };
}

export { describe };
