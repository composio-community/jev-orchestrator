import { loadEnv } from '../env.js';
import { loadConfig, configExists, loadInbox } from '../config.js';
import { connectedToolkits, listMyTriggers } from '../composio.js';
import { SOURCES, TOOLKIT_LABELS } from '../sources/index.js';
import { ok, warn, fail, log, c, title } from '../ui.js';

export async function status() {
  loadEnv();
  if (!configExists()) {
    fail('Not set up yet. Run `jev-orchestrator setup`.');
    return;
  }
  const cfg = loadConfig();
  title('Jev status');
  log(`mode: ${c.bold(cfg.mode)}   model: ${cfg.model}   owner: ${cfg.owner.name || '?'} <${cfg.owner.email || '?'}>`);
  log(`keys: Composio ${process.env.COMPOSIO_API_KEY ? c.green('ok') : c.red('missing')}, OpenRouter ${process.env.OPENROUTER_API_KEY ? c.green('ok') : c.red('missing')}`);
  log('');
  let accounts = {};
  try {
    accounts = await connectedToolkits(cfg, [...new Set(Object.values(SOURCES).flatMap((s) => s.toolkits))]);
  } catch (err) {
    fail(`Composio: ${err.message}`);
  }
  for (const [id, def] of Object.entries(SOURCES)) {
    const src = cfg.sources[id];
    const label = def.label.padEnd(9);
    if (!src.enabled) {
      const linked = def.toolkits.filter((t) => accounts[t]);
      log(`${c.dim('·')} ${label} ${c.dim(linked.length ? `off (${linked.map((t) => TOOLKIT_LABELS[t]).join(', ')} connected)` : 'off')}`);
      continue;
    }
    const missing = def.toolkits.filter((t) => !accounts[t]);
    if (!missing.length) ok(`${label} connected${src.triggerId ? c.dim(`  trigger ${src.triggerId}`) : ''}${src.handle ? c.dim(`  @${src.handle}`) : ''}${src.channelId ? c.dim(`  channel ${src.channelId}`) : ''}${src.channels?.length ? c.dim(`  channels ${src.channels.join(',')}`) : ''}`);
    else warn(`${label} enabled but ${missing.map((t) => TOOLKIT_LABELS[t]).join(', ')} not connected, open the UI or run \`jev setup\``);
  }
  try {
    const triggers = await listMyTriggers(cfg);
    const off = triggers.filter((t) => t.disabledAt);
    if (off.length) warn(`${off.length} trigger(s) disabled on Composio: ${off.map((t) => t.triggerName).join(', ')}`);
  } catch {
    /* non-fatal */
  }
  const inbox = loadInbox();
  const open = inbox.filter((e) => e.status === 'open');
  log('');
  log(`inbox: ${open.length ? c.yellow(`${open.length} waiting`) : c.green('empty')}  ${c.dim(`(${inbox.length} total, log in jev/log.jsonl)`)}`);
}
