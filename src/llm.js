// OpenRouter over plain fetch. Two entry points:
//   chatJson():  one call, JSON answer (used by Jev, the classifier; no tools)
//   runAgent():  tool-calling loop (used by the write agents)
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function headers() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is missing. Run `jev-orchestrator setup`.');
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/jev-router',
    'X-Title': 'Jev',
  };
}

async function complete(body) {
  const res = await fetch(OPENROUTER_URL, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  if (data.error) throw new Error(`OpenRouter: ${data.error.message ?? JSON.stringify(data.error)}`);
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error('OpenRouter returned no message');
  return msg;
}

/** Pull a JSON object out of a model reply, tolerating ```json fences and stray prose. */
export function extractJson(text) {
  if (!text) throw new Error('empty model reply');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in model reply: ' + text.slice(0, 120));
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function chatJson({ model, system, user, maxTokens = 400 }) {
  const msg = await complete({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: maxTokens,
  });
  return extractJson(msg.content);
}

/**
 * Tool loop. `tools` is OpenAI chat-completions tool JSON (what session.tools() returns).
 * `onToolCall(name, args)` must return a string or JSON-able value that goes back to the model.
 * Stops when the model answers with text, or after maxTurns.
 */
export async function runAgent({ model, system, user, tools, onToolCall, maxTurns = 5 }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const calls = [];
  for (let turn = 0; turn < maxTurns; turn++) {
    const msg = await complete({ model, messages, tools, tool_choice: 'auto', temperature: 0.2, max_tokens: 1200 });
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
    if (!msg.tool_calls?.length) return { text: msg.content ?? '', calls };
    for (const tc of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }
      let result;
      try {
        result = await onToolCall(tc.function.name, args);
      } catch (err) {
        result = { successful: false, error: String(err?.message ?? err) };
      }
      calls.push({ name: tc.function.name, args, result });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  }
  return { text: '(stopped: too many tool turns)', calls };
}
