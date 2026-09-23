// Tiny terminal helpers. No dependencies.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const useColor = stdout.isTTY && !process.env.NO_COLOR;
const wrap = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
};

export const BUCKET_STYLE = {
  ignore: c.dim,
  faq: c.cyan,
  sales: c.green,
  support: c.blue,
  escalate: c.red,
  unsure: c.yellow,
};

export function bucketTag(bucket) {
  const paint = BUCKET_STYLE[bucket] ?? ((s) => s);
  return paint(bucket.toUpperCase().padEnd(8));
}

export function log(...parts) {
  console.log(...parts);
}
export function ok(msg) {
  console.log(c.green('✔'), msg);
}
export function warn(msg) {
  console.log(c.yellow('!'), msg);
}
export function fail(msg) {
  console.log(c.red('✖'), msg);
}
export function hr() {
  console.log(c.dim('─'.repeat(Math.min(stdout.columns || 60, 72))));
}
export function title(t) {
  console.log();
  console.log(c.bold(t));
  hr();
}

let rl;
function reader() {
  if (!rl) rl = readline.createInterface({ input: stdin, output: stdout });
  return rl;
}
export function closePrompt() {
  if (rl) rl.close();
  rl = undefined;
}

/** Ask a free-text question. Returns trimmed string (defaultValue if the person just hits enter). */
export async function ask(question, { defaultValue = '', secret = false } = {}) {
  const suffix = defaultValue ? c.dim(` (${defaultValue})`) : '';
  if (secret) {
    const v = await askSecret(`${question}${suffix}: `);
    return v || defaultValue;
  }
  const answer = await reader().question(question ? `${question}${suffix}: ` : '');
  return answer.trim() || defaultValue;
}

/** y/n question. */
export async function confirm(question, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const a = (await reader().question(`${question} ${c.dim(`[${hint}]`)} `)).trim().toLowerCase();
  if (!a) return defaultYes;
  return a.startsWith('y');
}

/** Single-key choice from a map like { s: 'send', e: 'edit' }. Returns the key. */
export async function choose(question, choices) {
  const legend = Object.entries(choices)
    .map(([k, label]) => `${c.bold(k)}${c.dim('=' + label)}`)
    .join('  ');
  for (;;) {
    const a = (await reader().question(`${question}\n  ${legend}\n> `)).trim().toLowerCase();
    if (a in choices) return a;
    const byLabel = Object.keys(choices).find((k) => choices[k] === a);
    if (byLabel) return byLabel;
    warn('Pick one of the letters above.');
  }
}

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const DEL = String.fromCharCode(127);

// Reads a line without echoing it (for API keys). Falls back to plain input when not a TTY.
function askSecret(prompt) {
  if (!stdin.isTTY) return reader().question(prompt).then((s) => s.trim());
  closePrompt();
  return new Promise((resolve) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (s) => {
      for (const ch of s) {
        if (ch === CTRL_C) process.exit(130);
        if (ch === '\r' || ch === '\n' || ch === CTRL_D) {
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write('\n');
          resolve(buf.trim());
          return;
        }
        if (ch === DEL || ch === '\b') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** Indent a block of text for display. */
export function indent(text, pad = '    ') {
  return String(text ?? '')
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

export function truncate(s, n = 90) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
