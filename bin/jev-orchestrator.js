#!/usr/bin/env node
// Jev Orchestrator: filter first, write agents second.
process.env.COMPOSIO_LOG_LEVEL ??= 'error';
import { c, fail } from '../src/ui.js';

const argv = process.argv.slice(2);
const cmd = argv[0]?.startsWith('--') ? undefined : argv.shift();
const rest = argv;
function flag(name) {
  const i = rest.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = rest[i + 1];
  rest.splice(i, 2);
  return v;
}

const HELP = `
${c.bold('jev-orchestrator')}: inbound messages in, the right action out. Jev decides; write agents write.

  ${c.bold('jev-orchestrator')}                  open the live flowchart in your browser   [--port 4180] [--no-open]
  ${c.bold('jev-orchestrator setup')}            keys, your details, connect Gmail / Typeform / Slack / Discord / X, create triggers (re-runnable)
  ${c.bold('jev-orchestrator start')}            headless watcher, one line per decision   [--dry-run]
  ${c.bold('jev-orchestrator inbox')}            approve drafted replies, sort what Jev was unsure about
  ${c.bold('jev-orchestrator test "message"')}   dry run one message   [--from email|x|form|slack|discord] [--sender who]
  ${c.bold('jev-orchestrator demo')}             play a scripted run through the open UI   [--stop] [--port 4180]
  ${c.bold('jev-orchestrator status')}           what is connected, what is waiting
  ${c.bold('jev-orchestrator mode auto|review')} auto = send immediately, review = ask you first (default)

Buckets: ${c.dim('ignore')} · ${c.cyan('faq')} · ${c.green('sales')} · ${c.blue('support')} · ${c.red('escalate')} · ${c.yellow('unsure → needs you')}
Jev reads ${c.bold('knowledge/business.md')} and ${c.bold('knowledge/faq.md')} on every decision; the support agent reads ${c.bold('knowledge/support.md')}.
`;

try {
  switch (cmd) {
    case undefined:
    case 'ui': {
      const port = Number(flag('port') || 4180);
      const { url } = await (await import('../src/server.js')).startServer({ port, open: !rest.includes('--no-open') });
      console.log(`${c.bold('Jev Orchestrator')} is at ${c.cyan(url)}  ${c.dim('(Ctrl+C stops it; held replies stay in the inbox)')}`);
      setInterval(() => {}, 1 << 30);
      break;
    }
    case 'setup':
      await (await import('../src/commands/setup.js')).setup();
      break;
    case 'start':
      await (await import('../src/commands/start.js')).start({ dryRun: rest.includes('--dry-run') });
      break;
    case 'inbox':
      await (await import('../src/commands/inbox.js')).inbox();
      break;
    case 'status':
      await (await import('../src/commands/status.js')).status();
      break;
    case 'mode':
      (await import('../src/commands/mode.js')).mode(rest[0]);
      break;
    case 'demo':
      await (await import('../src/commands/demo.js')).demo({ port: Number(flag('port') || 4180), stop: rest.includes('--stop') });
      break;
    case 'test': {
      const from = flag('from');
      const sender = flag('sender');
      await (await import('../src/commands/test.js')).test(rest.join(' '), { from, sender });
      break;
    }
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      fail(`unknown command "${cmd}"`);
      console.log(HELP);
      process.exitCode = 1;
  }
} catch (err) {
  fail(err?.message ?? String(err));
  if (process.env.JEV_DEBUG) console.error(err);
  process.exitCode = 1;
}
