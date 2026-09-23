// `jev-orchestrator test "message"`: run one simulated message through Jev and the write agent. Sends nothing.
import { loadEnv } from '../env.js';
import { loadConfig } from '../config.js';
import { handleItem, simulatedItem } from '../pipeline.js';
import { attachConsoleSink } from '../console-sink.js';
import { log, c } from '../ui.js';

export async function test(text, { from = 'email', sender = '' } = {}) {
  loadEnv();
  const cfg = loadConfig();
  if (!text) {
    log('Usage: jev-orchestrator test "the message" [--from email|x|form|slack|discord] [--sender who@example.com]');
    return;
  }
  log(c.dim('Dry run: nothing is sent, nothing is saved to the inbox.\n'));
  attachConsoleSink();
  await handleItem(cfg, simulatedItem(text, { from, sender }), { dryRun: true });
}
