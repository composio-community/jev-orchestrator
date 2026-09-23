import { loadConfig, saveConfig } from '../config.js';
import { ok, fail, log, c } from '../ui.js';

export function mode(value) {
  const cfg = loadConfig();
  if (!value) {
    log(`mode is ${c.bold(cfg.mode)}. ${c.dim('`jev-orchestrator mode auto` sends replies immediately; `jev-orchestrator mode review` holds them for you.')}`);
    return;
  }
  if (!['auto', 'review'].includes(value)) {
    fail('mode must be "auto" or "review"');
    return;
  }
  cfg.mode = value;
  saveConfig(cfg);
  ok(value === 'auto' ? 'Auto mode: FAQ, sales and support replies go out without asking.' : 'Review mode: every customer-facing reply waits in `jev-orchestrator inbox`.');
}
