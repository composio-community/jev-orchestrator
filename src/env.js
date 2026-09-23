// Minimal .env reader/writer so nobody has to learn dotenv.
import fs from 'node:fs';
import path from 'node:path';

export const ENV_PATH = path.resolve(process.cwd(), '.env');

export function loadEnv(file = ENV_PATH) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return out;
}

export function saveEnvValue(key, value, file = ENV_PATH) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  const idx = lines.findIndex((l) => l.trim().startsWith(key + '='));
  const entry = `${key}=${value}`;
  if (idx >= 0) lines[idx] = entry;
  else {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(entry);
  }
  fs.writeFileSync(file, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  process.env[key] = value;
}
