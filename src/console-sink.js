// Prints bus events to the terminal for the one-shot commands (start --headless, test).
import { on } from './bus.js';
import { c, bucketTag, truncate, log, indent } from './ui.js';
import { describe } from './normalize.js';
import { pct } from './jev.js';

const stamp = () => c.dim(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

export function attachConsoleSink() {
  return on((e) => {
    if (e.type === 'item') log(`${stamp()} ${c.bold(describe(e.item))} ${c.dim('·')} ${truncate(e.item.subject || e.item.text, 60)}`);
    else if (e.type === 'decided') {
      const d = e.decision;
      const conf = d.confidence != null ? c.dim(`${pct(d.confidence)}`) : '';
      log(`   ${bucketTag(d.bucket)} ${conf} ${c.dim(d.reason ?? '')}${d.ms ? c.dim(` · ${(d.ms / 1000).toFixed(1)}s`) : ''}`);
    } else if (e.type === 'action') {
      if (e.outcome === 'ignored' || e.outcome === 'skipped') return;
      if (e.outcome === 'needs_you') log(`   ${c.yellow('→ needs you')} ${c.dim('(jev-orchestrator inbox)')}`);
      else if (e.outcome === 'sent') log(`   ${c.green('→ sent')} ${c.dim(truncate(e.preview, 80))}`);
      else if (e.outcome === 'held') log(`   ${c.magenta('→ drafted, waiting for your OK')} ${c.dim('(inbox)')}\n${indent(c.dim(e.preview), '     ')}`);
      else if (e.outcome === 'nothing' && e.preview) log(`   ${c.magenta('→ would send')}\n${indent(c.dim(e.preview), '     ')}`);
      else if (e.outcome === 'nothing') log(`   ${c.yellow('→ agent did nothing:')} ${truncate(e.note, 120)}`);
      else if (e.outcome === 'error') log(`   ${c.red('→ agent failed:')} ${e.error}`);
    }
  });
}
