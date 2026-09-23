// `jev-orchestrator inbox`: the needs-you pile. Two kinds of entries:
//   held      : a write agent drafted a reply; you send, edit, or drop it.
//   needs_you : Jev was unsure (or something failed); you pick a bucket or dismiss.
import { loadEnv } from '../env.js';
import { loadConfig, loadInbox, updateInboxEntry, appendLog } from '../config.js';
import { runWriteAgent, sendHeld, heldBody } from '../agents.js';
import { describe } from '../normalize.js';
import { ask, choose, ok, warn, fail, log, c, title, indent, hr, closePrompt, bucketTag } from '../ui.js';

export async function inbox() {
  loadEnv();
  const cfg = loadConfig();
  const open = loadInbox().filter((e) => e.status === 'open');
  if (!open.length) {
    ok('Inbox is empty. Nothing needs you.');
    return;
  }
  title(`${open.length} thing${open.length === 1 ? '' : 's'} need${open.length === 1 ? 's' : ''} you`);

  for (let i = 0; i < open.length; i++) {
    const e = open[i];
    log(`\n${c.bold(`[${i + 1}/${open.length}]`)} ${describe(e.item)}  ${c.dim(new Date(e.ts).toLocaleString())}`);
    if (e.item.subject) log(`  ${c.dim('subject:')} ${e.item.subject}`);
    if (e.item.url) log(`  ${c.dim('link:')} ${e.item.url}`);
    log(indent(c.dim(e.item.text.slice(0, 800) + (e.item.text.length > 800 ? '…' : ''))));
    hr();

    if (e.kind === 'held') {
      log(`${bucketTag(e.bucket)} ${c.dim(e.decision?.reason ?? '')}`);
      log(`${c.magenta('Drafted reply:')}\n${indent(heldBody(e.action))}`);
      const k = await choose('Send it?', { s: 'send', e: 'edit then send', d: 'drop', k: 'keep for later', q: 'quit' });
      if (k === 'q') break;
      if (k === 'k') continue;
      if (k === 'd') {
        updateInboxEntry(e.id, { status: 'dropped' });
        appendLog({ event: 'dropped', inboxId: e.id, itemId: e.item.id });
        warn('Dropped.');
        continue;
      }
      let text;
      if (k === 'e') {
        log(c.dim('Type the new reply. End with an empty line.'));
        text = await multiline();
        if (!text.trim()) {
          warn('Empty, keeping the draft unsent.');
          continue;
        }
      }
      try {
        await sendHeld(cfg, e, text);
        updateInboxEntry(e.id, { status: 'sent', sentText: text ?? heldBody(e.action) });
        ok('Sent.');
      } catch (err) {
        fail(`Send failed: ${err.message}`);
      }
      continue;
    }

    // needs_you
    log(`${bucketTag('unsure')} ${c.dim(e.decision?.reason ?? '')}`);
    const k = await choose('What is it?', { f: 'faq', s: 'sales', u: 'support', e: 'escalate', i: 'ignore', k: 'keep for later', q: 'quit' });
    if (k === 'q') break;
    if (k === 'k') continue;
    if (k === 'i') {
      updateInboxEntry(e.id, { status: 'ignored' });
      appendLog({ event: 'manual_ignore', inboxId: e.id, itemId: e.item.id });
      ok('Ignored.');
      continue;
    }
    const bucket = { f: 'faq', s: 'sales', u: 'support', e: 'escalate' }[k];
    try {
      const r = await runWriteAgent(cfg, bucket, e.item, { ...e.decision, bucket, reason: 'you chose ' + bucket });
      updateInboxEntry(e.id, { status: 'routed', routedTo: bucket, result: r.outcome });
      if (r.outcome === 'sent') ok(`${bucket} agent sent it.`);
      else if (r.outcome === 'held') ok(`${bucket} agent drafted a reply. It is now at the end of this inbox.`);
      else warn(`${bucket} agent did nothing: ${r.note}`);
    } catch (err) {
      fail(`${bucket} agent failed: ${err.message}`);
    }
  }
  closePrompt();
}

async function multiline() {
  const lines = [];
  for (;;) {
    const l = await ask('');
    if (!l) break;
    lines.push(l);
  }
  return lines.join('\n');
}
