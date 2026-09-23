// `jev-orchestrator demo`: play the scripted run against an already-running UI, so nothing on screen has to say "demo".
import { log, ok, fail, c } from '../ui.js';

export async function demo({ port = 4180, stop = false } = {}) {
  const url = `http://127.0.0.1:${port}/demo`;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stop ? { action: 'stop' } : {}) });
    if (!res.ok) throw new Error(`the app answered ${res.status}`);
    if (stop) ok('Demo stopped');
    else ok(`Demo running, watch it in the browser ${c.dim('(nine messages, about 90 seconds, nothing is sent)')}`);
  } catch (err) {
    fail(`could not reach the app on port ${port}: ${err.message}`);
    log(c.dim('Start it first with `jev-orchestrator`, then run this in another terminal.'));
  }
}
