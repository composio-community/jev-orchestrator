// Jev, TypeSafe's System One decision model, reached through OpenRouter's /v1/systemone endpoint.
// It does not generate text. It answers typed questions about a state with calibrated probabilities.
// Docs: https://docs.typesafe.ai  ·  OpenRouter: https://openrouter.ai/docs/guides/community/typesafe-sdk
const ENDPOINT = 'https://openrouter.ai/api/v1/systemone';

export async function systemOne({ model = 'jev-latest', state, questions, fetchImpl = fetch, timeoutMs = 15_000 }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    const err = new Error('OPENROUTER_API_KEY is missing; Jev runs through OpenRouter');
    err.needsKey = true;
    throw err;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/jev-router', 'X-Title': 'Jev' },
      body: JSON.stringify({ model, state, questions }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Jev ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    if (!data.answers) throw new Error(`Jev returned no answers: ${text.slice(0, 200)}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Jev timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Shorthand builders, same shape the TypeSafe SDK uses. */
export const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
export const noul = (instructions, criteria) => (criteria ? { type: 'noul', instructions, criteria } : { type: 'noul', instructions });
export const score = (instructions, criteria) => ({ type: 'score', instructions, criteria });
