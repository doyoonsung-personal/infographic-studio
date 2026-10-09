// Qwen3.8 on Alibaba Model Studio (OpenAI-compatible endpoints).
// Chat streams straight through to the browser; research uses the Responses API web_search tool.

import { fail } from './http.js';

function base(env) {
  if (!env.DASHSCOPE_API_KEY || !env.DASHSCOPE_BASE_URL) fail(503, 'Qwen is not configured (DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL)');
  return env.DASHSCOPE_BASE_URL.replace(/\/+$/, '') + '/compatible-mode/v1';
}

function headers(env) {
  return { Authorization: 'Bearer ' + env.DASHSCOPE_API_KEY, 'Content-Type': 'application/json' };
}

const ROLES = new Set(['system', 'user', 'assistant', 'tool']);

function cleanMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) fail(400, 'messages required');
  if (messages.length > 120) fail(400, 'too many messages');
  return messages.map((m) => {
    if (!ROLES.has(m.role)) fail(400, 'bad role');
    const out = { role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 300000) : (m.content ?? '') };
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = String(m.tool_call_id);
    if (m.name) out.name = String(m.name);
    return out;
  });
}

/** POST /api/ai/chat — streams Server-Sent Events from Qwen back to the browser. */
export async function chat(env, body, config) {
  const model = body.role === 'writer' ? config.models.writer : (body.model || config.models.chat);
  const payload = {
    model,
    messages: cleanMessages(body.messages),
    stream: true,
    stream_options: { include_usage: true },
    enable_thinking: Boolean(body.thinking),
  };
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools.slice(0, 32);
  if (typeof body.temperature === 'number') payload.temperature = Math.min(1.5, Math.max(0, body.temperature));
  if (body.json) payload.response_format = { type: 'json_object' };

  const r = await fetch(base(env) + '/chat/completions', { method: 'POST', headers: headers(env), body: JSON.stringify(payload) });
  if (!r.ok) {
    const t = await r.text();
    fail(r.status === 429 ? 429 : 502, 'Qwen error ' + r.status + ': ' + t.slice(0, 600));
  }
  return new Response(r.body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-model': model },
  });
}

/** POST /api/ai/research — one web-search-grounded answer: { text, sources, queries }. */
export async function research(env, body, config) {
  const input = String(body.input || '').slice(0, 40000);
  if (!input) fail(400, 'input required');
  const r = await fetch(base(env) + '/responses', {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ model: config.models.research, input, tools: [{ type: 'web_search' }] }),
  });
  const text = await r.text();
  if (!r.ok) fail(r.status === 429 ? 429 : 502, 'Qwen research error ' + r.status + ': ' + text.slice(0, 600));
  let j;
  try { j = JSON.parse(text); } catch { fail(502, 'Qwen research returned non-JSON'); }
  const out = { text: '', sources: [], queries: [], model: j.model };
  const seen = new Set();
  for (const item of j.output || []) {
    if (item.type === 'web_search_call' && item.action) {
      for (const q of item.action.queries || [item.action.query]) if (q) out.queries.push(q);
      for (const s of item.action.sources || []) {
        if (s && s.url && !seen.has(s.url)) { seen.add(s.url); out.sources.push(s.url); }
      }
    }
    if (item.type === 'message') {
      for (const c of item.content || []) if (c.type === 'output_text') out.text += c.text;
    }
  }
  if (j.usage) out.usage = j.usage;
  return out;
}
