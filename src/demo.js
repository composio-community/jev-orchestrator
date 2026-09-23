// A scripted run for demos and first looks: realistic messages on every source, covering every bucket.
// Demo items are test items, so nothing can ever be sent to anyone; the write agents still run for real
// and their replies land in the needs-you pile the same way they would in production.
import { handleItem } from './pipeline.js';
import { loadInbox, saveInbox } from './config.js';
import { emit } from './bus.js';

/** The script. `gap` is the pause before the next message, in ms. */
export const SCRIPT = [
  {
    channel: 'gmail',
    from: 'Dana Whitfield <dana.whitfield@northgatephysio.co.uk>',
    subject: 'Pricing for a second location',
    text: "Hi there,\n\nWe run a physio clinic in Leeds and we're opening a second room in March. What does it cost per location, and is there a limit on how many therapists we can add?\n\nThanks,\nDana",
    gap: 5000,
  },
  {
    channel: 'slack',
    from: 'Maya Oyelaran',
    text: "hey! quick one, my 9am client never got her SMS reminder this morning. she's on an Australian number. is that supposed to work?",
    gap: 5000,
  },
  {
    channel: 'form',
    from: 'sam@brightsideyoga.com',
    text: "Studio name: Brightside Yoga\nWhat do you use today?: pen and paper, it's chaos\nHow many staff?: 4\nEmail: sam@brightsideyoga.com\nAnything else?: Mostly want clients to book and pay online without calling us. Can we try it before paying?",
    gap: 5000,
  },
  {
    channel: 'x',
    from: '@leo_tutors',
    text: "anyone know a booking tool that doesn't charge per seat? @acmescheduling looks promising but the pricing page is vague",
    gap: 5000,
  },
  {
    channel: 'discord',
    from: 'kai',
    text: "is there a student discount? also do you integrate with google calendar",
    gap: 5000,
  },
  {
    channel: 'gmail',
    from: 'Robert Ines <r.ines@inesbodywork.com>',
    subject: 'Charged twice - this is the second time',
    text: "This is the second month running that I have been charged twice. I want both duplicate charges refunded today and I want to know why this keeps happening. If it is not sorted by Friday I will be raising it with my bank and leaving a review.\n\nRobert",
    gap: 5000,
  },
  {
    channel: 'gmail',
    from: 'Stripe <no-reply@stripe.com>',
    subject: 'Your monthly payout is on its way',
    text: "Your payout of £1,240.00 is scheduled to arrive on 24 September. View the details in your Stripe dashboard.",
    gap: 5000,
  },
  {
    channel: 'slack',
    from: 'Priya Raman',
    text: "following up on the thing from last week - any movement?",
    gap: 5000,
  },
  {
    // Deliberately vague: Jev splits, confidence lands under the floor, and it goes to you instead of an agent.
    channel: 'gmail',
    from: 'Aisha Bello <aisha@studioseven.co>',
    subject: 'quick question',
    text: "quick question about the account when you get a sec",
    gap: 0,
  },
];

/** Build one demo item. Carries test:true so it can never be sent, and demo:true so the UI flows it from its real source node. */
function demoItem(m, i) {
  const id = `demo:${Date.now()}:${i}`;
  const base = { id, from: m.from, subject: m.subject ?? '', text: m.text, url: '', test: true, demo: true };
  if (m.channel === 'gmail') {
    const email = (m.from.match(/<([^>]+)>/)?.[1] ?? m.from).toLowerCase();
    return { ...base, channel: 'gmail', fromEmail: email, reply: { threadId: '0000000000000000', messageId: '0', to: email } };
  }
  if (m.channel === 'form') return { ...base, channel: 'form', fromEmail: m.from, subject: 'Form: new lead', reply: { to: m.from } };
  if (m.channel === 'x') return { ...base, channel: 'x', fromEmail: '', reply: { tweetId: '0', handle: m.from } };
  if (m.channel === 'slack') return { ...base, channel: 'slack', fromEmail: '', authorId: '', botId: '', reply: { channel: 'C0DEMO0000', ts: String(Date.now() / 1000) } };
  return { ...base, channel: 'discord', fromEmail: '', authorId: '', reply: { channelId: '0', messageId: String(i) } };
}

/** Who the agents write as during a scripted run, so the owner's own name and address stay out of it. */
export const DEMO_OWNER = { name: 'Wren Calloway', email: 'wren@acmescheduling.example' };

// `presenting` outlasts the script: it stays on until you stop it, so anything you type by hand mid-presentation
// is written by the same persona and the canvas keeps reading as live.
const state = { running: false, presenting: false, cancel: null };
export const demoState = () => ({ running: state.presenting, total: SCRIPT.length });
/** Nothing typed into the composer has a real person behind it, so a brief from one is never addressed to the
 *  real owner, otherwise forgetting to turn presenting on puts their name and address on screen. */
export const composedCfg = (cfg) => ({ ...cfg, owner: DEMO_OWNER });

/** Play the script. Resolves when it finishes or is stopped. One run at a time. */
export async function runDemo(cfg) {
  // Presenting turns on first, so it takes effect even when a script is still mid-message from a previous call.
  state.presenting = true;
  emit('demo', { running: true, total: SCRIPT.length });
  if (state.running) return;
  // Start clean: retire drafts left by *previous runs* only. Anything typed by hand survives, so opening with a
  // custom message and then starting the run keeps both on screen. Retired, not deleted, so stale rows still resolve.
  saveInbox(loadInbox().map((e) => (e.status === 'open' && e.item?.demo ? { ...e, status: 'cleared' } : e)));
  const persona = { ...cfg, owner: DEMO_OWNER };
  state.running = true;
  let stopped = false;
  state.cancel = () => { stopped = true; };
  emit('demo', { running: true, total: SCRIPT.length });
  try {
    for (const [i, m] of SCRIPT.entries()) {
      if (stopped) break;
      emit('demo', { running: true, index: i + 1, total: SCRIPT.length });
      await handleItem(persona, demoItem(m, i)).catch((err) => emit('error', { message: `demo: ${err.message}` }));
      if (stopped || !m.gap) continue;
      await new Promise((r) => setTimeout(r, m.gap));
    }
  } finally {
    state.running = false;
    state.cancel = null;
    // presenting stays on; only an explicit stop clears it
    emit('demo', { running: state.presenting, total: SCRIPT.length });
  }
}

export function stopDemo() {
  state.cancel?.();
  state.presenting = false;
  emit('demo', { running: false, total: SCRIPT.length });
}
