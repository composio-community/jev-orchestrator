// `jev setup`: the only thing a person has to get through. Re-runnable; skips what is already done.
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, saveEnvValue } from '../env.js';
import { loadConfig, saveConfig, KNOWLEDGE_DIR } from '../config.js';
import { connectedAccount, beginConnect, createXAuthConfig, ensureTrigger } from '../composio.js';
import { SOURCES, parseField } from '../sources/index.js';
import { ask, confirm, ok, warn, fail, title, log, c, closePrompt } from '../ui.js';

const TEMPLATES = {
  'business.md': (cfg) => `# About ${cfg.owner.name || 'us'}

<!-- Jev reads this before every decision. Two or three honest paragraphs beat a marketing page. -->

What we sell:
Who buys it:
What we do NOT do:
`,
  'faq.md': () => `# FAQ

<!-- Jev only uses "faq" when the answer is actually in here. One question per heading. -->

## What does it cost?

## How do I get started?

## Do you offer refunds?
`,
  'support.md': () => `# Support notes

<!-- Steps the support agent may give. If a problem is not here, it asks for details and stops. -->

## Can't log in
1. Reset the password from the login page.
2. Check the spam folder for the reset email.

## Billing looks wrong
Ask for the account email and the date on the invoice. Do not promise a refund.
`,
};

export async function setup() {
  title('Jev Orchestrator setup');
  log('It watches your inbox, form leads, Slack, Discord and X mentions. Jev (a decision model, not a chatbot) sorts each one:');
  log('ignore · faq · sales · support · escalate · unsure. Only the matched bucket runs a write agent.');
  log('You approve every customer-facing reply until you switch to auto.\n');

  loadEnv();
  const cfg = loadConfig();

  // 1. keys
  title('1/7  Keys');
  if (!process.env.COMPOSIO_API_KEY) {
    log(`Composio handles the Gmail / Typeform / Slack / Discord / X connections. Get a key at ${c.cyan('https://platform.composio.dev')} → Settings → API keys.`);
    saveEnvValue('COMPOSIO_API_KEY', await ask('Composio API key', { secret: true }));
  }
  ok('Composio key present');
  if (!process.env.OPENROUTER_API_KEY) {
    log(`OpenRouter carries both Jev (the filter) and the write agents. Get a key at ${c.cyan('https://openrouter.ai/keys')} and put a spend limit on it.`);
    saveEnvValue('OPENROUTER_API_KEY', await ask('OpenRouter API key', { secret: true }));
  }
  ok('OpenRouter key present');

  // 2. who you are
  title('2/7  About you');
  cfg.owner.name = await ask('Your name (signs replies)', { defaultValue: cfg.owner.name });
  cfg.owner.email = (await ask('Your email (escalations go here)', { defaultValue: cfg.owner.email })).toLowerCase();
  cfg.bookingLink = await ask('Booking link for sales replies, optional', { defaultValue: cfg.bookingLink });
  saveConfig(cfg);
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  for (const [name, tpl] of Object.entries(TEMPLATES)) {
    const file = path.join(KNOWLEDGE_DIR, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, tpl(cfg));
  }
  ok(`Knowledge files are in ${c.bold('knowledge/')}: business.md, faq.md, support.md. Edit them any time; Jev reads them on every decision.`);

  // 3. gmail
  title('3/7  Email (Gmail)');
  const gmail = await connectToolkit(cfg, 'gmail', 'Gmail');
  if (gmail) {
    cfg.sources.gmail.enabled = true;
    cfg.sources.gmail.triggerId = await ensureTrigger(cfg, 'GMAIL_NEW_GMAIL_MESSAGE', { labelIds: 'INBOX', interval: 2 });
    ok(`Watching new INBOX mail (checked every ~2 min) ${c.dim(cfg.sources.gmail.triggerId)}`);
  } else {
    cfg.sources.gmail.enabled = false;
    warn('Email is off. Escalations need Gmail, so escalate will land in the needs-you pile instead.');
  }
  saveConfig(cfg);

  // 4. form leads
  title('4/7  Form leads (Typeform)');
  if (await confirm('Do you collect leads with a Typeform?', cfg.sources.typeform.enabled)) {
    const tf = await connectToolkit(cfg, 'typeform', 'Typeform');
    if (tf) {
      log(c.dim('The form ID is the last part of its public link: https://form.typeform.com/to/x2DfMTz9 → x2DfMTz9'));
      cfg.sources.typeform.formId = await ask('Form ID', { defaultValue: cfg.sources.typeform.formId });
      if (cfg.sources.typeform.formId) {
        cfg.sources.typeform.triggerId = await ensureTrigger(cfg, 'TYPEFORM_NEW_RESPONSE', { form_id: cfg.sources.typeform.formId });
        cfg.sources.typeform.enabled = true;
        ok(`Watching new responses on form ${cfg.sources.typeform.formId}`);
      }
    }
  } else {
    cfg.sources.typeform.enabled = false;
    log(c.dim('Skipped. You can still pipe any form into Jev with `jev-orchestrator test --from form "..."` or by adding a source later.'));
  }
  saveConfig(cfg);

  // 5. Slack
  title('5/7  Slack');
  if (await confirm('Watch Slack messages (DMs and channels the app is in)?', cfg.sources.slack.enabled)) {
    const sl = await connectToolkit(cfg, 'slack', 'Slack');
    if (sl) {
      const ch = await ask('Channel IDs to watch, comma-separated (empty = everything the app can see)', { defaultValue: cfg.sources.slack.channels.join(', ') });
      cfg.sources.slack.channels = parseField('slack', 'channels', ch);
      const [slug, conf] = SOURCES.slack.trigger(cfg.sources.slack);
      cfg.sources.slack.triggerId = await ensureTrigger(cfg, slug, conf);
      cfg.sources.slack.enabled = true;
      ok(`Watching Slack${cfg.sources.slack.channels.length ? ` in ${cfg.sources.slack.channels.join(', ')}` : ''}; replies go in the thread`);
    }
  } else {
    cfg.sources.slack.enabled = false;
  }
  saveConfig(cfg);

  // 6. Discord
  title('6/7  Discord');
  log('Discord takes two connections: your account (reads the channel) and the Composio bot (posts the replies). Invite the bot to your server when Discord asks.');
  if (await confirm('Watch a Discord channel?', cfg.sources.discord.enabled)) {
    const me = await connectToolkit(cfg, 'discord', 'Discord (your account)');
    const bot = me && (await connectToolkit(cfg, 'discordbot', 'Discord bot'));
    if (me && bot) {
      log(c.dim('Discord → Settings → Advanced → Developer Mode, then right-click the channel → Copy Channel ID.'));
      cfg.sources.discord.channelId = parseField('discord', 'channelId', await ask('Channel ID', { defaultValue: cfg.sources.discord.channelId }));
      if (cfg.sources.discord.channelId) {
        const [slug, conf] = SOURCES.discord.trigger(cfg.sources.discord);
        cfg.sources.discord.triggerId = await ensureTrigger(cfg, slug, conf);
        cfg.sources.discord.enabled = true;
        ok(`Watching Discord channel ${cfg.sources.discord.channelId}`);
      }
    }
  } else {
    cfg.sources.discord.enabled = false;
  }
  saveConfig(cfg);

  // 7. X
  title('7/7  X mentions');
  log('X does not offer a managed app, so this needs your own X developer app (free tier works).');
  log(c.dim('developer.x.com → your app → Keys and tokens. You need: OAuth 2.0 Client ID + Secret, and the app Bearer Token.'));
  log(c.dim('In the app\'s User authentication settings add this callback URL: https://backend.composio.dev/api/v1/auth-apps/add'));
  if (await confirm('Set up X mentions now?', cfg.sources.x.enabled)) {
    cfg.sources.x.handle = (await ask('Your X handle (without @)', { defaultValue: cfg.sources.x.handle })).replace(/^@/, '');
    if (!cfg.sources.x.authConfigId) {
      const clientId = await ask('OAuth 2.0 Client ID');
      const clientSecret = await ask('OAuth 2.0 Client Secret', { secret: true });
      const bearerToken = await ask('App Bearer Token', { secret: true });
      try {
        cfg.sources.x.authConfigId = await createXAuthConfig({ clientId, clientSecret, bearerToken });
        ok(`Saved your X app as auth config ${c.dim(cfg.sources.x.authConfigId)}`);
      } catch (err) {
        fail(`Could not save the X app: ${err.message}`);
      }
    }
    saveConfig(cfg);
    if (cfg.sources.x.authConfigId) {
      const x = await connectToolkit(cfg, 'twitter', 'X', cfg.sources.x.authConfigId);
      cfg.sources.x.enabled = Boolean(x && cfg.sources.x.handle);
      if (cfg.sources.x.enabled) ok(`Polling mentions of @${cfg.sources.x.handle} every ${cfg.sources.x.pollMinutes} min`);
    }
  } else {
    cfg.sources.x.enabled = false;
  }
  saveConfig(cfg);

  title('Done');
  log(`Mode: ${c.bold(cfg.mode)} ${c.dim(cfg.mode === 'review' ? 'replies wait for your OK. Switch with `/mode auto` when you trust it.' : 'replies go out immediately.')}`);
  log(`\nNext:\n  1. Fill in ${c.bold('knowledge/business.md')} and ${c.bold('knowledge/faq.md')}.\n  2. Open the workflow:  ${c.bold('jev-orchestrator')}   (type a message at the prompt to test the whole flow safely)\n`);
  closePrompt();
}

async function connectToolkit(cfg, slug, label, authConfigId) {
  const existing = await connectedAccount(cfg, slug);
  if (existing) {
    ok(`${label} connected ${c.dim(existing.id)}`);
    return existing;
  }
  if (!(await confirm(`Connect ${label}?`, true))) return null;
  try {
    const { url, wait } = await beginConnect(cfg, slug, authConfigId);
    log(`\nOpen this link, sign in, then come back:\n  ${c.cyan(url)}\n`);
    log(c.dim('Waiting up to 5 minutes…'));
    const acct = await wait();
    ok(`${label} connected ${c.dim(acct.id)}`);
    return acct;
  } catch (err) {
    fail(`${label} not connected: ${err.message}`);
    return null;
  }
}
