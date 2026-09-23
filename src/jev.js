// Jev, the filter. One TypeSafe System One call: a Choice over the buckets plus two Nouls the code gates on.
// Jev never writes a reply; it only decides. Docs: https://docs.typesafe.ai
import { systemOne, choice, noul } from './typesafe.js';
import { BUCKETS, readKnowledge } from './config.js';

export const CRITERIA = {
  ignore: 'Spam, a newsletter or digest, an automated notification, cold outreach selling something TO us, or chit-chat that needs no reply.',
  faq: 'A question whose direct answer is written in the `faq` text: pricing, hours, how it works, a policy. Only when the FAQ actually contains the answer.',
  sales: 'Someone who might buy or upgrade: asks for a demo, a quote, pricing for a team, availability, or whether we can do something for them.',
  support: 'An existing customer with a problem: something broken, cannot log in, a billing error, a how-do-I question about using the product, a bug report.',
  escalate: 'Angry, threatens a chargeback, refund dispute, legal action, or bad press; a security report; anything where an automatic reply could be costly.',
};

export function buildQuestions() {
  return {
    bucket: choice('Which bucket does `message` belong in? Read `business` and `faq` first. Pick the single best fit.', CRITERIA),
    faq_covers: noul('Does the `faq` text contain a direct answer to what `message` is asking?', {
      true: 'The FAQ states the answer to this exact question.',
      false: 'The FAQ does not address it, or only partly.',
    }),
    needs_human: noul('Would replying to `message` automatically, without a person reading it first, be risky for the business?', {
      true: 'Legal, refund or chargeback threats, anger, press, security, or an ambiguous request where a wrong reply costs money or trust.',
      false: 'A routine message where a polite templated reply is fine.',
    }),
  };
}

export function buildState(item) {
  return {
    business: readKnowledge('business.md') || '(no business description yet)',
    faq: readKnowledge('faq.md') || '(no FAQ yet)',
    message: { channel: item.channel, from: item.from, subject: item.subject || '', text: item.text.slice(0, 4000) },
  };
}

/**
 * @returns {{bucket, confidence, probabilities, faqCovers, needsHuman, reason, ms}}
 */
export async function classify(cfg, item, { fetchImpl } = {}) {
  const t0 = Date.now();
  const res = await systemOne({ model: cfg.jevModel || 'jev-latest', state: buildState(item), questions: buildQuestions(), fetchImpl });
  const a = res.answers;
  const probabilities = a.bucket.probabilities ?? {};
  let bucket = String(a.bucket.choice ?? 'unsure');
  const confidence = Number(a.bucket.confidence) || 0;
  const faqCovers = Number(a.faq_covers?.noul ?? 0);
  const needsHuman = Number(a.needs_human?.noul ?? 0);
  const floor = cfg.confidenceFloor ?? 0.5;
  const reasons = [];

  if (!BUCKETS.includes(bucket)) bucket = 'unsure';
  if (bucket === 'faq' && faqCovers < 0.5) {
    reasons.push(`looked like FAQ but the FAQ does not cover it (${pct(faqCovers)})`);
    bucket = 'unsure';
  }
  if (bucket !== 'escalate' && needsHuman >= 0.7) {
    reasons.push(`risky to auto-reply (${pct(needsHuman)})`);
    bucket = 'escalate';
  }
  if (bucket !== 'unsure' && bucket !== 'escalate' && confidence < floor) {
    reasons.push(`Jev is split (confidence ${pct(confidence)})`);
    bucket = 'unsure';
  }
  const top = Object.entries(probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${pct(v)}`).join(', ');
  return { bucket, original: a.bucket.choice, confidence, probabilities, faqCovers, needsHuman, reason: reasons.length ? reasons.join('; ') : top, top, ms: Date.now() - t0, model: res.model };
}

export const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;
