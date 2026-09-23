// `jev-orchestrator start`: headless watcher (no TUI). Prints every decision as a line.
import { loadEnv } from '../env.js';
import { loadConfig, configExists, loadInbox } from '../config.js';
import { startEngine, watching } from '../engine.js';
import { attachConsoleSink } from '../console-sink.js';
import { on } from '../bus.js';
import { ok, fail, warn, log, c, hr } from '../ui.js';

export async function start({ dryRun = false } = {}) {
  loadEnv();
  if (!configExists()) {
    fail('Not set up yet. Run `jev-orchestrator setup` first.');
    process.exit(1);
  }
  const cfg = loadConfig();
  const w = watching(cfg);
  if (!w.length) {
    fail('Nothing to watch. Run `jev-orchestrator setup` and connect at least one source.');
    process.exit(1);
  }
  log(c.bold('\nJev Orchestrator is on.'));
  log(`  watching : ${w.join(', ')}`);
  log(`  mode     : ${cfg.mode === 'auto' ? c.green('auto (replies go out immediately)') : c.magenta('review (replies wait in the inbox)')}`);
  log(`  filter   : ${cfg.jevModel}   writers: ${cfg.model}`);
  if (dryRun) log(`  ${c.yellow('DRY RUN  : classifying only, nothing is sent or saved to the inbox')}`);
  const open = loadInbox().filter((e) => e.status === 'open').length;
  if (open) log(`  inbox    : ${c.yellow(`${open} waiting for you`)} ${c.dim('→ jev-orchestrator inbox')}`);
  hr();
  attachConsoleSink();
  on((e) => {
    if (e.type === 'error') fail(e.message);
    else if (e.type === 'note') log(c.dim('  ' + e.message));
    else if (e.type === 'stream') ok('Connected to Composio event stream');
  });
  await startEngine(cfg, { dryRun });
  setInterval(() => {}, 1 << 30);
  process.on('SIGINT', () => {
    log(c.dim('\nStopped. Held replies stay in the inbox.'));
    process.exit(0);
  });
}
